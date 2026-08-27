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
  SubagentStatus,
} from '../types.js';
import {
  AdapterInitError,
  AdapterTimeoutError,
  AdapterAbortError,
  AdapterBackgroundHoldExpiredError,
  type AdapterError,
} from '../types.js';
import { resolveModel, ADAPTIVE_THINKING_ONLY } from '../models.js';
import { redactSecrets } from '../redact.js';
import { checkPeerSdkVersion } from '../sdk-version.js';
import { materializeSkills, type MaterializedSkills } from '../skills-tempdir.js';
import { assertAnthropicMediaType, readImageAsBase64, readImageAsBase64Sync } from '../images-tempdir.js';
import { ensureUsableStdin } from '../stdin-guard.js';
import { validateSubagents, mapSubagentStatus } from '../subagents.js';
import { probePathScope, getClaudeSandboxConfig } from '../path-scope.js';
import {
  checkToolPolicy,
  resolveDeniedGroups,
  isPorousCombination,
  porousCombinationWarning,
} from '../tool-groups.js';
import type { ToolGroup } from '../tool-groups.js';
import {
  createTaskRegistry,
  createBackgroundHold,
  projectBackgroundTasks,
  BACKGROUND_WAKEUP_GRACE_MS,
  MAX_BACKGROUND_HOLD_MS,
} from './claude-code.background-hold.js';

import { claimSdkMcpInstances, releaseSdkMcpInstances, mcpInstanceReuseError } from '../mcp.js';

// Re-export generic MCP builder from the library
export { createMcpServer, mcpTool } from '../mcp.js';
export type {
  McpToolDefinition,
  McpToolHandler,
  McpToolResult,
  CreateMcpServerOptions,
  McpServerInstance,
} from '../mcp.js';

// --- Subagent status (M06) ---
//
// The SDK's `SDKTaskNotificationMessage.status` union, mapped onto the unified
// `subagent_completed.status` vocabulary. It is a CLOSED three-value union on the
// verified pin (`completed | failed | stopped`), and `stopped` is native here —
// `Query.stopTask()` is the per-task lever, distinct from a run-level abort — so it
// maps straight onto unified `'stopped'` rather than being collapsed into `'aborted'`.
//
// Anything outside this table is handled by `mapSubagentStatus`, not by this table:
// cancellation-shaped spellings (the `cancelled`/`canceled` the `task_updated` channel
// already shows) become `'aborted'`, and everything else becomes `'failed'` plus one
// drift warning per run. Never `'completed'` — see ../subagents.ts.
const SDK_TASK_STATUS_MAP: Record<string, SubagentStatus> = {
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
};

// --- Built-in tool gating (M18) ---
//
// The consumer declares deny-GROUPS; this table is the only place claude-code's
// SDK tool identifiers are mapped onto them. Groups are engine-neutral, the
// identifiers are not — the mapping always runs group → identifiers, never the
// reverse.
//
// DENY-SHAPED OUTSIDE, ALLOW-SHAPED INSIDE. The adapter derives a RESIDUAL
// ALLOW-LIST on `options.tools` from the non-denied groups and sets
// `options.disallowedTools` only as a backstop. That ordering matters: a bare
// deny enumeration is fail-OPEN on the next built-in Anthropic ships, whereas an
// allow-list blocks a tool this library has never heard of. This is the M18
// residual-allow-list invariant, and it is asserted on the shape handed to the
// SDK, not merely on today's tool set.
//
// The deny rides `options.tools` + `options.disallowedTools` and NEVER the
// `settings.permissions.allow`/`deny` surface, because that surface is shared
// with M15 soft path-scope and with `autoApproveTools` and could therefore be
// re-widened by them. SDK `permissionMode: 'plan'` is still avoided for the
// original reason: it would also defer consumer-curated MCP tools, which M18
// explicitly does not gate.
//
// Every group here is 'soft' — this removes tools from the model's catalog,
// which is a model-behaviour gate, not a sandbox. See src/tool-groups.ts.

/** Task-tracking tool family: TodoWrite (legacy, full-list-replace) plus the
 *  per-item CRUD tools newer Claude models ship instead (accumulated into a
 *  running snapshot — see mergeTaskToolInputIntoSnapshot below). Shared by the
 *  residual allow-list and the assistant-message projection matcher so the two
 *  can never drift apart on a future rename — the same discipline applied to the
 *  Task → Agent rename below. TaskCreate/TaskGet/TaskUpdate/TaskList are
 *  confirmed real tools with a fully-specified schema in
 *  `@anthropic-ai/claude-agent-sdk`'s `sdk-tools.d.ts` (TaskCreateInput etc.) —
 *  this is not speculative. */
export const CLAUDE_CODE_TASK_TRACKING_TOOLS: string[] = [
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
];

/**
 * Built-ins belonging to each gated group. Renamed/relocated built-ins list
 * EVERY spelling: a deny that names only one of two live aliases silently fails
 * to fire, and on the allow-list side an unlisted alias silently disappears.
 */
export const CLAUDE_CODE_TOOL_GROUPS: Record<ToolGroup, string[]> = {
  // A background-process inspection tool IS shell — it reads the output of an
  // OS command. `KillBash` was renamed `KillShell`; both are named.
  shell: ['Bash', 'BashOutput', 'KillBash', 'KillShell'],
  'file-read': ['Read', 'Grep', 'Glob', 'NotebookRead'],
  // `save_memory`-equivalent persistence counts as a write.
  'file-write': ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
  web: ['WebFetch', 'WebSearch'],
};

/**
 * Built-ins that belong to no gated group and stay available whatever is denied:
 * task tracking, tool discovery, asking the user, and delegation.
 *
 * `Skill` is NOT here — it is conditional. A skill routinely instructs the model
 * to run shell commands, so leaving the tool available under a `shell` deny
 * reopens the group through the front door; it is dropped in that one case and
 * kept otherwise (without it, inline skills materialized as a local plugin can
 * never be opened — the SDK reports "No such tool available: Skill").
 *
 * `Task`/`Agent`: the tool was renamed Task→Agent (Claude Code v2.1.63); the SDK
 * emits 'Agent' in tool_use blocks but the system:init tools list still uses
 * 'Task', so both names must be present to expose it across SDK versions.
 * Delegation stays available under a deny because the run's denies are
 * propagated into every subagent definition (see buildSubagentTools below) —
 * without that propagation "deny the shell" would mean "deny the shell until the
 * model delegates".
 *
 * `ToolSearch` is presumed to be the discovery gate future models will use to
 * find deferred built-ins, including the TaskCreate/TaskUpdate family. It does
 * not appear anywhere in the pinned SDK today — this entry is precautionary.
 * Whitelisting a tool name the SDK doesn't recognize is harmless.
 */
export const CLAUDE_CODE_UNGATED_BUILTINS: string[] = [
  ...CLAUDE_CODE_TASK_TRACKING_TOOLS,
  'ToolSearch',
  'AskUserQuestion',
  'Task',
  'Agent',
];

/** Every built-in this library knows about. */
export function claudeCodeKnownBuiltins(): string[] {
  return [
    ...CLAUDE_CODE_UNGATED_BUILTINS,
    'Skill',
    ...Object.values(CLAUDE_CODE_TOOL_GROUPS).flat(),
  ];
}

/**
 * The residual allow-list + its deny backstop for a set of denied groups.
 *
 * Returns `undefined` when nothing is denied — the caller must then leave
 * `options.tools`/`options.disallowedTools` unset entirely, so a run with no
 * gating is byte-for-byte identical to the pre-M18 behaviour.
 */
export function buildClaudeCodeToolPolicy(
  deniedGroups: readonly ToolGroup[],
): { allow: string[]; deny: string[] } | undefined {
  if (deniedGroups.length === 0) return undefined;
  const denied = new Set(deniedGroups);

  const deny = deniedGroups.flatMap((g) => CLAUDE_CODE_TOOL_GROUPS[g]);
  const allow = [
    ...CLAUDE_CODE_UNGATED_BUILTINS,
    // A skill is a shell-shaped instruction channel; suppress it with the shell.
    ...(denied.has('shell') ? [] : ['Skill']),
    ...(Object.keys(CLAUDE_CODE_TOOL_GROUPS) as ToolGroup[])
      .filter((g) => !denied.has(g))
      .flatMap((g) => CLAUDE_CODE_TOOL_GROUPS[g]),
  ];
  return { allow, deny };
}

/**
 * Intersect one subagent definition's toolset with the run's effective policy.
 *
 * `tools` (the definition's own allow-list) is narrowed to what the run still
 * permits; when the definition names none, it inherits the run's residual
 * allow-list rather than the SDK's full default. `disallowedTools` unions the
 * run's denied built-ins on top of the definition's own, as a backstop matching
 * the parent run's shape.
 *
 * Returns the definition's fields unchanged when the run denies nothing.
 */
export function subagentToolPolicy(
  agent: { tools?: string[]; disallowedTools?: string[] },
  toolPolicy: { allow: string[]; deny: string[] } | undefined,
): { tools?: string[]; disallowedTools?: string[] } {
  if (!toolPolicy) {
    return {
      ...(agent.tools ? { tools: agent.tools } : {}),
      ...(agent.disallowedTools ? { disallowedTools: agent.disallowedTools } : {}),
    };
  }
  const allowed = new Set(toolPolicy.allow);
  const tools = agent.tools ? agent.tools.filter((t) => allowed.has(t)) : toolPolicy.allow;
  const disallowedTools = [...new Set([...(agent.disallowedTools ?? []), ...toolPolicy.deny])];
  return { tools, disallowedTools };
}

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
 * `TaskCreateInput` carries no identifier at all: the engine assigns one and
 * reports it in the create's `tool_result` (`"Task #1 created successfully:
 * <subject>"`), which a later `TaskUpdate({ taskId: '1' })` then keys on. A
 * created item is keyed by its `toolUseId`, so the caller passes
 * `serverIdAliases` — assigned id → the `toolUseId` of the create that produced
 * it — and an update reconciles with the item it belongs to. Without that alias
 * the update would append a second, content-less item and the real one would
 * never change status (M16).
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
  serverIdAliases?: ReadonlyMap<string, string>,
): TodoItem[] | undefined {
  const hasWritableField =
    typeof input.subject === 'string' ||
    typeof input.description === 'string' ||
    typeof input.activeForm === 'string' ||
    typeof input.status === 'string';
  if (!hasWritableField) return undefined;

  const explicitId =
    typeof input.taskId === 'string' ? input.taskId : typeof input.id === 'string' ? input.id : undefined;
  // An engine-assigned id resolves back to the create that produced it; an id we
  // have never seen assigned is used as-is (it may name a task from an earlier
  // turn, which this snapshot cannot have).
  const id = (explicitId ? serverIdAliases?.get(explicitId) : undefined) ?? explicitId ?? toolUseId;

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

/**
 * @internal Exported for unit tests.
 * Recover the id the engine assigned to a freshly created task from its `TaskCreate`
 * tool_result. Every later `TaskUpdate` keys on that id, so losing it makes the
 * update append a second, blank-titled item while the real one never changes status
 * (M16).
 *
 * This reads ENGLISH PROSE out of an unstructured payload, which is a poor contract:
 * a reworded CLI string reinstates the bug silently. It is mitigated two ways —
 * several phrasings are accepted rather than one, and the caller has a positional
 * fallback for when none match — but the right fix is upstream, in a structured
 * tool_result. Recorded as such in M16.
 *
 * A JSON payload is preferred when present, since that needs no guessing at all.
 */
export function extractAssignedTaskId(content: string): string | undefined {
  const structured = safeParseJson(content);
  for (const key of ['taskId', 'task_id', 'id']) {
    const v = structured?.[key];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }

  const patterns = [
    // "Task #1 created successfully: <subject>" — verbatim on 0.3.153 and 0.3.210.
    /task\s*#\s*([\w.-]+)\s+created/i,
    // "Created task 1: <subject>" / "Created task #1"
    /created\s+task\s*#?\s*([\w.-]+)/i,
    // "Task 1 created" — the same sentence without the hash.
    /task\s+([\w.-]+)\s+created/i,
    // "task_id: 1" / "taskId=1" anywhere in the blob.
    /task[_\s]?id["'\s]*[:=]["'\s]*([\w.-]+)/i,
  ];
  for (const re of patterns) {
    const candidate = re.exec(content)?.[1];
    // Guard against capturing a word out of the surrounding sentence — "task was
    // created" would otherwise yield "was". Real ids are numeric ("1") or long
    // opaque handles; an English word is neither.
    if (candidate && (/\d/.test(candidate) || candidate.length >= 8)) return candidate;
  }
  return undefined;
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

/**
 * Read a millisecond knob off `architectureConfig`. Three outcomes, and the
 * distinction between the last two is the point:
 *
 *  - a finite number above zero → that value;
 *  - `null` or `Infinity` → `null`, the DISARM SENTINEL. An explicit, unambiguous
 *    "I do not want this bound"; the run is then bounded by `timeoutMs`/`abort()`
 *    alone. Consumers had no way to say this before — every non-positive value was
 *    read as a mistake — which left them no escape hatch from a bound that could
 *    end their run;
 *  - anything else (`0`, a negative, a string) → the measured default. Those really
 *    are mistakes, and silently degrading a bound to "no protection" on a typo is
 *    worse than ignoring the typo.
 */
function msOption(raw: unknown, fallback: number): number | null {
  if (raw === null || raw === Number.POSITIVE_INFINITY) return null;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// --- Background tasks (M17) ---
//
// The task registry, the `result.backgroundTasks` projection and the bounded
// control-channel hold live in `./claude-code.background-hold.js` — a self-contained
// state machine rather than a step of the run. Re-exported here because this module
// is the adapter's public face and the two bounds are part of its documented surface.
export {
  BACKGROUND_WAKEUP_GRACE_MS,
  MAX_BACKGROUND_HOLD_MS,
  classifyTaskType,
  createTaskRegistry,
  createBackgroundHold,
  projectBackgroundTasks,
} from './claude-code.background-hold.js';
export type { TaskKind, TaskRegistry, BackgroundHold, HoldExpiry } from './claude-code.background-hold.js';

// --- Adapter ---

/**
 * Everything about ONE `execute()` that a later `abort()`/`pushMessage()` has to be
 * able to reach.
 *
 * It used to be four fields on the adapter, each overwritten by the next
 * `execute()`. Two concurrent runs on one adapter therefore clobbered each other:
 * the second run's `AbortController` replaced the first's, so `abort()` could only
 * ever reach the most recent one and the earlier run became unstoppable — its CLI
 * subprocess included. Making the state per-run means `abort()` can address every
 * live run rather than "whichever started last".
 */
interface RunContext {
  abortController: AbortController;
  /** Streaming-input push handler — set when `streamingInput` is on. */
  pushHandler: ((text: string, images?: ImageInput[]) => boolean) | null;
  /** Closes this run's input channel. */
  closeInputChannel: (() => void) | null;
  /** Live SDK query handle. Drives cooperative teardown. */
  activeQuery: Query | null;
  /** SDK-type MCP server instances this run holds a claim on (see src/mcp.ts). */
  claimedMcpInstances: readonly object[];
}

export class ClaudeCodeAdapter implements RuntimeAdapter {
  architecture = 'claude-code' as const;
  /** Every `execute()` currently in flight on this adapter instance. */
  private readonly runs = new Set<RunContext>();
  /** The most recently started run — the one `pushMessage()` addresses. */
  private latestRun: RunContext | null = null;
  /** Populated by factory when a provider is configured. */
  _providerConfig?: Record<string, unknown>;

  /**
   * Stop every run this adapter has in flight. The signature names no run, and a
   * silently-unstoppable run is the worse failure of the two readings, so it stops
   * all of them rather than guessing which one the caller meant.
   */
  abort(): void {
    for (const run of [...this.runs]) {
      this.interruptRun(run);
      run.abortController.abort();
      run.closeInputChannel?.();
    }
  }

  /**
   * Ask the engine to stop the current turn cooperatively, so the CLI unwinds
   * its own turn instead of dying mid-write when the transport goes. Reachable
   * on *every* run: the SDK refuses `interrupt()` unless the prompt is an input
   * channel, and since M11 the adapter drives all runs through one.
   *
   * Deliberately fire-and-forget. It is a control-protocol round-trip over the
   * very stdin the next two teardown lines close, so it can easily outlive its
   * own transport and never settle. The termination guarantee (M13) therefore
   * rests on the abort controller and on settling outstanding user-input
   * requests with `cancel` — never on this call. Awaiting it here would hand a
   * hang to the one path whose job is to end one.
   */
  private interruptRun(run: RunContext): void {
    try {
      void run.activeQuery?.interrupt().catch(() => {});
    } catch {
      // A query already past its final turn rejects synchronously — nothing left to stop.
    }
  }

  /**
   * Drop a finished run so a later `abort()` cannot reach into it. Also detaches its
   * push handler, so a `pushMessage()` arriving after teardown returns `false`
   * instead of enqueueing into a channel nobody reads.
   */
  private forgetRun(run: RunContext): void {
    run.pushHandler = null;
    run.closeInputChannel = null;
    run.activeQuery = null;
    this.runs.delete(run);
    if (this.latestRun === run) this.latestRun = null;
  }

  /**
   * Push a user message into the live session mid-turn. See
   * {@link RuntimeAdapter.pushMessage}. Returns false when not in
   * streaming-input mode or the channel has closed (turn ended).
   *
   * Addresses the MOST RECENTLY STARTED run. With one run in flight — the shape the
   * contract is written for — that is simply "the run"; with several, the choice has
   * to be made somewhere and the newest is the only one the caller can have just
   * learned about. `abort()` deliberately differs and reaches all of them.
   *
   * Optional `images` are normalized into Anthropic content blocks the same way
   * the initial prompt's images are (synchronously — `file` sources are read with
   * `readFileSync`). Throws (synchronously) on an unsupported media type or
   * unreadable file; that is distinct from the `false` return, which means only
   * that the channel was closed.
   */
  pushMessage(text: string, images?: ImageInput[]): boolean {
    return this.latestRun?.pushHandler?.(text, images) ?? false;
  }

  /**
   * Owns this run's REGISTRATION, and nothing else — the run itself is
   * {@link runSession}.
   *
   * The split exists because `execute()` is a generator, and a consumer that stops
   * iterating early (a `break` on a warning, say) unwinds it with `.return()`. That
   * runs `finally` blocks the generator is currently suspended INSIDE, and nothing
   * else: a yield sitting outside `runSession`'s own try — the peer-SDK version
   * warning, the sandbox-degradation warning — would abandon the run with its
   * `RunContext` still in `this.runs` and its MCP instances still claimed. The claim
   * is process-global, so that leak poisons every LATER run using the same server:
   * each one fails at init with "already connected to another run". Delegating
   * through `yield*` inside a try/finally makes teardown reachable from every
   * suspension point. The releases inside `runSession` stay — they free things at
   * the moment they stop being needed rather than at teardown — and both are
   * idempotent, so running them twice is a no-op.
   */
  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    // Self-heal a throwing `process.stdin` (Passenger/CageFS fd-0 EEXIST) before
    // anything imports the SDK or touches stdin. No-op when stdin is healthy.
    ensureUsableStdin();

    // Per-run state, so two concurrent execute() calls on one adapter cannot clobber
    // each other's abort handles (see RunContext). Registered here rather than at
    // query() time because every early return between here and there must still be
    // abortable — and must still be deregistered, which `forgetRun` does.
    const run: RunContext = {
      abortController: new AbortController(),
      pushHandler: null,
      closeInputChannel: null,
      activeQuery: null,
      claimedMcpInstances: [],
    };
    this.runs.add(run);
    this.latestRun = run;

    try {
      yield* this.runSession(params, run);
    } finally {
      this.forgetRun(run);
      releaseSdkMcpInstances(run.claimedMcpInstances);
    }
  }

  private async *runSession(params: RuntimeExecuteParams, run: RunContext): AsyncIterable<UnifiedEvent> {
    // Built-in tool gating (M18) — the pre-dispatch gate. Runs before model
    // resolution and before anything touches the SDK: fail-closed means nothing
    // is dispatched, not that the run is torn down after starting. Delivered as
    // an `error` event, never a throw (M01/M13: the iterator never throws).
    const policyError = checkToolPolicy(this.architecture, params);
    if (policyError) {
      this.forgetRun(run);
      yield { type: 'error', error: policyError, phase: 'init' };
      return;
    }
    const { groups: deniedGroups } = resolveDeniedGroups(params);
    const toolPolicy = buildClaudeCodeToolPolicy(deniedGroups);
    const shellDenied = deniedGroups.includes('shell');

    // Denying reads or writes while the shell stays live is not a filesystem
    // boundary — say so once, and let the run proceed.
    if (isPorousCombination(deniedGroups)) {
      yield { type: 'warning', message: porousCombinationWarning(this.architecture, deniedGroups) };
    }

    let resolvedModel: string;
    try {
      resolvedModel = resolveModel(this.architecture, params.model);
    } catch (err) {
      this.forgetRun(run);
      yield {
        type: 'error',
        error: err instanceof Error ? err : new AdapterInitError('claude-code', err),
        phase: 'init',
      };
      return;
    }

    // Filesystem path scoping decides this run's permission posture. Under a SOFT
    // gate (no OS sandbox) we MUST drop `bypassPermissions`: it auto-approves every
    // visible tool, so `permissions.deny` never fires and confinement is impossible.
    // Instead switch to a default-deny `dontAsk` mode confined by explicit allow/deny
    // rules (built in the path-scope block below). Outside path-scope — and under a
    // HARD OS sandbox, where the kernel enforces — we keep `bypassPermissions`.
    const pathScope = probePathScope('claude-code', params);
    const softScope = pathScope.requested && pathScope.strength === 'soft';

    const options: Options = {
      abortController: run.abortController,
      model: resolvedModel,
      systemPrompt: params.systemPrompt,
      maxTurns: params.maxTurns,
      // We deliberately do NOT set permissionMode: 'plan' — it would also block
      // consumer-curated MCP tools, which M18 explicitly does not gate. Tool
      // gating rides `tools`/`disallowedTools` instead (see below).
      permissionMode: softScope ? 'dontAsk' : 'bypassPermissions',
      ...(softScope ? {} : { allowDangerouslySkipPermissions: true }),
      cwd: params.cwd ?? process.cwd(),
      includePartialMessages: true,
    };

    // Built-in tool gating (M18). `toolPolicy` is undefined when nothing is
    // denied, and both fields are then left unset so the run is byte-for-byte
    // what it was before this feature existed.
    if (toolPolicy) {
      options.tools = toolPolicy.allow;
      options.disallowedTools = toolPolicy.deny;
    }

    // Programmatically-defined subagents → SDK Options.agents (Record<name, AgentDefinition>).
    // The Agent/Task tool stays available under a deny, so defined agents are
    // invocable without further tool wiring. The subagent `model` is passed
    // through verbatim — the SDK resolves aliases ('sonnet'/'opus'/...) — so
    // unified model IDs are NOT re-resolved here.
    //
    // M18 PROPAGATION IS MANDATORY. A subagent does not natively inherit the
    // parent's denies, so without this "deny the shell" would mean "deny the
    // shell until the model delegates". A definition may narrow its own toolset
    // but may never widen past the run's effective policy — the intersection
    // wins, SILENTLY: a definition naming a tool from a denied group is not an
    // error and does not fail the run, including definitions authored before
    // tool gating existed.
    if (params.subagents?.length) {
      validateSubagents(params.subagents);
      options.agents = Object.fromEntries(
        params.subagents.map((a) => [
          a.name,
          {
            description: a.description,
            prompt: a.prompt,
            ...subagentToolPolicy(a, toolPolicy),
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

    // Auto-approval. A deny always outranks it: a tool in a denied group stays
    // denied even when the consumer named it here, so denied names are stripped
    // rather than passed through to the SDK's permission allow-list.
    if (params.autoApproveTools?.length) {
      const denied = new Set(toolPolicy?.deny ?? []);
      options.allowedTools = params.autoApproveTools.filter((t) => !denied.has(t));
    }

    // Session resumption
    if (params.resumeSessionId) {
      options.resume = params.resumeSessionId;
    }

    // Filesystem path scoping (RuntimeExecuteParams.allowedPaths/disallowedPaths).
    // Soft gate: realise allow-CONFINEMENT bound to `cwd ∪ allowedPaths` (NOT a bare
    // deny-list) via the default-deny `dontAsk` mode set on `options` above, plus
    // explicit Read/Edit/Write allow rules for the ceiling and deny rules for
    // disallowedPaths. A bare deny under `bypassPermissions` was decorative — bypass
    // auto-approves everything, so the deny never fired and out-of-ceiling reads/writes
    // (and a Bash-`cat` bypass) leaked. Opt-in `claude_sandbox.enabled` + a host with
    // bubblewrap/seatbelt flips to OS-syscall enforcement (hard); that branch, below,
    // is left as-is and keeps `bypassPermissions` since the kernel enforces.
    if (pathScope.requested) {
      // Config-discovery containment: exclude the global `~/.claude` ('user') tier so
      // ambient global settings / on-disk skill discovery cannot re-widen the agent's
      // reach. Inline skills ride on `options.plugins` and are unaffected.
      options.settingSources = ['project', 'local'];

      if (pathScope.allowed.length) {
        options.additionalDirectories = pathScope.allowed;
      }

      // Soft gate only. Under the hard OS sandbox (below) the kernel enforces, so we
      // leave that path untouched rather than layering model-visible rules onto it.
      if (softScope) {
        // The M18 deny is applied LAST on this shared rule surface and is never
        // re-widened by a path-scope allow rule: a tool in a denied group gets
        // no allow rule generated for it at all. (`options.disallowedTools`
        // already removes it from the catalog; this keeps the two surfaces from
        // contradicting each other, which is exactly why the deny does not ride
        // `permissions.allow`/`deny` itself.)
        const deniedGroupSet = new Set(deniedGroups);
        const fsRules = (p: string) =>
          [
            ...(deniedGroupSet.has('file-read') ? [] : [`Read(${p}/**)`]),
            ...(deniedGroupSet.has('file-write') ? [] : [`Edit(${p}/**)`, `Write(${p}/**)`]),
          ];
        const ceiling = [params.cwd ?? process.cwd(), ...pathScope.allowed];
        const allow = ceiling.flatMap(fsRules);
        // Deny rules stay complete regardless — a carve-out must still be denied
        // for a group that is otherwise allowed.
        const deny = pathScope.disallowed.flatMap((p) => [
          `Read(${p}/**)`,
          `Edit(${p}/**)`,
          `Write(${p}/**)`,
        ]);
        options.settings = { permissions: { allow, deny } } as Options['settings'];
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

    // Background-task disable lever (M17, L3). The SDK exposes no option to
    // forbid backgrounding, so the lever is a PreToolUse hook denying any Bash
    // call that asks for it. The deny reason tells the model what to do instead,
    // so the command runs synchronously inside the turn rather than failing.
    if (config.claude_disallowBackgroundBash === true) {
      const existingHooks = (options.hooks ?? {}) as Record<string, unknown[]>;
      options.hooks = {
        ...existingHooks,
        PreToolUse: [
          ...(existingHooks.PreToolUse ?? []),
          {
            matcher: 'Bash',
            hooks: [
              async (input: unknown) => {
                const toolInput = (input as { tool_input?: Record<string, unknown> }).tool_input;
                if (toolInput?.run_in_background !== true) return { continue: true };
                return {
                  continue: true,
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason:
                      'Background execution is disabled for this run (claude_disallowBackgroundBash). ' +
                      'Re-run the command without run_in_background and wait for it to finish.',
                  },
                };
              },
            ],
          },
        ],
      } as Options['hooks'];
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

    /**
     * Settle a pending request without an answer. `'cancel'` and `'decline'` are the
     * two shapes both response types share, so one call site covers both variants —
     * TypeScript will not narrow the union's `resolveResponse` down to a common
     * signature on its own, and writing the branch out inline meant three copies of
     * an if/else whose arms were character-for-character identical.
     */
    const settleUnanswered = (p: PendingUserInput, action: 'cancel' | 'decline'): void => {
      if (p.kind === 'model-tool') p.resolveResponse({ action });
      else p.resolveResponse({ action });
    };

    /**
     * Settle EVERY outstanding request and empty the queue. Idempotent, so the
     * teardown that always runs it costs nothing when the drain already did.
     *
     * The invariant it exists for: a promise the SDK is awaiting must never outlive
     * the run. Each entry holds an unresolved promise the SDK parked a `canUseTool`
     * or `onElicitation` call on, and resolving it is the only thing that lets that
     * call — and the closure behind it — go.
     */
    const settleAllPending = (action: 'cancel' | 'decline' = 'cancel'): void => {
      for (const p of pendingUserInputs.splice(0)) settleUnanswered(p, action);
    };

    // Settles when this run is aborted (explicitly or by `timeoutMs`). Raced
    // against everything the loop can park on — the SDK's next message and the
    // consumer's user-input handler — so abort() is enforceable even when the
    // other side never responds. Never rejects.
    const abortSignal = run.abortController.signal;
    const abortPromise = new Promise<'abort'>((resolve) => {
      if (abortSignal.aborted) resolve('abort');
      else abortSignal.addEventListener('abort', () => resolve('abort'), { once: true });
    });

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
    // The SDK multiplexes real subagents and engine-backgrounded side work onto
    // ONE `task_*` channel, and only `task_started` carries the discriminator
    // (`task_type`) — `task_progress` / `task_notification` carry just the id.
    // So the kind is captured once here and every later message for that id is
    // routed through it: subagent kinds → `subagent_*` (M06), shell/monitor/
    // workflow → `background_task_*` (M17). See ./claude-code.background-hold.ts
    // for the settlement invariant this registry enforces.
    const tasks = createTaskRegistry();
    /**
     * Whether this run has already reported an unrecognized SDK task status. The M06
     * drift signal is at most ONE `warning` per run, however many unknown statuses
     * arrive during it. Per-RUN, not module-level: a module-level flag would leak
     * across runs and suppress the next run's signal entirely.
     */
    let unknownSubagentStatusWarned = false;
    // Track task-tracking tool_use IDs (TodoWrite or the TaskCreate/TaskGet/
    // TaskUpdate/TaskList family) so we can suppress their matching tool_result
    // (both the UnifiedEvent and the ContentBlock in rawMessages). That
    // tool_result payload is redundant with the snapshot already surfaced via
    // `todoList` / `todo_list_updated`.
    const pendingTodoToolUseIds = new Set<string>();
    // `TaskCreate` tool_use ids awaiting their tool_result, which is where the
    // engine reports the id it assigned, plus the resulting alias
    // (assigned id → the toolUseId the snapshot keys that item by).
    const taskCreateToolUseIds = new Set<string>();
    const serverTaskIdToToolUseId = new Map<string, string>();
    // TaskCreates whose tool_result did not name an assigned id, oldest first. The
    // last-resort reconciliation: with exactly one outstanding and a TaskUpdate
    // arriving for an id we have never seen, the two must be the same task, so the
    // alias can be recovered without the engine having said so in prose. Ambiguous
    // cases (two or more outstanding) are left alone rather than guessed.
    const unresolvedTaskCreateToolUseIds: string[] = [];
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
    /**
     * Why this run is ending, once something has aborted it. All three arrive at the
     * same place — a tripped `AbortController` — so the reason has to be carried
     * alongside, and every exit path must report the SAME one. It is a single
     * closure because there are four such paths and they used to hold three copies
     * of the same ternary, which is exactly how a fourth reason gets added to some
     * of them and not the others.
     */
    let backgroundHoldExpiredAfterMs: number | null = null;
    const terminalRuntimeError = (): AdapterError =>
      timedOut
        ? new AdapterTimeoutError('claude-code', params.timeoutMs!)
        : backgroundHoldExpiredAfterMs !== null
          ? new AdapterBackgroundHoldExpiredError('claude-code', backgroundHoldExpiredAfterMs)
          : new AdapterAbortError('claude-code');
    /**
     * End this run the one way it is allowed to end abnormally: settle whatever the
     * SDK is still awaiting, CLOSE EVERY SUBAGENT THIS RUN STILL HAS OPEN, then yield
     * the terminal error. Callers `return` straight after.
     *
     * The flush is the M06 obligation: a run-level termination — `abort()`,
     * `timeoutMs`, a background hold-cap expiry — must not leave a `subagent_started`
     * without its counterpart, or a consumer pairing them live waits forever for a
     * cleanup step that never fires. It reports on the ADAPTER'S TRACKING, not on the
     * subagent: it says this run stopped tracking that delegation, not that the helper
     * agent's own execution ended.
     *
     * Deliberately the opposite of the `background_task_*` rule. Background work
     * outlives the run and only the engine can honestly report its completion, so a
     * remaining background task is ABANDONED on a cap expiry. A subagent ends WITH the
     * run, so the adapter is the party that can report its end truthfully — hence the
     * `isBackground` filter below. Synthesizing a subagent event for a backgrounded
     * shell command would be a category error.
     *
     * `tasks.settle()` removes from `inFlight`, so a subagent that already reported its
     * own `task_notification` is naturally absent here — which is how "at most one
     * `subagent_completed` per `subagent_started`" falls out of the data structure
     * rather than out of a second bookkeeping set. It also settles the open probe about
     * `Query.interrupt()`: if the SDK settles an in-flight task as `'stopped'`, that
     * status is the one reported and this flush cannot overwrite it. Note this is the
     * registry's `inFlight`, NOT the `kindById` map behind `tasks.kind()` — that map
     * never drops an entry (late notifications still have to route), so walking it
     * would re-close every subagent the run ever started.
     *
     * It is ONE generator called from every terminal site for the same reason
     * `terminalRuntimeError()` above is one closure: those exit paths used to hold
     * copies of the same ternary, and that is exactly how a fifth path gets half the
     * teardown.
     */
    const endRunTerminally = function* (): Generator<UnifiedEvent> {
      settleAllPending();
      for (const taskId of [...tasks.inFlight]) {
        if (tasks.kind(taskId)?.isBackground) continue;
        yield { type: 'subagent_completed', taskId, status: 'aborted' };
      }
      yield { type: 'error', error: terminalRuntimeError(), phase: 'runtime' };
    };
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        this.interruptRun(run);
        run.abortController.abort();
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
        this.forgetRun(run);
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
    // blocks, which is one of the reasons every run rides the channel path
    // (see the channel construction below).
    let imageBlocks: unknown[] | null = null;
    if (params.images?.length) {
      try {
        imageBlocks = await buildClaudeImageBlocks(params.images);
      } catch (err) {
        clearTimeout(timeoutId);
        this.forgetRun(run);
        await materialized?.cleanup().catch(() => {});
        yield { type: 'error', error: new AdapterInitError('claude-code', err), phase: 'init' };
        return;
      }
    }
    const seedContent: string | unknown[] = imageBlocks
      ? [{ type: 'text', text: params.prompt }, ...imageBlocks]
      : params.prompt;

    // EVERY run is driven through the input channel — not only streaming-input
    // ones. A plain string prompt makes the SDK mark the query single-turn and
    // call `transport.endInput()` at the first `result` ("First result received
    // for single-turn query, closing stdin"), which closes the CLI's stdin. The
    // CLI is spawned with `--permission-prompt-tool stdio`, so its control
    // protocol rides that same stdin: once closed, a permission/user-input
    // request raised after the result — exactly what happens when the engine
    // holds the session for background work and then wakes the model — is
    // denied inside the CLI with no host round-trip ("Tool permission request
    // failed: Stream closed"). Feeding an iterable keeps that decision ours, so
    // the end-of-turn policy below (which honours in-flight background work)
    // actually governs. `streamingInput` still gates pushMessage() alone; a
    // one-shot run closes the channel at its result and terminates exactly as
    // it did with a string prompt. See M11/M17.
    const inputChannel: InputChannel = createInputChannel(buildUserMessage(seedContent));
    run.closeInputChannel = () => inputChannel.close();
    if (params.streamingInput) {
      run.pushHandler = (text: string, images?: ImageInput[]) => {
        if (inputChannel.closed) return false;
        // Build image blocks BEFORE enqueueing: a bad image throws here, leaving
        // nothing half-delivered. base64/url need no I/O; `file` is read sync so
        // enqueue stays atomic w.r.t. the end-of-turn close check (see below).
        const blocks = images?.length ? buildClaudeImageBlocksSync(images) : null;
        const content: string | unknown[] = blocks
          ? [{ type: 'text', text }, ...blocks]
          : text;
        inputChannel.enqueue(buildUserMessage(content));
        pendingPushEmits.push({ text, images, timestamp: Date.now() });
        // Wake the main loop so the user_message event is emitted promptly.
        userInputWaker?.();
        userInputWaker = null;
        return true;
      };
    }

    // --- Background-task session hold (M17) ---
    // The engine keeps the session alive past a turn's `result` while background
    // work is in flight, then wakes the model. The adapter must keep ITS side of
    // the transport open for that whole window: the CLI's control protocol
    // (permission prompts, AskUserQuestion) is multiplexed onto the same stdin
    // the input channel feeds, so closing the channel at `result` leaves the
    // woken model unable to ask anything — the request is denied inside the CLI
    // with no host round-trip and nothing on the stream but a `Stream closed`
    // tool result.
    //
    // WHETHER to hold: the engine offers a signal, but only half of one. The `Stop`
    // hook fires at every turn boundary carrying `background_tasks`, documented as
    // "lets hooks distinguish 'session is done' from 'session is paused waiting for
    // background work to wake it'". Measured on 0.3.153 (see A01), it lands ~3ms
    // BEFORE the `result` it belongs to and is exact when it says something IS
    // running — but NOT when it says nothing is: on the three-subagent shape it
    // reported `[]`, and the engine then held the session, woke the model 2ms after
    // that `result`, and ran another full turn. Subagent wake-ups are invisible to
    // the field. So it is read as a positive hold reason only, never as permission
    // to close; the adapter's own task tracking remains the fallback that catches
    // the subagent shape.
    //
    // HOW LONG to hold is ours to bound either way, because neither source says
    // whether the engine will ever come back — the two bounds and the rules that
    // decide between them live in ./claude-code.background-hold.ts.
    const capMs = msOption(config.claude_backgroundHoldCapMs, MAX_BACKGROUND_HOLD_MS);
    const hold = createBackgroundHold({
      registry: tasks,
      // The two bounds are opposite outcomes, not two flavours of one (see HoldExpiry).
      //
      //  - grace: everything settled and the engine went quiet. Close the channel,
      //    exactly where the pre-hold code closed it — the ordinary end of the run.
      //  - cap: the held work stopped making progress, but the CLI is still ALIVE.
      //    Closing the channel here is what produced the defect this release fixes:
      //    stdin is the only host→CLI control transport, so the session carried on
      //    with MCP, canUseTool, hooks and elicitation all silently dead, and the
      //    consumer saw nothing but `(<tool> completed with no output)` results.
      //    So end the run instead, down the same path abort() uses, and let the loop
      //    surface a typed AdapterBackgroundHoldExpiredError.
      onExpire: (reason) => {
        if (reason === 'grace') {
          inputChannel.close();
          return;
        }
        backgroundHoldExpiredAfterMs = capMs;
        this.interruptRun(run);
        run.abortController.abort();
      },
      wake: () => {
        userInputWaker?.();
        userInputWaker = null;
      },
      graceMs: msOption(config.claude_backgroundGraceMs, BACKGROUND_WAKEUP_GRACE_MS),
      capMs,
    });

    /**
     * The most recent `Stop`-hook report, consumed and cleared by the next `result`.
     * `undefined` means "no report for this turn" — the hook has not fired, or the SDK
     * omits the field. A stale report is never reused: a turn that ends without the
     * hook firing must not inherit the previous turn's answer.
     */
    let stopHookTasks: { id: string; type?: string; description?: string }[] | undefined;

    // Additive w.r.t. anything already registered (the `claude_disallowBackgroundBash`
    // PreToolUse lever above, and project hooks the CLI merges in from settingSources).
    // The callback only observes — it returns `{continue: true}`, the no-op decision.
    {
      const existingHooks = (options.hooks ?? {}) as Record<string, unknown[]>;
      options.hooks = {
        ...existingHooks,
        Stop: [
          ...(existingHooks.Stop ?? []),
          {
            hooks: [
              async (input: unknown) => {
                const reported = (input as { background_tasks?: unknown }).background_tasks;
                // An absent field is an SDK that does not report this at all; an empty
                // one is a report that carries no weight (see above). Either way the
                // fallback decides, so only a non-empty list is worth keeping.
                if (Array.isArray(reported) && reported.length > 0) {
                  stopHookTasks = reported as typeof stopHookTasks;
                }
                return { continue: true };
              },
            ],
          },
        ],
      } as Options['hooks'];
    }

    // One SDK-type MCP server instance per run. Claimed as late as possible — right
    // before the CLI is spawned — so every earlier failure path exits without a claim
    // to unwind; from here on the finally below owns the release. A reuse therefore
    // fails at init, naming the server, instead of surfacing later as tool calls that
    // silently come back empty. See src/mcp.ts.
    const mcpClaim = claimSdkMcpInstances(params.mcpServers);
    if (!mcpClaim.ok) {
      clearTimeout(timeoutId);
      this.forgetRun(run);
      await materialized?.cleanup().catch(() => {});
      yield {
        type: 'error',
        error: mcpInstanceReuseError('claude-code', mcpClaim.conflictingServer),
        phase: 'init',
      };
      return;
    }
    const claimedMcpInstances = mcpClaim.claimed;
    // Also recorded on the run, so the outer registration owner can release it even
    // when the consumer abandons this generator mid-run (see `execute`).
    run.claimedMcpInstances = claimedMcpInstances;

    let q: Query;
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const versionCheck = checkPeerSdkVersion('@anthropic-ai/claude-agent-sdk');
      if (versionCheck.status === 'mismatch') {
        clearTimeout(timeoutId);
        this.forgetRun(run);
        releaseSdkMcpInstances(claimedMcpInstances);
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
        prompt: inputChannel.iterable,
        options,
      });
      run.activeQuery = q;
    } catch (err) {
      clearTimeout(timeoutId);
      this.forgetRun(run);
      releaseSdkMcpInstances(claimedMcpInstances);
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
            settleUnanswered(pending, 'decline');
            continue;
          }
          try {
            // Race the consumer's handler against abort. A host that answers
            // from a UI resolves this promise only when a human replies — which
            // may be never — so awaiting it bare makes abort()/timeoutMs
            // unenforceable and parks the run (and its SDK subprocess) forever.
            // See M13.
            const outcome = await Promise.race([
              effectiveUserInputHandler(pending.req).then((res) => ({ kind: 'answer' as const, res })),
              abortPromise.then(() => ({ kind: 'abort' as const })),
            ]);
            if (outcome.kind === 'abort') {
              // Settle the SDK-side promise so the callback doesn't leak, and
              // cancel everything still queued behind it.
              settleUnanswered(pending, 'cancel');
              yield* endRunTerminally();
              return;
            }
            const res = outcome.res;
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
            settleUnanswered(pending, 'cancel');
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

        // Race SDK's next message vs. a wake-up from the user-input bridge vs.
        // abort — the last one matters when the SDK has gone quiet (a held
        // session waiting on background work that will never settle).
        const wake = new Promise<'wake'>((resolve) => {
          userInputWaker = () => resolve('wake');
        });
        const winner = await Promise.race([
          pendingNext.then((r) => ({ kind: 'sdk' as const, value: r })),
          wake.then(() => ({ kind: 'wake' as const })),
          abortPromise.then(() => ({ kind: 'abort' as const })),
        ]);
        userInputWaker = null;

        if (winner.kind === 'wake') {
          // Loop back to drain block without consuming pendingNext.
          continue;
        }

        if (winner.kind === 'abort') {
          yield* endRunTerminally();
          return;
        }

        pendingNext = null;
        if (winner.value.done) break loop;
        const event = winner.value.value;
        // Session is demonstrably alive — re-decide which bound applies, if any.
        // Runs BEFORE the switch, so state this message is about to change (a task
        // settling, say) is re-evaluated by that branch's own hold.touch() call.
        hold.touch(event);

        if (run.abortController.signal.aborted) {
          yield* endRunTerminally();
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
                // Last-resort reconciliation (M16): an update naming an id we never
                // saw assigned, with exactly one create still unaccounted for, can
                // only be that create. Recovers the alias when the tool_result prose
                // did not yield one. Two or more outstanding is ambiguous, so it is
                // left alone rather than guessed — a wrong alias corrupts a real item,
                // where no alias merely appends a stray one.
                const updateId =
                  typeof block.input.taskId === 'string'
                    ? block.input.taskId
                    : typeof block.input.id === 'string'
                      ? block.input.id
                      : undefined;
                if (
                  updateId !== undefined &&
                  !serverTaskIdToToolUseId.has(updateId) &&
                  unresolvedTaskCreateToolUseIds.length === 1 &&
                  !(lastTodoSnapshot ?? []).some((item) => item.id === updateId)
                ) {
                  serverTaskIdToToolUseId.set(updateId, unresolvedTaskCreateToolUseIds.shift()!);
                }
                items = mergeTaskToolInputIntoSnapshot(
                  lastTodoSnapshot ?? [],
                  block.toolUseId,
                  block.input,
                  serverTaskIdToToolUseId,
                );
              }
              if (items === undefined) continue;

              // A create's engine-assigned id arrives in its tool_result; remember
              // which tool_use to read it back for (see the suppression filter).
              if (block.toolName === 'TaskCreate') taskCreateToolUseIds.add(block.toolUseId);
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
                  // One thing in the payload is NOT redundant: the id the engine
                  // assigned to a freshly created task ("Task #1 created
                  // successfully: …"). Every later TaskUpdate keys on it, so
                  // without this the update would append a second, blank-titled
                  // item and the real one would never change status (M16).
                  if (taskCreateToolUseIds.delete(block.toolUseId)) {
                    const assigned = extractAssignedTaskId(String(block.content ?? ''));
                    if (assigned) {
                      serverTaskIdToToolUseId.set(assigned, block.toolUseId);
                    } else {
                      // Nothing matched the prose. Remember which TaskCreate is
                      // outstanding so the next unknown TaskUpdate id can still be
                      // reconciled positionally — see unresolvedTaskCreateToolUseIds.
                      unresolvedTaskCreateToolUseIds.push(block.toolUseId);
                      if (debugUsage()) {
                        console.error(
                          '[agent-adapters claude-code] TaskCreate tool_result did not name an ' +
                            'assigned id; falling back to positional aliasing (M16)',
                          { toolUseId: block.toolUseId, content: block.content },
                        );
                      }
                    }
                  }
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
              const description = (e.description as string) ?? '';
              const kind = tasks.start(taskId, e.task_type, description);
              if (kind.isBackground && shellDenied) {
                // A background task IS a shell task, and this run has no shell.
                // M18 says the capability is simply OFF — a skip, not a
                // degradation to report — so nothing is emitted for it, exactly
                // as on an adapter whose SDK cannot background work at all.
                // Falling through to the subagent branch would mislabel it.
              } else if (kind.isBackground) {
                yield {
                  type: 'background_task_started',
                  taskId,
                  taskType: kind.taskType,
                  description,
                };
              } else {
                if (toolUseId) subagentTaskIdByParentToolUseId.set(toolUseId, taskId);
                yield { type: 'subagent_started', taskId, description, toolUseId };
              }
            } else if (subtype === 'task_progress') {
              const e = event as Record<string, unknown>;
              const taskId = e.task_id as string;
              const kind = tasks.kind(taskId);
              if (kind?.isBackground && shellDenied) {
                // See task_started above — background capability is off.
              } else if (kind?.isBackground) {
                yield {
                  type: 'background_task_progress',
                  taskId,
                  taskType: kind.taskType,
                  description: e.description as string | undefined,
                  ...(e.status ? { status: e.status as string } : {}),
                  ...(e.output_file ? { outputFile: e.output_file as string } : {}),
                };
              } else {
                yield {
                  type: 'subagent_progress',
                  taskId,
                  description: e.description as string,
                  lastToolName: e.last_tool_name as string | undefined,
                };
              }
            } else if (subtype === 'task_notification') {
              const e = event as Record<string, unknown>;
              const taskId = e.task_id as string;
              const kind = tasks.kind(taskId);
              tasks.settle(taskId);
              if (kind?.isBackground && shellDenied) {
                // See task_started above — background capability is off.
              } else if (kind?.isBackground) {
                yield {
                  type: 'background_task_completed',
                  taskId,
                  taskType: kind.taskType,
                  status: e.status as string,
                  ...(e.output_file ? { outputFile: e.output_file as string } : {}),
                  summary: e.summary as string | undefined,
                  usage: normalizeClaudeUsage(e.usage),
                };
              } else {
                // MAP, never forward. `task_notification.status` is a closed union on
                // the pinned SDK (`completed | failed | stopped`), but the sibling
                // `task_updated.patch.status` channel below already shows a wider
                // engine vocabulary (`cancelled`/`canceled`) — so a peer-SDK bump
                // inside the declared range could widen this one to match, and the
                // unified surface must not inherit whatever the SDK happens to spell.
                const mapped = mapSubagentStatus(e.status, SDK_TASK_STATUS_MAP);
                if (mapped.warn && !unknownSubagentStatusWarned) {
                  unknownSubagentStatusWarned = true;
                  yield {
                    type: 'warning',
                    message:
                      `claude-code reported an unrecognized subagent status ${JSON.stringify(e.status)}; ` +
                      `reported as 'failed' because claiming success is the unsafe direction. This is a ` +
                      `drift signal — the SDK pin's declared statuses no longer cover what it emits.`,
                  };
                }
                yield {
                  type: 'subagent_completed',
                  taskId,
                  status: mapped.status,
                  summary: e.summary as string | undefined,
                  // Per-subagent total (sum across the subagent's turns).
                  usage: normalizeClaudeUsage(e.usage),
                };
              }
              // The in-flight set just shrank, so the bound may have changed from the
              // long cap to the short grace — re-park on whichever now applies.
              hold.touch(event);
            } else if (subtype === 'task_updated') {
              // The engine's own "this task finished" patch, which arrives BEFORE
              // the corresponding notification (observed live). No event of its own
              // — the lifecycle families already cover start/progress/completion —
              // but it is what distinguishes "still working" from "done, wake-up
              // pending", and so which of the two hold bounds applies.
              const e = event as Record<string, unknown>;
              const taskId = e.task_id as string;
              const status = (e.patch as Record<string, unknown> | undefined)?.status;
              if (typeof status === 'string' && /^(completed|failed|stopped|cancell?ed)$/.test(status)) {
                tasks.markFinished(taskId);
                hold.touch(event);
              }
            } else if (subtype === 'compact_boundary') {
              yield { type: 'flush' };
            }
            break;
          }

          case 'result': {
            const resultEvent = event as Record<string, unknown>;
            // Consume the engine's own in-flight report for this turn exactly once:
            // it feeds both the `backgroundTasks` projection below and the keep-open
            // decision at the bottom, and must not leak into a later turn.
            const stopHookReported = stopHookTasks;
            stopHookTasks = undefined;

            // The engine's own list, from whichever place this SDK publishes it: the
            // Stop hook today, `result.background_tasks` if a future SDK adds it there.
            // The union of that and our own tracking, filtered to background work only,
            // is `projectBackgroundTasks()` — see its JSDoc for why a subagent must
            // never appear here even though it does hold the session.
            // With `shell` denied the run has no background-task capability at
            // all, so the field is never populated — the same silence as the
            // suppressed `background_task_*` events above.
            const backgroundTasks = shellDenied
              ? []
              : projectBackgroundTasks(tasks, [
                  ...(Array.isArray(resultEvent.background_tasks)
                    ? (resultEvent.background_tasks as Record<string, unknown>[])
                    : []),
                  ...(stopHookReported ?? []),
                ]);

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
                // PER-TURN, not cumulative. A run can emit several `result`s — a queued
                // mid-turn push, or the engine waking the model after background work —
                // and each one carries only its own turn's cost, so a run total is the
                // SUM of them (`sumUsageFromEvents()`). Measured on 0.3.153 and 0.3.210:
                // a second result routinely reports FEWER tokens than the first in every
                // field, which cumulative counting cannot do. Matches the SDK's own
                // docs — "each result only reflects the cost of that individual call…
                // accumulate the totals yourself":
                // https://code.claude.com/docs/en/agent-sdk/cost-tracking
                // Also NOT cross-session: on options.resume the SDK reports only this
                // query()'s tokens. Do not double-count with per-message usage on
                // NormalizedMessage.
                usage: claudeUsage,
                contextSize,
                sessionId,
                ...(lastTodoSnapshot ? { todoListSnapshot: lastTodoSnapshot } : {}),
                ...(backgroundTasks.length ? { backgroundTasks } : {}),
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
            //
            // Task activity is the second keep-open reason (M17): the engine holds
            // the session past this result and wakes the model, which then needs the
            // control channel this transport carries.
            //
            // Two sources answer "is the engine coming back?", and the hold takes
            // their UNION, because each misses what the other catches:
            //
            //  - the engine's own `Stop`-hook report, when it names something in
            //    flight. Precise, but version-dependent — 0.3.153 leaves subagents out
            //    of it entirely and reported `[]` on a session it then resumed, so
            //    only its positive answer is load-bearing (see A01).
            //  - the adapter's own tracking, as "this run started ANY task". Coarse on
            //    purpose: nothing-in-flight is not the same as nothing-coming —
            //    observed on 0.3.210, three subagents all reported completion INSIDE
            //    the turn, and the engine still resumed the model for three further
            //    turns and asked a question at the end, which landed on a dead
            //    transport when the channel closed at that first result.
            //
            // Settled work then gets the short grace window and work still running
            // gets the long cap; both live in the hold.
            const engineHoldsSession = (stopHookReported?.length ?? 0) > 0;
            if (resultEvent.subtype === 'success' && inputChannel.hasPending()) {
              // keep open: SDK consumes the next queued message as a new turn
              hold.end();
            } else if (
              resultEvent.subtype === 'success' &&
              (engineHoldsSession || tasks.touchedATask())
            ) {
              hold.begin();
            } else {
              hold.end();
              inputChannel.close();
            }
            // The decision for this turn is made, so the settlements that fed it have
            // done their job. Forgetting them is what stops one early subagent from
            // arming the hold at every later `result` for the rest of the run.
            tasks.markTurnBoundary();
            break;
          }

          default:
            break;
        }
      }

      // A cap expiry aborts this run rather than closing the channel under a live
      // CLI, and the abort can land while the loop is parked on the SDK's next
      // message — which then resolves `done` and breaks the loop before the abort
      // branch is reached. Reporting it here is what keeps that race from ending the
      // run as an ordinary completion with no signal at all.
      // Gated on OUR OWN terminal reasons, not on `signal.aborted` alone. A consumer
      // that calls `abort()` after the final `result` — "I have what I need, stop the
      // session" — trips the flag on a run that completed successfully, and turning
      // that into a terminal error would report a good run as a failed one.
      if (backgroundHoldExpiredAfterMs !== null || timedOut) {
        yield* endRunTerminally();
        return;
      }
    } catch (err) {
      if (run.abortController.signal.aborted) {
        yield* endRunTerminally();
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)), phase: 'runtime' };
    } finally {
      clearTimeout(timeoutId);
      // Tear down streaming-input state: detach the push handler so a late
      // pushMessage() returns false, and close the channel so the SDK isn't
      // left awaiting input.
      this.forgetRun(run);
      releaseSdkMcpInstances(claimedMcpInstances);
      hold.dispose();
      inputChannel.close();
      // Settle anything the SDK is still awaiting. This `finally` runs on EVERY exit
      // — the abort/timeout early returns, a throw, and a consumer that abandons the
      // stream mid-iteration (the generator's own `.return()`) — and only the
      // user-input drain settled the map before, so a `canUseTool`/`onElicitation`
      // promise outstanding on any other path leaked its callback and closure for
      // the lifetime of the process.
      settleAllPending();
      await materialized?.cleanup().catch((err) =>
        console.warn('[agent-adapters] claude-code skill cleanup failed', err),
      );
    }
  }
}
