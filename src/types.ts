// @inharness-ai/agent-adapters — Core types
// Based on InHarness M04 spec (m04-orchestration.md)

import type { ArchitectureModelMap } from './models.js';
import type { ResolvedPathScope } from './path-scope.js';

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

/**
 * An image attached to the initial prompt via {@link RuntimeExecuteParams.images}.
 *
 * The `base64` and `url` members are byte-identical to the image `source` shape
 * emitted on output ({@link ContentBlock} `type: 'image'`), so a consumer reuses
 * the same vocabulary on both sides. `file` is input-only — a path to a local
 * image, read (or referenced) by the adapter at execute time.
 *
 * Per-adapter delivery (all four adapters supported; conversions are transparent):
 * - **claude-code**: `base64`/`url` → native image content block; `file` is read
 *   and inlined as base64. `mediaType` for base64 must be one of
 *   `image/jpeg|png|gif|webp` (Anthropic constraint) or the call errors.
 * - **gemini**: mapped to a `media` content part (`base64`/`file` → inline data,
 *   `url` → uri).
 * - **codex**: the SDK only accepts a local image PATH. `base64` is written to a
 *   temp file and `url` is downloaded to one (both removed after the call); `file`
 *   is passed through.
 * - **opencode**: the SDK accepts a `file` part with a `url`. `base64` is written
 *   to a temp file referenced as `file://…`; `file` becomes `file://<path>`;
 *   `url` is passed through (the OpenCode server runs locally and fetches it).
 *
 * `mediaType` is optional for the `file` source — when omitted it is inferred from
 * the file extension (default `image/png`).
 */
export type ImageInput =
  | { type: 'base64'; mediaType: string; data: string }
  | { type: 'url'; url: string }
  | { type: 'file'; path: string; mediaType?: string };

export interface NormalizedMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: string;
  subagentTaskId?: string;
  usage?: UsageStats;
  native?: unknown;
}

/**
 * Token counts for a single LLM turn / `execute()` call.
 *
 * Library-wide convention (OpenAI shape — applied uniformly across all
 * adapters by their normalization helpers):
 *   - `inputTokens` is the TOTAL input posted to the LLM on this turn,
 *     INCLUDING any tokens served from prompt cache and any tokens that
 *     wrote new cache entries.
 *   - `cacheReadInputTokens` is a SUBSET of `inputTokens` (overlap, not
 *     additive): tokens served from prompt cache, typically billed at a
 *     fraction of the full input rate.
 *   - `cacheCreationInputTokens` is a SUBSET of `inputTokens` (overlap, not
 *     additive): tokens that wrote new prompt-cache entries on this turn.
 *     Anthropic surfaces these; OpenAI does not.
 *   - "Fresh" input billed at the full rate:
 *       `inputTokens − (cacheReadInputTokens ?? 0) − (cacheCreationInputTokens ?? 0)`
 *
 * Per-adapter source of truth:
 *   - codex (OpenAI Responses API): `input_tokens` is already total; the
 *     `cached_input_tokens` sub-field maps to `cacheReadInputTokens`. The
 *     adapter additionally subtracts the prior cumulative on resumed turns
 *     (codex SDK reports session-cumulative usage; see `priorUsage` and the
 *     codex-sdk skill quirk #9).
 *   - claude-code (Anthropic): Anthropic's API exposes `input_tokens`,
 *     `cache_read_input_tokens`, and `cache_creation_input_tokens` as three
 *     additive buckets. The adapter rolls all three into a single
 *     `inputTokens` (and preserves the cache fields as subsets) so this
 *     contract holds.
 *   - gemini, opencode: SDKs do not currently surface a cache split; the
 *     reported `inputTokens` is whatever the underlying provider returns,
 *     and cache fields are absent.
 */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  /** Subset of `inputTokens` served from prompt cache. */
  cacheReadInputTokens?: number;
  /** Subset of `inputTokens` that wrote new prompt-cache entries (Anthropic). */
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
   *
   * `pathScope` (when path-scope was requested) is the runtime-resolved gate:
   * its `strength` ('hard' | 'soft' | 'none') is the enforcement this run
   * actually gets on this host — distinct from the static
   * `architectureCapabilities(adapter).pathScope` bool. Because `adapter_ready`
   * fires before the first SDK call, a consumer can confirm enforcement here
   * (or via {@link probePathScope} before calling `execute`) rather than relying
   * on a post-hoc warning.
   */
  | { type: 'adapter_ready'; adapter: Architecture; sdkConfig: Record<string, unknown>; pathScope?: ResolvedPathScope }
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
      /**
       * USAGE BILLING TOKENS — token cost of THIS `execute()` call only
       * (per-call delta). On a resumed session (`resumeSessionId`), this
       * does NOT include prior turns' usage — every wrapped SDK reports
       * per-call cost only. For Codex, where the underlying SDK reports
       * cumulative session usage in `turn.completed.usage`, the adapter
       * subtracts the prior cumulative to recover per-call delta (see
       * `RuntimeExecuteParams.priorUsage` and the codex-sdk skill quirk #9).
       *
       * Verified per @anthropic-ai/claude-agent-sdk cost-tracking docs
       * (https://code.claude.com/docs/en/agent-sdk/cost-tracking — "each
       * result only reflects the cost of that individual call… accumulate
       * the totals yourself") and per-adapter empirical resume tests.
       *
       * For session-level billing, sum `result.usage` across calls via
       * `sumUsage()` / `addUsage()` from the public API.
       *
       * NOT to be confused with USAGE CONTEXT WINDOW (`result.contextSize`):
       *   - billing (this field): how much you paid for THIS turn. Sum-of-
       *     billing across resumed turns can exceed the model's context
       *     window because replayed history is re-billed (at a cache-
       *     discounted rate where supported).
       *   - context window (`contextSize`): how full the model's context
       *     window is now. Bounded by the window — when full, the
       *     conversation must be compacted.
       *
       * For USD cost: claude-code's underlying SDK exposes `total_cost_usd`
       * natively (Anthropic price table); this library does not surface a
       * USD field — compute from token counts × the model's pricing if
       * needed.
       */
      usage: UsageStats;
      /**
       * USAGE CONTEXT WINDOW — total tokens occupying the model's context
       * window after this turn. Equals `usage.inputTokens + usage.outputTokens`
       * (also computable via `contextSize()` from the public API). Bounded by
       * the model's window size (e.g. 400k for `gpt-5-codex`, 200k for
       * `claude-sonnet-4.5`); see `MODEL_CONTEXT_WINDOWS` / `getModelContextWindow()`
       * for the per-model limit. Use this to render an IDE-style "X / 400k"
       * utilization bar.
       *
       * Do NOT sum across turns — take the LAST turn's value. Each turn's
       * `inputTokens` already includes the full conversation up to that
       * turn (replayed system + history posted to the LLM); adding
       * `outputTokens` (the assistant response just appended) gives the
       * post-turn conversation size.
       *
       * Distinct from `usage` (USAGE BILLING TOKENS) which is the per-call
       * cost of THIS turn — see the `usage` JSDoc above for the full
       * distinction.
       */
      contextSize: number;
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
   * A user message that was accepted into the live session mid-turn via
   * {@link RuntimeAdapter.pushMessage} (streaming-input mode). Emitted the
   * moment the push is accepted onto the open input channel — before the
   * model's response to it. Consumers persist this as a user message in the
   * conversation and forward it over their wire protocol so the rendered
   * order matches what the model saw.
   *
   * `images` echoes any images pushed alongside the text (same shape accepted by
   * {@link RuntimeExecuteParams.images}), so a consumer can render them in the
   * conversation history; absent when the push was text-only.
   *
   * Only emitted by adapters whose {@link architectureCapabilities} report
   * `midTurnPush: true` (currently claude-code) when run with
   * `RuntimeExecuteParams.streamingInput`.
   */
  | { type: 'user_message'; text: string; images?: ImageInput[]; timestamp: number }
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

/**
 * Inline skill definition passed at execute() time. Materialized to a tmpdir for
 * the duration of the call and removed in finally — no persistent files.
 *
 * Per-adapter mapping:
 * - claude-code: tmpdir registered as a `local` plugin (Options.plugins).
 * - gemini: passed as `Config.skills` SkillDefinition[] with `body` inline.
 * - opencode: mirrored to `<cwd>/.opencode/skills/agent-adapters-<uuid>-<slug>/SKILL.md`.
 * - codex: mirrored to `<cwd>/.agents/skills/agent-adapters-<uuid>-<slug>/SKILL.md`.
 */
export interface InlineSkill {
  /** kebab-case identifier, must be unique within the call */
  name: string;
  /** one-line summary shown to the model in the skill listing */
  description: string;
  /** Markdown body without frontmatter — the helper prepends frontmatter */
  content: string;
  /**
   * Additional files placed alongside SKILL.md in the same skill directory.
   * Keyed by relative path (POSIX-style separators); values are file contents.
   * Models can reference them with Read/Glob just like assets in a real
   * `.claude/skills/<name>/` directory. Keys must be relative, must not contain
   * `..` segments, and must not equal `SKILL.md` (use `content` for that).
   *
   * Caveat: Gemini consumes skills via `SkillDefinition.body` (single string),
   * so the gemini adapter emits a `console.warn` when this field is non-empty —
   * the extra files are written to disk but the model only sees `content`.
   */
  files?: Record<string, string>;
  /** Optional extra string/number/boolean keys merged into frontmatter */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Programmatically-defined subagent the model can invoke via the native agent
 * tool (claude-code's Agent/Task). Adapter-agnostic subset of what the
 * underlying SDK exposes; see per-adapter mapping below.
 *
 * Only honored by adapters whose {@link architectureCapabilities} report
 * `subagentDefinition: true` (currently claude-code*). Other adapters ignore
 * the definitions and emit a one-shot `warning` event — observing subagents is
 * still supported everywhere, only *defining* them is gated.
 *
 * Per-adapter mapping:
 * - claude-code: mapped 1:1 onto SDK `Options.agents[name]` (AgentDefinition).
 */
export interface SubagentDefinition {
  /** Unique identifier — the agent type the model invokes (e.g. "code-explorer"). */
  name: string;
  /** Natural-language description of WHEN to use this agent; shown to the model. */
  description: string;
  /** The subagent's system prompt. */
  prompt: string;
  /** Tool allow-list for the subagent. Omitted → inherits the parent's tools. */
  tools?: string[];
  /** Tool names explicitly disallowed for the subagent. */
  disallowedTools?: string[];
  /**
   * Model alias ('sonnet' | 'opus' | 'haiku') or full model ID. Omitted →
   * inherits the main model. Passed through to the SDK verbatim (the SDK
   * resolves aliases), so unified model IDs are NOT re-resolved here.
   */
  model?: string;
  /** Skill names to preload into the subagent's context. */
  skills?: string[];
  /** Max agentic turns the subagent may take. */
  maxTurns?: number;
  /** Reasoning effort level for the subagent. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface RuntimeExecuteParams<A extends Architecture = Architecture> {
  prompt: string;
  /**
   * Images attached to the initial `prompt`. Each is delivered to the underlying
   * SDK in its native form — see {@link ImageInput} for per-adapter mapping.
   * Adapters that must materialize an image to disk (codex, opencode) write it to
   * a temp dir removed when the call ends. Omitted/empty → identical to a
   * text-only prompt. Mid-turn images are also supported via
   * {@link RuntimeAdapter.pushMessage}'s `images` argument (claude-code).
   */
  images?: ImageInput[];
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

  /**
   * Inline skill definitions materialized to a tmpdir for this call only and
   * removed in `finally` (abort-safe). See {@link InlineSkill} for per-adapter wiring.
   */
  skills?: InlineSkill[];

  /**
   * Programmatically-defined subagents the model can invoke via the native
   * agent tool. Only honored by adapters whose {@link architectureCapabilities}
   * report `subagentDefinition: true` (currently claude-code*). Other adapters
   * ignore the field and emit a one-shot `warning` event.
   * See {@link SubagentDefinition} for the shape and per-adapter mapping.
   */
  subagents?: SubagentDefinition[];

  cwd?: string;
  /**
   * Filesystem path scoping for the agent's tools — an engine-neutral way to say
   * "this run may only read/write under these paths". Each adapter maps the intent
   * onto its SDK's native sandbox primitive (or, where it has none, emits a one-shot
   * `warning` and runs unscoped). Both fields absent/empty is a no-op (identical to
   * the pre-scoping behavior).
   *
   * - **Precedence:** `disallowedPaths` > `allowedPaths` > the implicit base (`cwd`).
   *   A path matched by `disallowedPaths` is blocked even if it sits inside an
   *   `allowedPaths` root.
   * - **Scope:** read AND write combined (no separate read/write split yet).
   * - **Relative entries are normalized, not rejected** — resolved against `cwd`
   *   before mapping.
   * - Composes **additively** with {@link planMode}: both only ever narrow access.
   * - **Immutable on resume:** changing either field on a resumed session is a
   *   violation (see {@link findResumeViolations}) — a sandbox must not be re-scoped
   *   mid-session; fork a new session instead.
   *
   * Whether an adapter honors these at all is advertised by
   * `architectureCapabilities(arch).pathScope`. The actual enforcement *strength*
   * (hard OS-syscall vs soft model-visible) is a separate, runtime-confirmable
   * signal — see {@link probePathScope} and the `adapter_ready` event's `pathScope`.
   */
  allowedPaths?: string[];
  disallowedPaths?: string[];
  /**
   * Resume a prior session/thread so this turn continues the same conversation.
   *
   * **Invariant:** `model` and the reasoning/thinking configuration must stay
   * constant across all turns of a resumed session. Adapters are stateless and do
   * NOT enforce this — changing them is the consumer's responsibility to prevent.
   * On claude-code it fails hard (Anthropic rejects a resumed turn whose thinking
   * config differs from the prior assistant message's immutable thinking blocks:
   * `400 ... thinking blocks ... cannot be modified`); on other adapters switching
   * model/reasoning mid-thread is still incorrect.
   *
   * Use {@link getSessionResumeConstraints} to know which fields to lock in your UI
   * once a thread is active, and {@link findResumeViolations} to detect (before this
   * call) whether the consumer changed an immutable field — in which case start a
   * NEW session instead of resuming.
   */
  resumeSessionId?: string;
  /**
   * Upper bound on internal LLM turns the adapter will let the SDK take
   * before terminating. Per-adapter semantics differ — read carefully:
   *
   * - **claude-code**: maps to SDK `Options.maxTurns`, which counts
   *   CUMULATIVELY across the resumed session — prior turns loaded from
   *   `resumeSessionId` are included in the counter. Passing a low value
   *   (e.g. `maxTurns: 1`) on a resumed call will typically error with
   *   "Reached maximum number of turns (N)" before the model can respond.
   *   For resumed calls either omit `maxTurns` or set it generously above
   *   the prior turn count. See claude-code-sdk SKILL.md.
   * - **gemini**: maps to `Config.maxSessionTurns`. `undefined` resolves to
   *   `-1` (no limit). Per-session semantics; same caveat may apply on
   *   resumed sessions.
   * - **codex**: ignored. Codex's `runStreamed` is naturally one
   *   `execute()` = one turn; the SDK has no equivalent option.
   * - **opencode**: ignored. The OpenCode SDK does not expose a turn cap.
   */
  maxTurns?: number;
  timeoutMs?: number;
  architectureConfig?: Record<string, unknown>;

  /**
   * Prior cumulative usage for this resumed thread, for cross-process scenarios.
   *
   * Codex SDK is the only wrapped SDK that reports session-level cumulative
   * usage in `turn.completed.usage` (openai/codex#17539); the codex adapter
   * converts it to per-`execute()` delta by subtracting the prior cumulative
   * tracked in a module-scoped LRU. In a single long-running process the LRU
   * works transparently. If your runtime spawns a new process per `execute()`
   * call (the LRU starts empty every turn), persist the previous turn's raw
   * cumulative on your side and pass it here so the per-call delta stays
   * accurate. Without `priorUsage` in a cross-process setup, the first
   * resumed-turn `result.usage` after each restart is the full session
   * cumulative — a known artifact of the LRU being in-memory only.
   *
   * Ignored by claude-code, gemini, opencode — those SDKs already report
   * per-`execute()` usage natively.
   */
  priorUsage?: UsageStats;

  /**
   * Opt into streaming-input mode. When true the adapter feeds the underlying
   * SDK an open `AsyncIterable` of user messages instead of a one-shot string
   * prompt, enabling {@link RuntimeAdapter.pushMessage} for mid-turn injection.
   * The initial `prompt` is seeded as the first message.
   *
   * In this mode `execute()` may yield MULTIPLE `result` events — one per
   * delivered turn — and the stream stays alive across turns until the input
   * channel drains (no pending pushes after a turn's `result`) or `abort()` is
   * called. With `streamingInput` absent/false the one-shot contract is
   * unchanged: a single `result` then the stream ends.
   *
   * Only honored by adapters whose {@link architectureCapabilities} report
   * `midTurnPush: true` (currently claude-code). Ignored elsewhere — those
   * adapters run the normal one-shot path and `pushMessage` returns false.
   */
  streamingInput?: boolean;

  /**
   * When true, adapter runs in plan-only mode: read-only tools allowed,
   * writes/edits/shell-mutations blocked. MCP servers listed in `mcpServers`
   * remain executable — the consumer is responsible for only passing read-only
   * servers in plan mode.
   *
   * Per-adapter mapping:
   * - claude-code: hides mutating built-ins (Bash, Edit, Write, NotebookEdit)
   *   from the model's catalog via `tools` + `disallowedTools` and runs under
   *   `permissionMode: 'bypassPermissions'`. Subagents (Task/Agent) ARE allowed
   *   in plan mode (read-only research); as in native Claude Code, read-only is
   *   NOT enforced inside a spawned subagent (it doesn't inherit the parent's
   *   disallowedTools). See the "Permission model & read-only agents" section in
   *   `.claude/skills/claude-code-sdk/SKILL.md` for why SDK's
   *   `permissionMode: 'plan'` is intentionally NOT used here.
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
  /**
   * Push a user message into the live session mid-turn (streaming-input mode).
   *
   * Returns `true` if the message was accepted onto the open input channel for
   * delivery, `false` if the channel is closed/closing (the turn ended) or the
   * adapter is not running with `RuntimeExecuteParams.streamingInput`. On
   * `false` the caller should re-dispatch the message after the turn as a fresh
   * `execute()` with `resumeSessionId` — there is no lost-message window, the
   * boolean tells you which path the message took.
   *
   * Optional `images` are normalized into the underlying SDK's image content the
   * same way {@link RuntimeExecuteParams.images} is for the initial prompt, and
   * echoed on the emitted `user_message` event. Resolution is synchronous (a
   * `file` source is read with `readFileSync`) so the boolean contract above is
   * preserved; an unsupported media type or unreadable file is thrown
   * synchronously — distinct from the `false` return (closed channel).
   *
   * Accepting a push emits a {@link UnifiedEvent} `{ type: 'user_message' }`.
   *
   * Optional: adapters without streaming-input support omit it. Check
   * {@link architectureCapabilities}`(arch).midTurnPush` before relying on it.
   */
  pushMessage?(text: string, images?: ImageInput[]): boolean;
}

export type AdapterFactory = () => RuntimeAdapter;

// --- Errors ---

export class AdapterError extends Error {
  /** OS error code (e.g. `EEXIST`) when the cause is a Node.js system error. */
  readonly code?: string;
  /** Negative OS errno when the cause is a Node.js system error. */
  readonly errno?: number;
  /** Failing syscall (e.g. `open`) when the cause is a Node.js system error. */
  readonly syscall?: string;
  /** Filesystem path involved, when the cause is a Node.js system error. */
  readonly path?: string;

  constructor(
    message: string,
    public readonly adapter: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
    // Hoist structured fields off the cause so they survive serialization.
    // `Error.message`/`.stack` are non-enumerable (dropped by JSON.stringify),
    // and a cause that crossed a worker/bridge boundary often arrives as a
    // bare `{ errno, code, syscall }` with its `path` and message gone. Lifting
    // these onto the instance (plus toJSON) makes the wire payload self-describing.
    const sys = extractSysError(cause);
    if (sys.code !== undefined) this.code = sys.code;
    if (sys.errno !== undefined) this.errno = sys.errno;
    if (sys.syscall !== undefined) this.syscall = sys.syscall;
    if (sys.path !== undefined) this.path = sys.path;
  }

  /** Serialization-safe shape: surfaces the human `message` and OS fields that
   *  a plain `JSON.stringify(error)` would otherwise drop. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      adapter: this.adapter,
      ...(this.code !== undefined ? { code: this.code } : {}),
      ...(this.errno !== undefined ? { errno: this.errno } : {}),
      ...(this.syscall !== undefined ? { syscall: this.syscall } : {}),
      ...(this.path !== undefined ? { path: this.path } : {}),
    };
  }
}

export class AdapterInitError extends AdapterError {
  constructor(adapter: string, cause?: unknown) {
    const reason = causeToReason(cause);
    const sys = extractSysError(cause);
    const hint = sys.code ? initHint(sys) : undefined;
    const message =
      `Failed to initialize ${adapter} adapter` +
      (reason ? `: ${reason}` : '') +
      (hint ? ` — ${hint}` : '');
    super(message, adapter, cause);
    this.name = 'AdapterInitError';
  }
}

/** Fields lifted from a Node.js system error (or a plain object shaped like one
 *  after losing its Error prototype crossing a worker/bridge boundary). */
interface SysErrorFields {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

function extractSysError(cause: unknown): SysErrorFields {
  if (!cause || typeof cause !== 'object') return {};
  const c = cause as Record<string, unknown>;
  const out: SysErrorFields = {};
  if (typeof c.code === 'string') out.code = c.code;
  if (typeof c.errno === 'number') out.errno = c.errno;
  if (typeof c.syscall === 'string') out.syscall = c.syscall;
  if (typeof c.path === 'string') out.path = c.path;
  return out;
}

/** Actionable, code-specific guidance for init-phase OS failures. */
function initHint(sys: SysErrorFields): string | undefined {
  const target = sys.path ? `\`${sys.path}\`` : 'the target file';
  switch (sys.code) {
    case 'EEXIST':
      return (
        `a leftover file already exists (${target}) — likely a stale temp/lock from a ` +
        'previously crashed run; remove it or point CLAUDE_CODE_TMPDIR / CLAUDE_CONFIG_DIR at a clean path'
      );
    case 'EACCES':
    case 'EPERM':
      return `permission denied for ${target} — check filesystem permissions and ownership`;
    case 'EROFS':
      return `read-only filesystem for ${target} — point CLAUDE_CODE_TMPDIR / CLAUDE_CONFIG_DIR at a writable path`;
    case 'ENOSPC':
      return `no space left on device while writing ${target}`;
    case 'ENOENT':
      return `a path component is missing for ${target} — check cwd and CLAUDE_CONFIG_DIR`;
    default:
      return undefined;
  }
}

function causeToReason(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (typeof cause === 'string') return cause || undefined;

  // Build the reason from structured OS fields so it stays useful even when the
  // native message was lost (bare `{ errno, code, syscall }` from a bridge).
  const sys = extractSysError(cause);
  if (sys.code) {
    if (cause instanceof Error && cause.message) {
      // Native message is richest; keep it, but ensure the code is visible.
      return cause.message.includes(sys.code) ? cause.message : `${sys.code}: ${cause.message}`;
    }
    const where = sys.syscall ? ` (${sys.syscall})` : '';
    const at = sys.path ? ` at ${sys.path}` : '';
    return `${sys.code}${where}${at}`;
  }

  if (cause instanceof Error) return cause.message || undefined;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
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
