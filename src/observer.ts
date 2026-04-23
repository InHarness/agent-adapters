// StreamObserver — observer pattern for UnifiedEvent streams
// Based on InHarness M04 spec (m04-orchestration.md:218-231)

import type { UnifiedEvent, NormalizedMessage, UsageStats } from './types.js';

/**
 * Observer interface for processing UnifiedEvent streams.
 * Implement any subset of methods to react to specific event types.
 *
 * @example
 * ```ts
 * const logger: StreamObserver = {
 *   onTextDelta(text) { process.stdout.write(text); },
 *   onError(error) { console.error(error); },
 * };
 * ```
 */
export interface StreamObserver {
  onTextDelta?(text: string, isSubagent: boolean): void;
  onToolUse?(toolName: string, toolUseId: string, input: unknown, isSubagent: boolean): void;
  onToolResult?(toolUseId: string, summary: string): void;
  onThinking?(text: string, isSubagent: boolean): void;
  onAssistantMessage?(message: NormalizedMessage): void;
  onSubagentStarted?(taskId: string, description: string, toolUseId: string): void;
  onSubagentProgress?(taskId: string, description: string, lastToolName?: string): void;
  onSubagentCompleted?(taskId: string, status: string, summary?: string, usage?: unknown): void;
  onFlush?(): void;
  onResult?(output: string, rawMessages: NormalizedMessage[], usage: UsageStats, sessionId?: string): void;
  onError?(error: Error): void;
}

/**
 * Dispatch a UnifiedEvent to all observers.
 * Calls the appropriate observer method based on event type.
 *
 * @example
 * ```ts
 * const observers: StreamObserver[] = [logger, persistence];
 * for await (const event of adapter.execute(params)) {
 *   dispatchEvent(event, observers);
 * }
 * ```
 */
export function dispatchEvent(event: UnifiedEvent, observers: StreamObserver[]): void {
  for (const observer of observers) {
    switch (event.type) {
      case 'text_delta':
        observer.onTextDelta?.(event.text, event.isSubagent);
        break;
      case 'tool_use':
        observer.onToolUse?.(event.toolName, event.toolUseId, event.input, event.isSubagent);
        break;
      case 'tool_result':
        observer.onToolResult?.(event.toolUseId, event.summary);
        break;
      case 'thinking':
        observer.onThinking?.(event.text, event.isSubagent);
        break;
      case 'assistant_message':
        observer.onAssistantMessage?.(event.message);
        break;
      case 'subagent_started':
        observer.onSubagentStarted?.(event.taskId, event.description, event.toolUseId);
        break;
      case 'subagent_progress':
        observer.onSubagentProgress?.(event.taskId, event.description, event.lastToolName);
        break;
      case 'subagent_completed':
        observer.onSubagentCompleted?.(event.taskId, event.status, event.summary, event.usage);
        break;
      case 'flush':
        observer.onFlush?.();
        break;
      case 'result':
        observer.onResult?.(event.output, event.rawMessages, event.usage, event.sessionId);
        break;
      case 'error':
        observer.onError?.(event.error);
        break;
    }
  }
}

/**
 * Create a passthrough that dispatches events to observers while yielding them.
 * Useful when you want to both observe and consume the event stream.
 *
 * @example
 * ```ts
 * const stream = adapter.execute(params);
 * const observed = observeStream(stream, [logger, metrics]);
 * for await (const event of observed) {
 *   // events are dispatched to observers AND yielded here
 * }
 * ```
 */
export async function* observeStream(
  stream: AsyncIterable<UnifiedEvent>,
  observers: StreamObserver[],
): AsyncIterable<UnifiedEvent> {
  for await (const event of stream) {
    dispatchEvent(event, observers);
    yield event;
  }
}

/**
 * Options for {@link createConsoleObserver}.
 */
export interface ConsoleObserverOptions {
  /** Use ANSI color codes. Defaults to `process.stdout.isTTY`. */
  color?: boolean;
  /** Print `thinking` deltas. Defaults to `false`. */
  thinking?: boolean;
  /** Prefix subagent events with `[sub <taskId>]`. Defaults to `true`. */
  subagents?: boolean;
  /** Print token usage on `result`. Defaults to `true`. */
  usage?: boolean;
  /** Truncate `onToolResult` summaries to this length. Defaults to `100`. */
  toolResultMaxLen?: number;
  /** Writable stream to print to. Defaults to `process.stdout`. */
  stream?: NodeJS.WritableStream;
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Create a ready-made {@link StreamObserver} that prints UnifiedEvents to a stream
 * (default: `process.stdout`). Useful for debugging, examples, and e2e tests.
 *
 * @example
 * ```ts
 * for await (const _ of observeStream(adapter.execute(params), [createConsoleObserver()])) {
 *   // events are printed to the terminal as they arrive
 * }
 * ```
 */
export function createConsoleObserver(options: ConsoleObserverOptions = {}): StreamObserver {
  const stream = options.stream ?? process.stdout;
  const color = options.color ?? Boolean((stream as NodeJS.WriteStream).isTTY);
  const showThinking = options.thinking ?? false;
  const showSubagents = options.subagents ?? true;
  const showUsage = options.usage ?? true;
  const maxLen = options.toolResultMaxLen ?? 100;

  const paint = (code: string, text: string): string =>
    color ? `${code}${text}${ANSI.reset}` : text;

  const write = (s: string): void => {
    stream.write(s);
  };

  const subPrefix = (taskId: string): string => paint(ANSI.cyan, `[sub ${taskId}] `);

  return {
    onTextDelta(text) {
      write(text);
    },
    onThinking(text) {
      if (!showThinking) return;
      write(paint(ANSI.dim, `[think] ${text}`));
    },
    onToolUse(name, id) {
      write(`\n${paint(ANSI.cyan, '[tool]')} ${name} (${id})\n`);
    },
    onToolResult(_id, summary) {
      const truncated = summary.length > maxLen ? summary.slice(0, maxLen) + '…' : summary;
      write(`${paint(ANSI.dim, '[result]')} ${truncated}\n`);
    },
    onSubagentStarted(taskId, description) {
      if (!showSubagents) return;
      write(`\n${subPrefix(taskId)}→ ${description}\n`);
    },
    onSubagentProgress(taskId, description, lastToolName) {
      if (!showSubagents) return;
      const tail = lastToolName ? ` (${lastToolName})` : '';
      write(`${subPrefix(taskId)}${description}${tail}\n`);
    },
    onSubagentCompleted(taskId, status) {
      if (!showSubagents) return;
      write(`${subPrefix(taskId)}✓ ${status}\n`);
    },
    onResult(_output, _messages, usage) {
      if (!showUsage) return;
      write(`\n${paint(ANSI.dim, `[done] ${usage.inputTokens}in / ${usage.outputTokens}out`)}\n`);
    },
    onError(error) {
      write(`\n${paint(ANSI.red, `[error] ${error.message}`)}\n`);
    },
  };
}
