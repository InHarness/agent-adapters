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
  /**
   * Called once per `run()` when the adapter has built its SDK-native config
   * and is about to make the first SDK call. `sdkConfig` is adapter-specific
   * (secrets redacted by key name — see `src/redact.ts`).
   */
  onAdapterReady?(adapter: string, sdkConfig: Record<string, unknown>): void;
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
      case 'adapter_ready':
        observer.onAdapterReady?.(event.adapter, event.sdkConfig);
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
  /** Print the `adapter_ready` snapshot when the run starts. Defaults to `true`. */
  showAdapterReady?: boolean;
  /** Print `adapter_ready` sdkConfig as a single JSON line instead of pretty-printed. Defaults to `false`. */
  compactAdapterReady?: boolean;
  /**
   * Show only these paths in `adapter_ready.sdkConfig`. All other keys keep
   * their position in the tree but their value is replaced with `'[Excluded]'`,
   * so consumers still see which keys exist. Dot-path with `*` wildcard for a
   * single segment, e.g. `'options.model'`, `'mcpServers.*.name'`.
   *
   * If both `sdkConfigInclude` and `sdkConfigExclude` are set, exclusion wins.
   */
  sdkConfigInclude?: string[];
  /**
   * Hide these paths in `adapter_ready.sdkConfig`. Matched subtrees are
   * replaced with `'[Excluded]'`; siblings keep their values. Dot-path with
   * `*` wildcard for a single segment, e.g. `'mcpServers.*.instance'`.
   */
  sdkConfigExclude?: string[];
}

const EXCLUDED = '[Excluded]';
const FILTER_CIRCULAR = '[CIRCULAR]';

type FilterPattern = readonly string[];

function parsePatterns(patterns: string[] | undefined): FilterPattern[] | undefined {
  if (!patterns || patterns.length === 0) return undefined;
  return patterns.map((p) => p.split('.'));
}

function patternMatchesAtOrBeyond(pattern: FilterPattern, path: readonly string[]): boolean {
  if (pattern.length > path.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '*' && pattern[i] !== path[i]) return false;
  }
  return true;
}

function pathLeadsToPattern(pattern: FilterPattern, path: readonly string[]): boolean {
  if (path.length >= pattern.length) return false;
  for (let i = 0; i < path.length; i++) {
    if (pattern[i] !== '*' && pattern[i] !== path[i]) return false;
  }
  return true;
}

/**
 * Walk `sdkConfig` applying include/exclude path filters.
 * Excluded subtrees become the string `'[Excluded]'` — the key stays so the
 * reader sees which fields were passed to the SDK.
 * Cycle-safe: repeated object references become `'[CIRCULAR]'`.
 */
export function applySdkConfigFilter(
  value: unknown,
  options: { include?: string[]; exclude?: string[] },
): unknown {
  const include = parsePatterns(options.include);
  const exclude = parsePatterns(options.exclude);
  if (!include && !exclude) return value;
  const seen = new WeakSet<object>();
  return walk(value, [], include, exclude, seen);
}

function walk(
  value: unknown,
  path: readonly string[],
  include: FilterPattern[] | undefined,
  exclude: FilterPattern[] | undefined,
  seen: WeakSet<object>,
): unknown {
  if (exclude?.some((p) => patternMatchesAtOrBeyond(p, path))) return EXCLUDED;
  if (include) {
    const atOrBeyond = include.some((p) => patternMatchesAtOrBeyond(p, path));
    const onPath = !atOrBeyond && include.some((p) => pathLeadsToPattern(p, path));
    if (!atOrBeyond && !onPath) return EXCLUDED;
    if (!atOrBeyond && (value === null || typeof value !== 'object')) return EXCLUDED;
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return FILTER_CIRCULAR;
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, [...path, String(i)], include, exclude, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = walk(v, [...path, k], include, exclude, seen);
  }
  return out;
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
  const showAdapterReady = options.showAdapterReady ?? true;
  const compactAdapterReady = options.compactAdapterReady ?? false;
  const sdkConfigInclude = options.sdkConfigInclude;
  const sdkConfigExclude = options.sdkConfigExclude;

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
    onAdapterReady(adapter, sdkConfig) {
      if (!showAdapterReady) return;
      const header = paint(ANSI.cyan, `[${adapter}] ready`);
      const filtered = applySdkConfigFilter(sdkConfig, {
        include: sdkConfigInclude,
        exclude: sdkConfigExclude,
      });
      if (compactAdapterReady) {
        write(`${header} ${JSON.stringify(filtered)}\n`);
      } else {
        write(`${header}\n${paint(ANSI.dim, JSON.stringify(filtered, null, 2))}\n`);
      }
    },
  };
}
