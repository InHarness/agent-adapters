// Streaming utilities for AsyncIterable<UnifiedEvent>

import type { UnifiedEvent } from './types.js';

/**
 * Collect all events from a stream into an array — draining it until it ends,
 * however long that takes.
 *
 * There is NO default bound (since 0.9.13; before that it gave up after 120s). This
 * helper is consumer-side, not one of the adapter's clocks, and omitting `timeoutMs`
 * is a guarantee rather than a request for a guess. Pass `timeoutMs` to bound it; it
 * then rejects if the stream has not ended in time.
 *
 * A consumer that applies such a bound to a claude-code run must size
 * `claude_backgroundHoldCapMs` under it: the hold cap only arms at a held `result`,
 * later than this clock starts, so otherwise the generic timeout fires first and the
 * typed `AdapterBackgroundHoldExpiredError` never surfaces.
 */
export async function collectEvents(
  stream: AsyncIterable<UnifiedEvent>,
  timeoutMs?: number,
): Promise<UnifiedEvent[]> {
  const events: UnifiedEvent[] = [];
  const collect = async () => {
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  };
  if (timeoutMs === undefined) return collect();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`collectEvents timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([collect(), timeout]);
  } finally {
    // Otherwise a run that finishes in a second still holds the process open for the
    // rest of the window — an exit delay for any short-lived CLI consumer.
    clearTimeout(timer);
  }
}

/**
 * Filter events by type, yielding only events of the specified type.
 *
 * @example
 * ```ts
 * for await (const delta of filterByType(stream, 'text_delta')) {
 *   process.stdout.write(delta.text);
 * }
 * ```
 */
export async function* filterByType<T extends UnifiedEvent['type']>(
  stream: AsyncIterable<UnifiedEvent>,
  type: T,
): AsyncIterable<Extract<UnifiedEvent, { type: T }>> {
  for await (const event of stream) {
    if (event.type === type) {
      yield event as Extract<UnifiedEvent, { type: T }>;
    }
  }
}

/**
 * Yield events until the run's TERMINAL `result` (or an `error`), inclusive.
 * Useful for consuming exactly one run's worth of events.
 *
 * A `result` carrying a non-empty `backgroundTasks` is not terminal: the engine is
 * holding the session open, will wake the model when that work settles, and the
 * stream still owes a `background_task_completed`, a continuation turn, and a
 * further `result` (M17). Stopping there is the exact bug `UnifiedEvent`'s `result`
 * variant warns consumers about — so this helper, which is what many of them use
 * instead of hand-rolling the loop, must not commit it either.
 */
export async function* takeUntilResult(
  stream: AsyncIterable<UnifiedEvent>,
): AsyncIterable<UnifiedEvent> {
  for await (const event of stream) {
    yield event;
    if (event.type === 'error') return;
    if (event.type === 'result' && !event.backgroundTasks?.length) return;
  }
}

/**
 * Split events into main agent events and subagent events.
 * Returns two arrays after consuming the full stream.
 *
 * The split is by attribution, not by lifecycle pair: a re-entered subagent's
 * second cycle (`subagent_started { resumed: true }`) lands in the same
 * `subagent` array in stream order — nothing is split or re-created per cycle.
 * To group by agent, key on `taskId` / `subagentTaskId`; the terminator for an
 * agent is the LAST `subagent_completed` for its `taskId`, not the first.
 */
export async function splitBySubagent(
  stream: AsyncIterable<UnifiedEvent>,
): Promise<{ main: UnifiedEvent[]; subagent: UnifiedEvent[] }> {
  const main: UnifiedEvent[] = [];
  const subagent: UnifiedEvent[] = [];

  for await (const event of stream) {
    const isSubagent =
      (event.type === 'text_delta' && event.isSubagent) ||
      (event.type === 'tool_use' && event.isSubagent) ||
      (event.type === 'thinking' && event.isSubagent) ||
      event.type === 'subagent_started' ||
      event.type === 'subagent_progress' ||
      event.type === 'subagent_completed' ||
      (event.type === 'assistant_message' && event.message.subagentTaskId != null);

    if (isSubagent) {
      subagent.push(event);
    } else {
      main.push(event);
    }
  }

  return { main, subagent };
}

/**
 * Extract the final text output from a stream.
 * Consumes the stream and returns the output from the result event,
 * or concatenated text_delta events if no result is found.
 */
export async function extractText(stream: AsyncIterable<UnifiedEvent>): Promise<string> {
  let resultOutput: string | undefined;
  const textParts: string[] = [];

  for await (const event of stream) {
    if (event.type === 'text_delta' && !event.isSubagent) {
      textParts.push(event.text);
    }
    if (event.type === 'result') {
      resultOutput = event.output;
    }
  }

  return resultOutput ?? textParts.join('');
}
