// Claude Code adapter — reference adapter, closest mapping to UnifiedEvent
// SDK: @anthropic-ai/claude-agent-sdk
// Auth: SDK manages internally (OAuth, cached credentials, ANTHROPIC_API_KEY)

// SDK is an optional peer dependency — import only types at the top level
// (erased at compile time) and load the runtime `query` value lazily inside
// execute(), so importing this module (and the package's main entry, which
// re-exports the adapter) never statically requires the SDK. Consumers needing
// the SDK's in-process MCP primitives import them directly from
// `@anthropic-ai/claude-agent-sdk` (createSdkMcpServer, tool).
import type { SDKMessage, SDKUserMessage, Options, Query, SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';
import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
  McpSdkServerConfig,
  UsageStats,
  TodoItem,
  UserInputRequest,
  UserInputResponse,
  UserInputHandler,
  UserInputQuestion,
  ElicitationRequest,
  ElicitationResponse,
  ImageInput,
} from '../types.js';
import { AdapterInitError, AdapterTimeoutError, AdapterAbortError } from '../types.js';
import { resolveModel, ADAPTIVE_THINKING_ONLY } from '../models.js';
import { redactSecrets } from '../redact.js';
import { checkPeerSdkVersion } from '../sdk-version.js';
import { materializeSkills, type MaterializedSkills } from '../skills-tempdir.js';
import { assertAnthropicMediaType, readImageAsBase64, readImageAsBase64Sync } from '../images-tempdir.js';
import { ensureUsableStdin } from '../stdin-guard.js';
import { validateSubagents } from '../subagents.js';
import { probePathScope, getClaudeSandboxConfig } from '../path-scope.js';

// Re-export generic MCP builder from the library
export { createMcpServer, mcpTool } from '../mcp.js';
export type {
  McpToolDefinition,
  McpToolHandler,
  McpToolResult,
  CreateMcpServerOptions,
  McpServerInstance,
} from '../mcp.js';

// --- Plan-mode tool filters ---
//
// planMode: true maps to a restricted-visibility config (Option B per the
// claude-code-sdk skill's "Permission model & read-only agents" section),
// NOT to SDK's permissionMode: 'plan' (which would also block the MCP tools
// a consumer deliberately wired up in params.mcpServers).
//
// The adapter hides mutating built-ins from the model's catalog via
// `tools` + `disallowedTools`, and leaves MCP servers (consumer-curated) free
// to execute under permissionMode: 'bypassPermissions'.
//
// When the SDK gains per-MCP-tool filtering at the options level, revisit —
// see the TODO in .claude/skills/claude-code-sdk/SKILL.md.
// Task-tracking tool family: TodoWrite (legacy, full-list-replace) plus the
// per-item CRUD tools newer Claude models ship instead (accumulated into a
// running snapshot — see mergeTaskToolInputIntoSnapshot below). Shared by the
// plan-mode allowlist and the assistant-message projection matcher so the two
// can never drift apart on a future rename — the same discipline already
// applied to the Task → Agent rename below. TaskCreate/TaskGet/TaskUpdate/
// TaskList are confirmed real tools with a fully-specified schema in
// `@anthropic-ai/claude-agent-sdk`'s `sdk-tools.d.ts` (TaskCreateInput etc.) —
// this is not speculative.
export const CLAUDE_CODE_TASK_TRACKING_TOOLS: string[] = [
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
];

export const CLAUDE_CODE_READONLY_BUILTINS: string[] = [
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  ...CLAUDE_CODE_TASK_TRACKING_TOOLS,
  // ToolSearch is presumed to be the discovery gate future models will use to
  // find deferred built-ins, including the TaskCreate/TaskUpdate family above.
  // Unlike those Task* names (confirmed in sdk-tools.d.ts, see above),
  // ToolSearch does not appear anywhere in the pinned SDK
  // (@anthropic-ai/claude-agent-sdk) today — this entry is precautionary and
  // unverified. Whitelisting a tool name the SDK doesn't recognize is
  // harmless, so keeping it costs nothing while guarding against the case
  // where it does ship and gates those tools' discoverability in plan mode.
  'ToolSearch',
  'AskUserQuestion',
  // Skill only loads a skill's body into context (read-only). Without it on the
  // plan-mode whitelist, inline skills materialized as a local plugin can never
  // be opened — the SDK reports "No such tool available: Skill". Any mutating
  // action a skill suggests is still gated by CLAUDE_CODE_MUTATING_BUILTINS.
  'Skill',
  // Subagent spawning is allowed in plan mode (read-only research, exploration).
  // We do NOT enforce read-only INSIDE a spawned subagent — a subagent doesn't
  // inherit the parent's disallowedTools, so a built-in general-purpose subagent
  // can still mutate. This matches native Claude Code plan-mode behaviour.
  // The tool was renamed Task→Agent (Claude Code v2.1.63): the SDK emits 'Agent'
  // in tool_use blocks but the system:init tools list still uses 'Task', so both
  // names must be whitelisted to expose it across SDK versions.
  'Task',
  'Agent',
];
export const CLAUDE_CODE_MUTATING_BUILTINS: string[] = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
];

// --- Debug logging ---

// Mirrors the codex pattern (src/adapters/codex.ts:debugUsage). Enable with:
//   AGENT_ADAPTERS_DEBUG_USAGE=1            ← any architecture
//   DEBUG=agent-adapters:claude-code        ← debug-style namespace
// Logs go to stderr so they don't pollute stdout streams.
function debugUsage(): boolean {
  const flag = process.env.AGENT_ADAPTERS_DEBUG_USAGE;
  if (flag && flag !== '0' && flag.toLowerCase() !== 'false') return true;
  const debug = process.env.DEBUG;
  if (debug && /(^|,)agent-adapters(:|,|$)|agent-adapters:claude-code/.test(debug)) return true;
  return false;
}

// --- Normalization helpers ---

function normalizeClaudeUsage(raw: unknown): UsageStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const apiInputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
  const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
  const cacheReadInputTokens = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined;
  const cacheCreationInputTokens = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : undefined;
  // Anthropic API exposes input_tokens, cache_read_input_tokens, and
  // cache_creation_input_tokens as three additive buckets. The unified
  // UsageStats follows OpenAI convention (see src/types.ts UsageStats JSDoc):
  // inputTokens = total posted to LLM on this turn, with cache fields as
  // SUBSETS (not separate). Roll the three buckets into a single inputTokens
  // so contextSize, the documented fresh formula, and cross-adapter
  // aggregation work uniformly. Cache fields are preserved for visibility.
  const inputTokens = apiInputTokens + (cacheReadInputTokens ?? 0) + (cacheCreationInputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
  };
}

/** @internal Exported for unit tests. */
export function normalizeContentBlocks(blocks: unknown[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const block of blocks) {
    const b = block as Record<string, unknown>;
    switch (b.type) {
      case 'text':
        result.push({ type: 'text', text: b.text as string });
        break;
      case 'thinking':
        result.push({ type: 'thinking', text: b.thinking as string });
        break;
      case 'tool_use':
        result.push({
          type: 'toolUse',
          toolUseId: b.id as string,
          toolName: b.name as string,
          input: (b.input as Record<string, unknown>) ?? {},
        });
        break;
      case 'tool_result':
        result.push({
          type: 'toolResult',
          toolUseId: b.tool_use_id as string,
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          isError: b.is_error as boolean | undefined,
        });
        break;
    }
  }
  return result;
}

/**
 * @internal Exported for unit tests.
 *
 * `betaMessage.usage` is per-response (non-cumulative) `BetaUsage` from the
 * Anthropic SDK — exposing it here lets consumers see per-turn cache behavior
 * instead of only the session-cumulative totals on the `result` event.
 */
export function normalizeAssistantMessage(msg: SDKMessage & { type: 'assistant' }): NormalizedMessage {
  const betaMessage = msg.message as unknown as Record<string, unknown>;
  const content = Array.isArray(betaMessage.content) ? betaMessage.content : [];
  const usage = normalizeClaudeUsage(betaMessage.usage);
  return {
    role: 'assistant',
    content: normalizeContentBlocks(content),
    timestamp: new Date().toISOString(),
    subagentTaskId: msg.parent_tool_use_id ?? undefined,
    ...(usage ? { usage } : {}),
    native: msg,
  };
}

/**
 * @internal Exported for unit tests.
 * Convert a raw TodoWrite `{ todos: [...] }` input payload into the unified
 * {@link TodoItem}[] representation. TodoWrite does not expose stable IDs,
 * so the array index is used — sufficient because every TodoWrite call
 * replaces the full list.
 */
export function todoItemsFromTodoWriteInput(input: Record<string, unknown>): TodoItem[] {
  const raw = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : [];
  return raw.map((t, idx) => ({
    id: String(idx),
    content: typeof t.content === 'string' ? t.content : '',
    ...(typeof t.activeForm === 'string' ? { activeForm: t.activeForm } : {}),
    status: (typeof t.status === 'string' ? t.status : 'pending') as TodoItem['status'],
  }));
}

/**
 * @internal Exported for unit tests.
 * Upsert a single task-tracking CRUD call (TaskCreate/TaskGet/TaskUpdate/
 * TaskList) into the running snapshot. Field names match the real tool
 * schema (`@anthropic-ai/claude-agent-sdk`'s `sdk-tools.d.ts`):
 * `TaskCreateInput`/`TaskUpdateInput` use `subject`/`description`, and
 * `TaskUpdateInput`/`TaskGetInput` key on `taskId` — never `id`, and
 * `TaskCreateInput` carries no identifier at all (the server only assigns
 * one in the `tool_result`, which this adapter does not parse). A created
 * item is keyed by its `toolUseId` instead, so it will NOT reconcile with a
 * later `TaskUpdate({ taskId: <real server id> })` referencing the same
 * task — a known limitation, tracked via a clarification patch on the
 * 0-0-5-to-0-0-6 brief.
 *
 * Returns `undefined` (no merge) when the call carries no writable field —
 * `TaskGet`'s `{ taskId }` and `TaskList`'s `{}` inputs never do. The caller
 * must then leave the `toolUse`/`tool_result` untouched: the real answer for
 * those two read verbs lives entirely in the `tool_result` payload (e.g.
 * `TaskListOutput.tasks`), which this function does not have access to and
 * this adapter does not parse — suppressing it here would silently discard
 * the only place that data exists.
 */
export function mergeTaskToolInputIntoSnapshot(
  snapshot: TodoItem[],
  toolUseId: string,
  input: Record<string, unknown>,
): TodoItem[] | undefined {
  const hasWritableField =
    typeof input.subject === 'string' ||
    typeof input.description === 'string' ||
    typeof input.activeForm === 'string' ||
    typeof input.status === 'string';
  if (!hasWritableField) return undefined;

  const explicitId =
    typeof input.taskId === 'string' ? input.taskId : typeof input.id === 'string' ? input.id : undefined;
  const id = explicitId ?? toolUseId;

  const next = snapshot.slice();
  const idx = next.findIndex((item) => item.id === id);
  const existing = idx >= 0 ? next[idx] : undefined;
  const content =
    typeof input.description === 'string'
      ? input.description
      : typeof input.subject === 'string'
        ? input.subject
        : (existing?.content ?? '');
  const merged: TodoItem = {
    id,
    content,
    ...(typeof input.activeForm === 'string'
      ? { activeForm: input.activeForm }
      : existing?.activeForm !== undefined
        ? { activeForm: existing.activeForm }
        : {}),
    status: (typeof input.status === 'string' ? input.status : (existing?.status ?? 'pending')) as TodoItem['status'],
  };
  if (idx >= 0) next[idx] = merged;
  else next.push(merged);
  return next;
}

function safeParseJson(s: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

// --- Streaming input channel ---

/**
 * Manually-driven `AsyncIterable<SDKUserMessage>` handed to `query()` in
 * streaming-input mode. The SDK pulls from it at turn boundaries; the adapter
 * pushes into it via `pushMessage()`. Closing it ends the conversation (the
 * SDK's next pull resolves `done`).
 */
interface InputChannel {
  iterable: AsyncIterable<SDKUserMessage>;
  /** Enqueue a message for the next SDK pull (no-op once closed). */
  enqueue(msg: SDKUserMessage): void;
  /** Close the channel — the SDK's next pull resolves `done`. */
  close(): void;
  /** True once `close()` has been called. */
  readonly closed: boolean;
  /** True if buffered messages are waiting to be pulled by the SDK. */
  hasPending(): boolean;
}

function buildUserMessage(content: string | unknown[]): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  } as SDKUserMessage;
}

/** Build a validated Anthropic base64 image block. */
function base64ImageBlock(mediaType: string, data: string): unknown {
  assertAnthropicMediaType(mediaType);
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

/**
 * Resolve `params.images` into Anthropic image content blocks. `file` sources are
 * read and inlined as base64 (the SDK accepts base64 + url, not local paths); all
 * base64 media types are validated against Anthropic's accepted set. Returns the
 * blocks to splice after the text block — never touches disk.
 */
export async function buildClaudeImageBlocks(images: ImageInput[]): Promise<unknown[]> {
  const blocks: unknown[] = [];
  for (const img of images) {
    if (img.type === 'base64') {
      blocks.push(base64ImageBlock(img.mediaType, img.data));
    } else if (img.type === 'url') {
      blocks.push({ type: 'image', source: { type: 'url', url: img.url } });
    } else {
      const { mediaType, data } = await readImageAsBase64(img.path, img.mediaType);
      blocks.push(base64ImageBlock(mediaType, data));
    }
  }
  return blocks;
}

/**
 * Synchronous twin of {@link buildClaudeImageBlocks}, used by the mid-turn push
 * path ({@link ClaudeCodeAdapter.pushMessage} returns a plain boolean and cannot
 * await). `file` sources are read with `readFileSync`; base64/url need no I/O.
 * Throws on an unsupported media type or unreadable file — the caller surfaces it.
 */
export function buildClaudeImageBlocksSync(images: ImageInput[]): unknown[] {
  const blocks: unknown[] = [];
  for (const img of images) {
    if (img.type === 'base64') {
      blocks.push(base64ImageBlock(img.mediaType, img.data));
    } else if (img.type === 'url') {
      blocks.push({ type: 'image', source: { type: 'url', url: img.url } });
    } else {
      const { mediaType, data } = readImageAsBase64Sync(img.path, img.mediaType);
      blocks.push(base64ImageBlock(mediaType, data));
    }
  }
  return blocks;
}

function createInputChannel(seed: SDKUserMessage): InputChannel {
  const queue: SDKUserMessage[] = [seed];
  let resolveNext: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  let closed = false;

  const iterable: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<SDKUserMessage>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
            resolveNext = resolve;
          });
        },
      };
    },
  };

  return {
    iterable,
    enqueue(msg) {
      if (closed) return;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined as never, done: true });
      }
    },
    get closed() {
      return closed;
    },
    hasPending() {
      return queue.length > 0;
    },
  };
}

// --- Adapter ---

export class ClaudeCodeAdapter implements RuntimeAdapter {
  architecture = 'claude-code' as const;
  private abortController: AbortController | null = null;
  /** Streaming-input push handler — set per-`execute()` when streamingInput is on. */
  private pushHandler: ((text: string, images?: ImageInput[]) => boolean) | null = null;
  /** Closes the active input channel (set per-`execute()` in streaming mode). */
  private closeInputChannel: (() => void) | null = null;
  /** Populated by factory when a provider is configured. */
  _providerConfig?: Record<string, unknown>;

  abort(): void {
    this.abortController?.abort();
    this.closeInputChannel?.();
  }

  /**
   * Push a user message into the live session mid-turn. See
   * {@link RuntimeAdapter.pushMessage}. Returns false when not in
   * streaming-input mode or the channel has closed (turn ended).
   *
   * Optional `images` are normalized into Anthropic content blocks the same way
   * the initial prompt's images are (synchronously — `file` sources are read with
   * `readFileSync`). Throws (synchronously) on an unsupported media type or
   * unreadable file; that is distinct from the `false` return, which means only
   * that the channel was closed.
   */
  pushMessage(text: string, images?: ImageInput[]): boolean {
    return this.pushHandler?.(text, images) ?? false;
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    // Self-heal a throwing `process.stdin` (Passenger/CageFS fd-0 EEXIST) before
    // anything imports the SDK or touches stdin. No-op when stdin is healthy.
    ensureUsableStdin();
    this.abortController = new AbortController();

    let resolvedModel: string;
    try {
      resolvedModel = resolveModel(this.architecture, params.model);
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err : new AdapterInitError('claude-code', err),
        phase: 'init',
      };
      return;
    }

    const options: Options = {
      abortController: this.abortController,
      model: resolvedModel,
      systemPrompt: params.systemPrompt,
      maxTurns: params.maxTurns,
      // planMode: true → hide mutating built-ins, leave MCP untouched (see
      // CLAUDE_CODE_READONLY_BUILTINS above). We deliberately do NOT set
      // permissionMode: 'plan' because it would also block consumer-curated
      // MCP tools, contradicting the RuntimeExecuteParams.planMode contract.
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      cwd: params.cwd ?? process.cwd(),
      includePartialMessages: true,
    };

    if (params.planMode) {
      options.tools = CLAUDE_CODE_READONLY_BUILTINS;
      options.disallowedTools = CLAUDE_CODE_MUTATING_BUILTINS;
    }

    // Programmatically-defined subagents → SDK Options.agents (Record<name, AgentDefinition>).
    // The Agent/Task tool is already whitelisted (incl. plan mode), so defined
    // agents are invocable without further tool wiring. The subagent `model` is
    // passed through verbatim — the SDK resolves aliases ('sonnet'/'opus'/...) —
    // so unified model IDs are NOT re-resolved here.
    if (params.subagents?.length) {
      validateSubagents(params.subagents);
      options.agents = Object.fromEntries(
        params.subagents.map((a) => [
          a.name,
          {
            description: a.description,
            prompt: a.prompt,
            ...(a.tools ? { tools: a.tools } : {}),
            ...(a.disallowedTools ? { disallowedTools: a.disallowedTools } : {}),
            ...(a.model ? { model: a.model } : {}),
            ...(a.skills ? { skills: a.skills } : {}),
            ...(a.maxTurns != null ? { maxTurns: a.maxTurns } : {}),
            ...(a.effort ? { effort: a.effort } : {}),
          },
        ]),
      ) as Options['agents'];
    }

    // Architecture-specific config (merge provider-resolved config with user-supplied config)
    const config = { ...this._providerConfig, ...params.architectureConfig };

    if (config.claude_thinking) {
      const mode = config.claude_thinking as 'adaptive' | 'enabled';
      const budget = config.claude_thinking_budget as number | undefined;
      const userDisplay = config.claude_thinking_display as 'summarized' | 'omitted' | undefined;
      // Opus 4.7 silently changed `thinking.display` default to 'omitted' (thinking blocks
      // arrive with an empty `thinking` field). Restore the Opus 4.6-style 'summarized'
      // default for adaptive-only models unless the consumer overrides it.
      const display: 'summarized' | 'omitted' | undefined =
        userDisplay ?? (ADAPTIVE_THINKING_ONLY.has(resolvedModel) ? 'summarized' : undefined);

      if (mode === 'enabled' && ADAPTIVE_THINKING_ONLY.has(resolvedModel)) {
        console.warn(
          `[agent-adapters] Model "${resolvedModel}" only supports adaptive thinking. ` +
            `Auto-converting 'enabled' → 'adaptive'.`,
        );
        options.thinking = { type: 'adaptive', ...(display ? { display } : {}) } as Options['thinking'];
      } else if (mode === 'enabled') {
        options.thinking = {
          type: 'enabled',
          ...(budget ? { budgetTokens: budget } : {}),
          ...(display ? { display } : {}),
        } as Options['thinking'];
      } else {
        options.thinking = { type: 'adaptive', ...(display ? { display } : {}) } as Options['thinking'];
      }
    }
    if (config.claude_effort) {
      options.effort = config.claude_effort as Options['effort'];
    }

    // Preset-based system prompt
    if (config.claude_usePreset) {
      const presetName =
        config.claude_usePreset === true || config.claude_usePreset === 'claude_code'
          ? 'claude_code'
          : (config.claude_usePreset as string);

      const presetObj: Record<string, unknown> = {
        type: 'preset',
        preset: presetName,
      };

      if (params.systemPrompt) {
        presetObj.append = params.systemPrompt;
      }

      (options as Record<string, unknown>).systemPrompt = presetObj;
    }

    // Custom environment variables — set by providers (MiniMax, Ollama, etc.)
    // Also supports legacy ollama_baseUrl for backward compatibility
    const customEnv = config.custom_env as Record<string, string> | undefined;
    if (customEnv || config.ollama_baseUrl) {
      options.env = {
        ...process.env,
        ...(config.ollama_baseUrl ? { ANTHROPIC_BASE_URL: config.ollama_baseUrl as string } : {}),
        ...customEnv,
      };
    }

    // MCP servers — SDK accepts all config types: stdio, SSE, HTTP, and SDK (in-process).
    // Our McpServerConfig union matches the SDK's McpServerConfig type.
    if (params.mcpServers && Object.keys(params.mcpServers).length > 0) {
      const sdkServers: Record<string, unknown> = {};
      for (const [name, serverConfig] of Object.entries(params.mcpServers)) {
        if ((serverConfig as McpSdkServerConfig).type === 'sdk') {
          // In-process SDK server — pass the instance directly
          const sdkConfig = serverConfig as McpSdkServerConfig;
          sdkServers[name] = { type: 'sdk', name: sdkConfig.name, instance: sdkConfig.instance };
        } else {
          // Stdio, SSE, HTTP — pass through as-is
          sdkServers[name] = serverConfig;
        }
      }
      (options as Record<string, unknown>).mcpServers = sdkServers;
    }

    // Allowed tools
    if (params.allowedTools) {
      options.allowedTools = params.allowedTools;
    }

    // Session resumption
    if (params.resumeSessionId) {
      options.resume = params.resumeSessionId;
    }

    // Filesystem path scoping (RuntimeExecuteParams.allowedPaths/disallowedPaths).
    // Soft default: allowedPaths → Options.additionalDirectories; disallowedPaths →
    // settings.permissions.deny Read/Edit rules. Deny outranks permissionMode in the
    // SDK precedence chain, so the deny rules survive our `bypassPermissions` default
    // (this is a model-visible/soft gate — nothing at the OS level stops a subprocess).
    // Opt-in `claude_sandbox.enabled` + a host with bubblewrap/seatbelt flips to
    // OS-syscall enforcement; without one, the hard guarantee degrades to soft.
    const pathScope = probePathScope('claude-code', params);
    if (pathScope.requested) {
      if (pathScope.allowed.length) {
        options.additionalDirectories = pathScope.allowed;
      }
      if (pathScope.disallowed.length) {
        const deny = pathScope.disallowed.flatMap((p) => [`Read(${p}/**)`, `Edit(${p}/**)`]);
        options.settings = { permissions: { deny } } as Options['settings'];
      }

      const sandbox = getClaudeSandboxConfig(config);
      if (sandbox?.enabled) {
        if (pathScope.strength === 'hard') {
          options.sandbox = {
            enabled: true,
            filesystem: {
              allowWrite: [...pathScope.allowed, ...(sandbox.filesystem?.allowWrite ?? [])],
              denyWrite: [...pathScope.disallowed, ...(sandbox.filesystem?.denyWrite ?? [])],
              denyRead: [...pathScope.disallowed, ...(sandbox.filesystem?.denyRead ?? [])],
              ...(sandbox.filesystem?.allowRead ? { allowRead: sandbox.filesystem.allowRead } : {}),
            },
          } as Options['sandbox'];
        } else {
          yield {
            type: 'warning',
            message:
              'claude-code: claude_sandbox.enabled was requested but this host has no OS sandbox ' +
              '(bubblewrap on Linux / seatbelt on macOS) — filesystem path scope degraded hard→soft. ' +
              'The gate is model-visible permission rules only, NOT OS-syscall enforced.',
          };
        }
      }
    }

    // User input — unified bridge covering two SDK-side channels:
    //  (a) AskUserQuestion tool (first-class model tool) via canUseTool
    //  (b) MCP elicitation (server-side side-channel) via options.onElicitation
    // Both are pumped through a single queue into the main event loop so we can
    // yield a UnifiedEvent, await the handler, and resolve the SDK promise.
    type PendingUserInput =
      | {
          kind: 'model-tool';
          req: UserInputRequest;
          resolveResponse: (r: UserInputResponse) => void;
        }
      | {
          kind: 'mcp-elicitation';
          req: UserInputRequest;
          legacy: ElicitationRequest;
          resolveResponse: (r: ElicitationResponse) => void;
        };
    const pendingUserInputs: PendingUserInput[] = [];
    let userInputWaker: (() => void) | null = null;

    // Streaming-input mode: messages accepted via pushMessage() that still need
    // a `user_message` event emitted into the loop. The push channel itself is
    // built below (just before query()); these two queues are drained together
    // at the top of the main loop and share the userInputWaker wake mechanism.
    const pendingPushEmits: { text: string; images?: ImageInput[]; timestamp: number }[] = [];

    // Resolve effective handler: onUserInput wins; otherwise bridge onElicitation.
    const effectiveUserInputHandler: UserInputHandler | undefined = params.onUserInput
      ? params.onUserInput
      : params.onElicitation
        ? async (req) => {
            const legacyResp = await params.onElicitation!({
              elicitationId: req.requestId,
              source: req.origin,
              message: req.questions[0]?.question ?? '',
              requestedSchema: (req.native as { requestedSchema?: Record<string, unknown> } | undefined)
                ?.requestedSchema,
              mode: (req.native as { mode?: 'form' | 'url' } | undefined)?.mode,
              url: (req.native as { url?: string } | undefined)?.url,
              native: req.native,
            });
            return {
              action: legacyResp.action,
              answers:
                legacyResp.action === 'accept' && legacyResp.content
                  ? [[JSON.stringify(legacyResp.content)]]
                  : undefined,
            };
          }
        : undefined;

    // (a) Intercept AskUserQuestion via canUseTool
    if (effectiveUserInputHandler) {
      options.canUseTool = (async (toolName: string, input: Record<string, unknown>, ctx: { toolUseID: string }) => {
        if (toolName !== 'AskUserQuestion') {
          return { behavior: 'allow', updatedInput: input } as const;
        }
        const rawQuestions = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
        const questions: UserInputQuestion[] = rawQuestions.map((q) => ({
          question: (q.question as string) ?? '',
          header: q.header as string | undefined,
          options: Array.isArray(q.options)
            ? (q.options as Record<string, unknown>[]).map((o) => ({
                label: (o.label as string) ?? '',
                description: o.description as string | undefined,
              }))
            : undefined,
          multiSelect: q.multiSelect as boolean | undefined,
        }));
        const req: UserInputRequest = {
          requestId: ctx.toolUseID,
          source: 'model-tool',
          origin: 'claude-code',
          questions,
          native: input,
        };
        const res = await new Promise<UserInputResponse>((resolve) => {
          pendingUserInputs.push({ kind: 'model-tool', req, resolveResponse: resolve });
          userInputWaker?.();
          userInputWaker = null;
        });
        // Translate the response into a canUseTool decision. Since SDK's PermissionResult
        // cannot carry a synthetic tool_result, we encode the answer in the deny `message`
        // so the model sees it as the tool's effective outcome.
        if (res.action === 'accept' && res.answers) {
          const formatted = questions
            .map((q, i) => {
              const answer = (res.answers?.[i] ?? []).join(', ');
              return `- ${q.question} → ${answer}`;
            })
            .join('\n');
          return {
            behavior: 'deny',
            message: `USER_ANSWER: The user responded to AskUserQuestion:\n${formatted}`,
          } as const;
        }
        return {
          behavior: 'deny',
          message: `USER_ANSWER: The user declined to answer (action=${res.action}).`,
        } as const;
      }) as Options['canUseTool'];
    }

    // (b) MCP elicitation — same queue, separate entry kind
    if (effectiveUserInputHandler) {
      options.onElicitation = (async (sdkReq: {
        serverName: string;
        message: string;
        mode?: 'form' | 'url';
        url?: string;
        elicitationId?: string;
        requestedSchema?: Record<string, unknown>;
      }) => {
        const legacy: ElicitationRequest = {
          elicitationId: sdkReq.elicitationId ?? `${sdkReq.serverName}-${Date.now()}`,
          source: sdkReq.serverName,
          message: sdkReq.message,
          requestedSchema: sdkReq.requestedSchema,
          mode: sdkReq.mode,
          url: sdkReq.url,
          native: sdkReq,
        };
        const req: UserInputRequest = {
          requestId: legacy.elicitationId,
          source: 'mcp-elicitation',
          origin: legacy.source,
          questions: [
            {
              question: legacy.message,
              placeholder: legacy.mode === 'url' ? legacy.url : undefined,
            },
          ],
          native: sdkReq,
        };
        const res = await new Promise<ElicitationResponse>((resolve) => {
          pendingUserInputs.push({ kind: 'mcp-elicitation', req, legacy, resolveResponse: resolve });
          userInputWaker?.();
          userInputWaker = null;
        });
        return { action: res.action, content: res.content };
      }) as Options['onElicitation'];
    }

    const rawMessages: NormalizedMessage[] = [];
    let sessionId: string | undefined;
    // parent_tool_use_id → task_id lookup. Populated on `system` subtype
    // `task_started`; read on every delta/tool event to resolve subagentTaskId.
    const subagentTaskIdByParentToolUseId = new Map<string, string>();
    // Track task-tracking tool_use IDs (TodoWrite or the TaskCreate/TaskGet/
    // TaskUpdate/TaskList family) so we can suppress their matching tool_result
    // (both the UnifiedEvent and the ContentBlock in rawMessages). That
    // tool_result payload is redundant with the snapshot already surfaced via
    // `todoList` / `todo_list_updated`.
    const pendingTodoToolUseIds = new Set<string>();
    // Scoped to this execute() call, so a resumed session starts with an
    // empty snapshot. TodoWrite is immune (the model always resends the full
    // list), but a TaskUpdate referencing a taskId created in a prior turn/
    // session has no existing entry to merge fields against and produces a
    // stub with blank content instead of the real one. Fixing this needs
    // session-level state persisted across execute() calls, out of scope here.
    let lastTodoSnapshot: TodoItem[] | undefined;

    // Timeout handling
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        this.abortController?.abort();
      }, params.timeoutMs);
    }

    // Materialize inline skills into a per-call tmpdir registered as a local
    // plugin. Cleanup runs in the finally below (covers normal completion,
    // SDK errors, and AbortController.abort()).
    let materialized: MaterializedSkills | undefined;
    if (params.skills?.length) {
      try {
        materialized = await materializeSkills(params.skills);
        const existing = (options as { plugins?: SdkPluginConfig[] }).plugins ?? [];
        (options as { plugins?: SdkPluginConfig[] }).plugins = [
          ...existing,
          { type: 'local', path: materialized.tmpRoot },
        ];
      } catch (err) {
        clearTimeout(timeoutId);
        yield { type: 'error', error: new AdapterInitError('claude-code', err), phase: 'init' };
        return;
      }
    }

    yield {
      type: 'adapter_ready',
      adapter: 'claude-code',
      sdkConfig: redactSecrets({ options }),
      ...(pathScope.requested ? { pathScope } : {}),
    };

    // Resolve attached images into Anthropic content blocks. query() accepts a
    // plain string or AsyncIterable<SDKUserMessage> — a string can't carry image
    // blocks and a lone SDKUserMessage isn't accepted, so any images force the
    // channel path (seeded then, when not streaming, closed immediately).
    let imageBlocks: unknown[] | null = null;
    if (params.images?.length) {
      try {
        imageBlocks = await buildClaudeImageBlocks(params.images);
      } catch (err) {
        clearTimeout(timeoutId);
        await materialized?.cleanup().catch(() => {});
        yield { type: 'error', error: new AdapterInitError('claude-code', err), phase: 'init' };
        return;
      }
    }
    const seedContent: string | unknown[] = imageBlocks
      ? [{ type: 'text', text: params.prompt }, ...imageBlocks]
      : params.prompt;

    // Streaming-input mode: feed the SDK an open channel seeded with the prompt
    // so pushMessage() can inject further user messages mid-conversation. When
    // off (default), the prompt is a one-shot string — identical to before,
    // unless images are present, which require the single-message channel.
    let inputChannel: InputChannel | null = null;
    if (params.streamingInput) {
      inputChannel = createInputChannel(buildUserMessage(seedContent));
      this.closeInputChannel = () => inputChannel!.close();
      this.pushHandler = (text: string, images?: ImageInput[]) => {
        if (inputChannel!.closed) return false;
        // Build image blocks BEFORE enqueueing: a bad image throws here, leaving
        // nothing half-delivered. base64/url need no I/O; `file` is read sync so
        // enqueue stays atomic w.r.t. the end-of-turn close check (see below).
        const blocks = images?.length ? buildClaudeImageBlocksSync(images) : null;
        const content: string | unknown[] = blocks
          ? [{ type: 'text', text }, ...blocks]
          : text;
        inputChannel!.enqueue(buildUserMessage(content));
        pendingPushEmits.push({ text, images, timestamp: Date.now() });
        // Wake the main loop so the user_message event is emitted promptly.
        userInputWaker?.();
        userInputWaker = null;
        return true;
      };
    } else if (imageBlocks) {
      // One-shot with images: seed a channel with the single image-bearing
      // message and close it immediately. The SDK pulls the seed then sees
      // `done` — exactly one result, one-shot contract preserved. No pushHandler.
      inputChannel = createInputChannel(buildUserMessage(seedContent));
      inputChannel.close();
    }

    let q: Query;
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const versionCheck = checkPeerSdkVersion('@anthropic-ai/claude-agent-sdk');
      if (versionCheck.status === 'mismatch') {
        clearTimeout(timeoutId);
        this.pushHandler = null;
        this.closeInputChannel = null;
        await materialized?.cleanup().catch(() => {});
        yield {
          type: 'error',
          error: new AdapterInitError('claude-code', new Error(versionCheck.message)),
          phase: 'init',
        };
        return;
      }
      if (versionCheck.status === 'undeterminable') {
        yield { type: 'warning', message: versionCheck.message! };
      }
      q = query({
        prompt: inputChannel ? inputChannel.iterable : params.prompt,
        options,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      this.pushHandler = null;
      this.closeInputChannel = null;
      await materialized?.cleanup().catch(() => {});
      yield { type: 'error', error: new AdapterInitError('claude-code', err), phase: 'init' };
      return;
    }

    try {
      const sdkIterator = q[Symbol.asyncIterator]();
      let pendingNext: Promise<IteratorResult<SDKMessage>> | null = null;

      // Main loop: race between SDK messages and pending user-input requests.
      loop: while (true) {
        // Drain pending user-input requests first. Each one yields a UnifiedEvent,
        // awaits the consumer handler, then resolves the SDK-side promise.
        while (pendingUserInputs.length > 0) {
          const pending = pendingUserInputs.shift()!;
          yield { type: 'user_input_request', request: pending.req };
          // Backwards-compat: also yield the legacy elicitation_request event.
          if (pending.kind === 'mcp-elicitation') {
            yield {
              type: 'elicitation_request',
              elicitationId: pending.legacy.elicitationId,
              source: pending.legacy.source,
              message: pending.legacy.message,
              requestedSchema: pending.legacy.requestedSchema,
              mode: pending.legacy.mode,
              url: pending.legacy.url,
            };
          }
          if (!effectiveUserInputHandler) {
            // Defensive: bridges are only registered when a handler exists.
            if (pending.kind === 'mcp-elicitation') {
              pending.resolveResponse({ action: 'decline' });
            } else {
              pending.resolveResponse({ action: 'decline' });
            }
            continue;
          }
          try {
            const res = await effectiveUserInputHandler(pending.req);
            if (pending.kind === 'model-tool') {
              pending.resolveResponse(res);
            } else {
              // Translate UserInputResponse → ElicitationResponse for the SDK callback.
              pending.resolveResponse({
                action: res.action,
                content:
                  res.action === 'accept' && res.answers && res.answers[0]?.[0]
                    ? safeParseJson(res.answers[0][0])
                    : undefined,
              });
            }
          } catch (err) {
            if (pending.kind === 'model-tool') {
              pending.resolveResponse({ action: 'cancel' });
            } else {
              pending.resolveResponse({ action: 'cancel' });
            }
            yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)), phase: 'runtime' };
          }
        }

        // Drain accepted mid-turn pushes: emit a user_message event for each
        // (the SDKUserMessage is already queued on the input channel; the SDK
        // picks it up at the next turn boundary).
        while (pendingPushEmits.length > 0) {
          const m = pendingPushEmits.shift()!;
          yield {
            type: 'user_message',
            text: m.text,
            ...(m.images?.length ? { images: m.images } : {}),
            timestamp: m.timestamp,
          };
        }

        if (!pendingNext) pendingNext = sdkIterator.next();

        // Race SDK's next message vs. a wake-up from the user-input bridge.
        const wake = new Promise<'wake'>((resolve) => {
          userInputWaker = () => resolve('wake');
        });
        const winner = await Promise.race([
          pendingNext.then((r) => ({ kind: 'sdk' as const, value: r })),
          wake.then(() => ({ kind: 'wake' as const })),
        ]);
        userInputWaker = null;

        if (winner.kind === 'wake') {
          // Loop back to drain block without consuming pendingNext.
          continue;
        }

        pendingNext = null;
        if (winner.value.done) break loop;
        const event = winner.value.value;

        if (this.abortController.signal.aborted) {
          if (timedOut) {
            yield { type: 'error', error: new AdapterTimeoutError('claude-code', params.timeoutMs!), phase: 'runtime' };
          } else {
            yield { type: 'error', error: new AdapterAbortError('claude-code'), phase: 'runtime' };
          }
          return;
        }

        sessionId = (event as Record<string, unknown>).session_id as string | undefined ?? sessionId;

        switch (event.type) {
          case 'stream_event': {
            const streamEvent = event.event as unknown as Record<string, unknown>;
            const parentToolUseId = event.parent_tool_use_id ?? undefined;
            const isSubagent = parentToolUseId != null;
            const subagentTaskId = parentToolUseId
              ? subagentTaskIdByParentToolUseId.get(parentToolUseId)
              : undefined;

            if (streamEvent.type === 'content_block_delta') {
              const delta = streamEvent.delta as Record<string, unknown>;
              if (delta.type === 'text_delta') {
                yield { type: 'text_delta', text: delta.text as string, isSubagent, subagentTaskId };
              } else if (delta.type === 'thinking_delta') {
                yield { type: 'thinking', text: delta.thinking as string, isSubagent, subagentTaskId };
              }
            }
            break;
          }

          case 'assistant': {
            const normalized = normalizeAssistantMessage(event);
            const parentToolUseId = event.parent_tool_use_id ?? undefined;
            const isSubagent = parentToolUseId != null;
            const subagentTaskId = parentToolUseId
              ? subagentTaskIdByParentToolUseId.get(parentToolUseId)
              : undefined;

            // Replace task-tracking `toolUse` blocks with unified `todoList`
            // blocks in-place so rawMessages and the assistant_message event
            // both carry the normalized shape. TodoWrite replaces the whole
            // snapshot. The newer TaskCreate/TaskGet/TaskUpdate/TaskList family
            // merges per-item instead — but TaskGet/TaskList carry no writable
            // field (mergeTaskToolInputIntoSnapshot returns undefined), so
            // those blocks are deliberately left untouched: their tool_use and
            // matching tool_result stay visible since the real answer for
            // those two read verbs lives in the tool_result, not this input.
            for (let i = 0; i < normalized.content.length; i++) {
              const block = normalized.content[i];
              if (block.type !== 'toolUse') continue;

              let items: TodoItem[] | undefined;
              if (block.toolName === 'TodoWrite') {
                items = todoItemsFromTodoWriteInput(block.input);
              } else if (CLAUDE_CODE_TASK_TRACKING_TOOLS.includes(block.toolName)) {
                items = mergeTaskToolInputIntoSnapshot(lastTodoSnapshot ?? [], block.toolUseId, block.input);
              }
              if (items === undefined) continue;

              pendingTodoToolUseIds.add(block.toolUseId);
              lastTodoSnapshot = items;
              normalized.content[i] = { type: 'todoList', items };
            }

            rawMessages.push(normalized);

            for (const block of normalized.content) {
              if (block.type === 'toolUse') {
                yield {
                  type: 'tool_use',
                  toolName: block.toolName,
                  toolUseId: block.toolUseId,
                  input: block.input,
                  isSubagent,
                  subagentTaskId,
                };
              } else if (block.type === 'todoList') {
                yield {
                  type: 'todo_list_updated',
                  items: block.items,
                  source: 'model-tool',
                  isSubagent,
                  subagentTaskId,
                };
              }
            }

            yield { type: 'assistant_message', message: normalized };
            break;
          }

          case 'user': {
            const userMsg = event as Record<string, unknown>;
            const parentToolUseId = (userMsg.parent_tool_use_id as string | undefined) ?? undefined;
            const isSubagent = parentToolUseId != null;
            const subagentTaskId = parentToolUseId
              ? subagentTaskIdByParentToolUseId.get(parentToolUseId)
              : undefined;
            const message = userMsg.message as Record<string, unknown>;
            if (message && Array.isArray(message.content)) {
              const rawContent = normalizeContentBlocks(message.content);
              // Strip tool_result blocks that correspond to a task-tracking
              // tool_use we already projected as `todo_list_updated`. That
              // tool_result payload is redundant and would leak the raw
              // TodoWrite/TaskCreate/etc. shape back into rawMessages / the
              // event stream.
              const content = rawContent.filter((block) => {
                if (block.type === 'toolResult' && pendingTodoToolUseIds.has(block.toolUseId)) {
                  pendingTodoToolUseIds.delete(block.toolUseId);
                  return false;
                }
                return true;
              });

              if (content.length === 0) break;

              const normalized: NormalizedMessage = {
                role: 'user',
                content,
                timestamp: new Date().toISOString(),
                native: event,
              };
              rawMessages.push(normalized);

              for (const block of normalized.content) {
                if (block.type === 'toolResult') {
                  yield {
                    type: 'tool_result',
                    toolUseId: block.toolUseId,
                    summary: block.content,
                    isSubagent,
                    isError: block.isError,
                    subagentTaskId,
                  };
                }
              }
            }
            break;
          }

          case 'tool_use_summary': {
            const parentToolUseId = ((event as Record<string, unknown>).parent_tool_use_id as string | undefined) ?? undefined;
            const isSubagent = parentToolUseId != null;
            const subagentTaskId = parentToolUseId
              ? subagentTaskIdByParentToolUseId.get(parentToolUseId)
              : undefined;
            yield {
              type: 'tool_result',
              toolUseId: event.preceding_tool_use_ids?.[0] ?? 'unknown',
              summary: event.summary,
              isSubagent,
              subagentTaskId,
            };
            break;
          }

          case 'system': {
            const subtype = (event as Record<string, unknown>).subtype as string;
            if (subtype === 'task_started') {
              const e = event as Record<string, unknown>;
              const taskId = e.task_id as string;
              const toolUseId = (e.tool_use_id as string) ?? '';
              if (toolUseId) subagentTaskIdByParentToolUseId.set(toolUseId, taskId);
              yield {
                type: 'subagent_started',
                taskId,
                description: e.description as string,
                toolUseId,
              };
            } else if (subtype === 'task_progress') {
              const e = event as Record<string, unknown>;
              yield {
                type: 'subagent_progress',
                taskId: e.task_id as string,
                description: e.description as string,
                lastToolName: e.last_tool_name as string | undefined,
              };
            } else if (subtype === 'task_notification') {
              const e = event as Record<string, unknown>;
              yield {
                type: 'subagent_completed',
                taskId: e.task_id as string,
                status: e.status as string,
                summary: e.summary as string | undefined,
                // Per-subagent total (sum across the subagent's turns).
                usage: normalizeClaudeUsage(e.usage),
              };
            } else if (subtype === 'compact_boundary') {
              yield { type: 'flush' };
            }
            break;
          }

          case 'result': {
            const resultEvent = event as Record<string, unknown>;
            if (resultEvent.subtype === 'success') {
              const claudeUsage = normalizeClaudeUsage(resultEvent.usage) ?? { inputTokens: 0, outputTokens: 0 };
              const contextSize = claudeUsage.inputTokens + claudeUsage.outputTokens;
              if (debugUsage()) {
                // Mirrors codex's `[agent-adapters codex] turn.completed` log.
                // Anthropic exposes input_tokens (fresh), cache_read_input_tokens,
                // and cache_creation_input_tokens as three additive buckets;
                // normalizeClaudeUsage rolls them into a single inputTokens
                // (OpenAI convention; see UsageStats JSDoc). This log shows
                // both the raw SDK shape and the normalized emit so cache
                // overlap / contextSize / fresh math can be verified.
                console.error('[agent-adapters claude-code] result', {
                  rawSdkUsage: resultEvent.usage,
                  normalizedUsage: claudeUsage,
                  contextSize,
                  sessionId,
                  resumed: params.resumeSessionId ?? null,
                });
              }
              yield {
                type: 'result',
                output: (resultEvent.result as string) ?? '',
                rawMessages,
                // Per-query() cumulative from the SDK (across turns/subagents within THIS query()
                // call). NOT cross-session — on options.resume, the SDK reports only this query()'s
                // tokens, not the original session combined. See:
                // https://code.claude.com/docs/en/agent-sdk/cost-tracking
                // Do not double-count with per-message usage on NormalizedMessage.
                usage: claudeUsage,
                contextSize,
                sessionId,
                ...(lastTodoSnapshot ? { todoListSnapshot: lastTodoSnapshot } : {}),
              };
            } else {
              yield { type: 'error', error: new Error((resultEvent.result as string) ?? 'Unknown error'), phase: 'runtime' };
            }
            // Streaming-input end-of-turn policy. The consumer just saw this
            // turn's result (or error) and may have called pushMessage()
            // synchronously in response; combined with any pushes that arrived
            // during the turn, a non-empty channel keeps the session open so the
            // SDK runs the queued message(s) as the next turn — execute() emits
            // another result. An empty channel is closed synchronously here:
            // this pins the race window shut, so a pushMessage() landing after
            // close returns false and the consumer re-dispatches after-turn.
            // No await runs between the result yield and this check, so the
            // decision is atomic w.r.t. consumer pushes — no lost-message window.
            if (inputChannel) {
              if (resultEvent.subtype === 'success' && inputChannel.hasPending()) {
                // keep open: SDK consumes the next queued message as a new turn
              } else {
                inputChannel.close();
              }
            }
            break;
          }

          default:
            break;
        }
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        if (timedOut) {
          yield { type: 'error', error: new AdapterTimeoutError('claude-code', params.timeoutMs!), phase: 'runtime' };
        } else {
          yield { type: 'error', error: new AdapterAbortError('claude-code'), phase: 'runtime' };
        }
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)), phase: 'runtime' };
    } finally {
      clearTimeout(timeoutId);
      // Tear down streaming-input state: detach the push handler so a late
      // pushMessage() returns false, and close the channel so the SDK isn't
      // left awaiting input.
      this.pushHandler = null;
      this.closeInputChannel = null;
      inputChannel?.close();
      await materialized?.cleanup().catch((err) =>
        console.warn('[agent-adapters] claude-code skill cleanup failed', err),
      );
    }
  }
}
