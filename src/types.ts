// @inharness-ai/agent-adapters — Core types
// Based on InHarness M04 spec (m04-orchestration.md)

import type { ArchitectureModelMap } from './models.js';

// --- Content & Messages ---

/**
 * A single todo-list item as surfaced by the unified layer.
 *
 * `id` is always populated by the adapter:
 *  - opencode passes through the stable ID from the SSE `todo.updated` event.
 *  - claude-code synthesizes it from the item's index in the TodoWrite call
 *    (the SDK does not expose stable IDs, but position is deterministic
 *    within a single tool invocation).
 *
 * `status` is an open union — concrete statuses from the known SDKs are
 * enumerated, but adapters may propagate unknown values from future SDKs
 * without breaking the type.
 */
export interface TodoItem {
  id: string;
  content: string;
  /** Present-continuous label for the active step (claude-code only; UI may fall back to `content`). */
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | (string & {});
  /** Priority bucket (opencode only). */
  priority?: 'low' | 'medium' | 'high';
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'toolUse'; toolUseId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'toolResult'; toolUseId: string; content: string; isError?: boolean }
  | {
      type: 'image';
      source:
        | { type: 'base64'; mediaType: string; data: string }
        | { type: 'url'; url: string };
    }
  /**
   * Snapshot of the todo list at the moment this message was produced.
   *
   * Emitted in place of `toolUse` / `toolResult` pairs for TodoWrite-like tool
   * calls. Per-adapter origin:
   *   - claude-code: replaces `ContentBlock.toolUse` when `toolName === 'TodoWrite'`
   *     (and the matching `toolResult` is suppressed — its payload is redundant).
   *   - opencode:    synthesized from the SSE `todo.updated` session-state channel;
   *     wrapped in a `NormalizedMessage { role: 'assistant', native: undefined }` so
   *     consumers can filter `rawMessages` the same way across adapters.
   *   - codex, gemini: not emitted.
   */
  | { type: 'todoList'; items: TodoItem[] };

export interface NormalizedMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: string;
  subagentTaskId?: string;
  usage?: UsageStats;
  native?: unknown;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens read from prompt cache (Anthropic). */
  cacheReadInputTokens?: number;
  /** Input tokens that created cache entries (Anthropic). */
  cacheCreationInputTokens?: number;
}

// --- Unified Events ---

/**
 * `subagentTaskId` on the delta-like variants (`text_delta`, `thinking`,
 * `tool_use`, `tool_result`) matches the `taskId` of the surrounding
 * `subagent_started` envelope. Required for grouping when multiple subagents
 * run concurrently — `isSubagent: true` alone is too coarse.
 *
 * Per-adapter support:
 *   - claude-code: ✅ mapped from `parent_tool_use_id` via local lookup
 *   - gemini:      ✅ direct pass-through of `event.threadId`
 *   - opencode:    ⚠️ inferred from SSE ordering (single active subagent only)
 *   - codex:       ❌ SDK has no subagent concept — always `undefined`
 *
 * Graceful degradation: when a delta carries `isSubagent: true` but no
 * `subagentTaskId` (e.g. claude-code race before `task_started`, or upstream
 * SDK doesn't expose the ID), consumers should treat the event as belonging
 * to an unknown subagent rather than the parent.
 */
export type UnifiedEvent =
  /**
   * Snapshot of the SDK-native config object the adapter is about to hand to
   * its underlying library — emitted once per `run()`, right after config is
   * built and before the first SDK call.
   *
   * `sdkConfig` is intentionally adapter-specific (not unified): it is the
   * actual options/config object passed to e.g. `query({ options })` (claude-code),
   * `codex.startThread(opts)` (codex), `createOpencode({ config })` (opencode),
   * or `new Config(params)` (gemini). Consumers can diff this against their
   * `RuntimeExecuteParams` to see what the adapter kept, dropped, or overrode.
   *
   * Secrets are redacted by key name (see `src/redact.ts`). Unknown custom
   * fields whose names don't match the redaction regex are NOT filtered.
   */
  | { type: 'adapter_ready'; adapter: Architecture; sdkConfig: Record<string, unknown> }
  | { type: 'text_delta'; text: string; isSubagent: boolean; subagentTaskId?: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: unknown; isSubagent: boolean; subagentTaskId?: string }
  | { type: 'tool_result'; toolUseId: string; summary: string; isSubagent: boolean; isError?: boolean; subagentTaskId?: string }
  | { type: 'thinking'; text: string; isSubagent: boolean; replace?: boolean; subagentTaskId?: string }
  | { type: 'assistant_message'; message: NormalizedMessage }
  | { type: 'subagent_started'; taskId: string; description: string; toolUseId: string }
  | { type: 'subagent_progress'; taskId: string; description: string; lastToolName?: string }
  | { type: 'subagent_completed'; taskId: string; status: string; summary?: string; usage?: UsageStats }
  | {
      type: 'result';
      output: string;
      rawMessages: NormalizedMessage[];
      usage: UsageStats;
      sessionId?: string;
      /**
       * Last known snapshot of the todo list at run end. `undefined` means the
       * adapter never observed a todo update during this run (either the model
       * didn't use TodoWrite, or the adapter doesn't support todo tracking —
       * see capability matrix in `.claude/skills/unified-architecture/SKILL.md`).
       */
      todoListSnapshot?: TodoItem[];
    }
  /**
   * Error surfaced from the adapter. `phase` distinguishes errors raised while
   * the adapter is still wiring up config/auth/SDK (`'init'`, emitted before
   * `adapter_ready`) from errors during live SDK execution (`'runtime'`,
   * emitted after). Consumers can use this to decide whether the run ever got
   * off the ground. Optional for backwards compatibility with hand-constructed
   * events (e.g. in tests).
   */
  | { type: 'error'; error: Error; phase?: 'init' | 'runtime' }
  | { type: 'warning'; message: string }
  | { type: 'user_input_request'; request: UserInputRequest }
  /**
   * Unified todo-list update. Snapshot of the full list, not a delta.
   *
   * Per-adapter support:
   *   - claude-code: ✅ emitted in place of `tool_use { toolName: 'TodoWrite' }`
   *     (source: 'model-tool'). The matching `tool_result` is suppressed.
   *   - opencode:    ✅ emitted from the SSE `todo.updated` session-state channel
   *     (source: 'session-state'). The adapter additionally pushes a synthetic
   *     `NormalizedMessage` with a `todoList` content block so `rawMessages`
   *     reflects the update.
   *   - codex, gemini: ❌ never emitted — no native todo/plan primitive.
   */
  | {
      type: 'todo_list_updated';
      items: TodoItem[];
      /** `'model-tool'` = replaces a model tool_use; `'session-state'` = separate state channel. */
      source: 'model-tool' | 'session-state';
      isSubagent: boolean;
      subagentTaskId?: string;
    }
  | {
      /** @deprecated Use `user_input_request` with `source: 'mcp-elicitation'`. */
      type: 'elicitation_request';
      elicitationId: string;
      source: string;
      message: string;
      requestedSchema?: Record<string, unknown>;
      mode?: 'form' | 'url';
      url?: string;
    }
  | { type: 'flush' };

// --- Architecture ---

export type BuiltinArchitecture =
  | 'claude-code'
  | 'claude-code-ollama'
  | 'claude-code-minimax'
  | 'codex'
  | 'opencode'
  | 'opencode-openrouter'
  | 'gemini';
export type Architecture = BuiltinArchitecture | (string & {});

// --- Provider ---

/** Configuration for a custom API backend provider (e.g. MiniMax, Ollama, OpenRouter). */
export interface ProviderConfig {
  /** Provider name — used for preset resolution. */
  provider: string;
  /** API key for the provider. Falls back to provider-specific env vars if omitted. */
  apiKey?: string;
  /** Base URL override (provider presets have defaults). */
  baseUrl?: string;
  /** Model name override. */
  model?: string;
  /** Provider-specific options (e.g. region for MiniMax). */
  [key: string]: unknown;
}

/**
 * Provider preset — knows how to configure each adapter for a given backend.
 * Each provider resolves its config into adapter-specific `architectureConfig` keys.
 */
export interface ProviderPreset {
  name: string;
  /** Architectures this provider supports. */
  architectures: string[];
  /** Resolve provider config into architectureConfig entries for the given adapter. */
  resolve(architecture: string, config: ProviderConfig): Record<string, unknown>;
}

// --- MCP Server Config ---

/** Stdio-based MCP server — spawns a subprocess. */
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** SSE-based MCP server — connects via Server-Sent Events. */
export interface McpSseServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/** HTTP streaming MCP server — connects via streamable HTTP. */
export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * In-process MCP server — created via `createMcpServer()`.
 * The `instance` is an `McpServer` from `@modelcontextprotocol/sdk`.
 * Not serializable — contains a live server object.
 */
export interface McpSdkServerConfig {
  type: 'sdk';
  name: string;
  instance: unknown;
}

/** Union of all MCP server config types. */
export type McpServerConfig =
  | McpStdioServerConfig
  | McpSseServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfig;

// --- User Input (unified: model-tool ask-user + MCP elicitation) ---

/**
 * Where the request originated.
 * - 'model-tool': model invoked a first-class ask-user tool (e.g. AskUserQuestion / ask_user / opencode question.asked)
 * - 'mcp-elicitation': an MCP server emitted an `elicitation/request` side-channel notification
 */
export type UserInputSource = 'model-tool' | 'mcp-elicitation';

export interface UserInputOption {
  label: string;
  description?: string;
}

export interface UserInputQuestion {
  question: string;
  header?: string;
  /** Absent = free-form text input. Present = selectable choice. */
  options?: UserInputOption[];
  multiSelect?: boolean;
  /** Allow typing a custom answer on top of options. */
  allowCustom?: boolean;
  placeholder?: string;
}

export interface UserInputRequest {
  /** Stable id for correlating request and response. */
  requestId: string;
  source: UserInputSource;
  /** Adapter name for model-tool, MCP server name for mcp-elicitation. */
  origin: string;
  questions: UserInputQuestion[];
  /** Raw SDK request for adapter-specific consumers. */
  native?: unknown;
}

export interface UserInputResponse {
  action: 'accept' | 'decline' | 'cancel';
  /**
   * Per-question array of selected/entered values. `answers[i]` is the list of
   * selections for `questions[i]` (single-element for non-multi-select questions).
   * Empty / absent when action !== 'accept'.
   */
  answers?: string[][];
}

export type UserInputHandler = (req: UserInputRequest) => Promise<UserInputResponse>;

// --- Elicitation (deprecated — prefer UserInput* above) ---

/**
 * @deprecated Use {@link UserInputRequest}. Kept as an alias for backwards compatibility.
 * When both `onElicitation` and `onUserInput` are provided on `RuntimeExecuteParams`,
 * `onUserInput` wins and `onElicitation` is ignored.
 */
export interface ElicitationRequest {
  elicitationId: string;
  source: string;
  message: string;
  requestedSchema?: Record<string, unknown>;
  mode?: 'form' | 'url';
  url?: string;
  native?: unknown;
}

/** @deprecated Use {@link UserInputResponse}. */
export interface ElicitationResponse {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
}

/** @deprecated Use {@link UserInputHandler}. */
export type ElicitationHandler = (req: ElicitationRequest) => Promise<ElicitationResponse>;

// --- Runtime Adapter ---

export interface RuntimeExecuteParams<A extends Architecture = Architecture> {
  prompt: string;
  systemPrompt: string;
  model: A extends keyof ArchitectureModelMap ? ArchitectureModelMap[A] : string;
  allowedTools?: string[];

  /**
   * Names of builtin MCP servers to instantiate.
   * Consumer (e.g. InHarness CLI) should resolve these into concrete `mcpServers`
   * entries before calling the adapter. Adapters do not read this field directly.
   */
  builtinMCPServers?: string[];

  /**
   * Final filtered list of allowed MCP tool names.
   * Consumer should use this to filter tools when building MCP servers.
   * Adapters do not read this field directly — they receive pre-built servers via `mcpServers`.
   */
  allowedMCPTools?: string[];

  /** MCP servers to connect — adapters read this field. */
  mcpServers?: Record<string, McpServerConfig>;
  cwd?: string;
  resumeSessionId?: string;
  maxTurns?: number;
  timeoutMs?: number;
  architectureConfig?: Record<string, unknown>;

  /**
   * When true, adapter runs in plan-only mode: read-only tools allowed,
   * writes/edits/shell-mutations blocked. MCP servers listed in `mcpServers`
   * remain executable — the consumer is responsible for only passing read-only
   * servers in plan mode.
   *
   * Per-adapter mapping:
   * - claude-code: hides mutating built-ins (Bash, Edit, Write, NotebookEdit,
   *   Task) from the model's catalog via `tools` + `disallowedTools` and runs
   *   under `permissionMode: 'bypassPermissions'`. See the "Permission model &
   *   read-only agents" section in `.claude/skills/claude-code-sdk/SKILL.md`
   *   for why SDK's `permissionMode: 'plan'` is intentionally NOT used here.
   * - gemini: approvalMode='plan'
   * - codex: sandboxMode='read-only'
   * - opencode: no-op with warning
   */
  planMode?: boolean;

  /**
   * Unified callback invoked when:
   * (a) the model invokes a first-class ask-user tool (AskUserQuestion / ask_user / opencode question event), or
   * (b) an MCP server emits an `elicitation/request` side-channel notification.
   *
   * Supported per adapter:
   * - claude-code: AskUserQuestion tool + MCP elicitation
   * - opencode: native question events (question.asked/replied/rejected)
   * - gemini: AskUserTool via MessageBus — only activated when this callback is provided
   *   (otherwise `ask_user` remains excluded to preserve current behavior)
   * - codex: not supported; passing the callback emits a one-shot warning event
   *
   * When both `onUserInput` and the deprecated `onElicitation` are provided,
   * `onUserInput` takes precedence and `onElicitation` is ignored.
   */
  onUserInput?: UserInputHandler;

  /**
   * @deprecated Use {@link onUserInput}. Retained for backwards compatibility;
   * bridged internally to `onUserInput` when the new handler is not provided.
   */
  onElicitation?: ElicitationHandler;
}

export interface RuntimeAdapter {
  architecture: Architecture;
  execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent>;
  abort(): void;
}

export type AdapterFactory = () => RuntimeAdapter;

// --- Errors ---

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly adapter: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class AdapterInitError extends AdapterError {
  constructor(adapter: string, cause?: unknown) {
    super(`Failed to initialize ${adapter} adapter`, adapter, cause);
    this.name = 'AdapterInitError';
  }
}

export class AdapterTimeoutError extends AdapterError {
  constructor(adapter: string, timeoutMs: number) {
    super(`${adapter} adapter timed out after ${timeoutMs}ms`, adapter);
    this.name = 'AdapterTimeoutError';
  }
}

export class AdapterAbortError extends AdapterError {
  constructor(adapter: string) {
    super(`${adapter} adapter was aborted`, adapter);
    this.name = 'AdapterAbortError';
  }
}

// --- Contract Testing ---

export interface ContractAssertion {
  name: string;
  passed: boolean;
  message?: string;
}

export interface ContractResult {
  scenario: string;
  passed: boolean;
  events: UnifiedEvent[];
  assertions: ContractAssertion[];
}
