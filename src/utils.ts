// Streaming utilities for AsyncIterable<UnifiedEvent>

import type { UnifiedEvent } from './types.js';

/**
 * How long {@link collectEvents} waits by default.
 *
 * Named rather than inlined because claude-code's background-task hold has to stay
 * strictly under it: the two clocks race, and this one starts EARLIER (when the run
 * starts, not when the hold arms at a held `result`). A hold cap at or above this
 * value could never surface its `AdapterBackgroundHoldExpiredError` — the helper
 * would already have rejected the whole run with a bare timeout `Error`, losing the
 * only signal that says WHY it ended. The cap ends the run cleanly and this helper's
 * rejection does not, so the ordering matters. See `MAX_BACKGROUND_HOLD_MS` in
 * `adapters/claude-code.background-hold.ts`.
 */
export const COLLECT_EVENTS_DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Collect all events from a stream into an array.
 * Throws if the stream doesn't complete within timeoutMs.
 */
export async function collectEvents(
  stream: AsyncIterable<UnifiedEvent>,
  timeoutMs = COLLECT_EVENTS_DEFAULT_TIMEOUT_MS,
): Promise<UnifiedEvent[]> {
  const events: UnifiedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`collectEvents timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const collect = async () => {
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  };

  try {
    return await Promise.race([collect(), timeout]);
  } finally {
    // Otherwise a run that finishes in a second still holds the process open for the
    // rest of the window — a two-minute exit delay for any short-lived CLI consumer.
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
