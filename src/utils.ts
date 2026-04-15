// Streaming utilities for AsyncIterable<UnifiedEvent>

import type { UnifiedEvent } from './types.js';

/**
 * Collect all events from a stream into an array.
 * Throws if the stream doesn't complete within timeoutMs.
 */
export async function collectEvents(
  stream: AsyncIterable<UnifiedEvent>,
  timeoutMs = 120_000,
): Promise<UnifiedEvent[]> {
  const events: UnifiedEvent[] = [];
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`collectEvents timed out after ${timeoutMs}ms`)), timeoutMs),
  );

  const collect = async () => {
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  };

  return Promise.race([collect(), timeout]);
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
 * Yield events until a `result` or `error` event is encountered (inclusive).
 * Useful for consuming exactly one run's worth of events.
 */
export async function* takeUntilResult(
  stream: AsyncIterable<UnifiedEvent>,
): AsyncIterable<UnifiedEvent> {
  for await (const event of stream) {
    yield event;
    if (event.type === 'result' || event.type === 'error') {
      return;
    }
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
