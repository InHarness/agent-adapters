// Codex adapter — sandbox-based adapter for OpenAI models
// SDK: @openai/codex-sdk
// Auth: OPENAI_API_KEY env var OR local ChatGPT OAuth via `codex login`
//       (~/.codex/auth.json). When neither codex_apiKey nor OPENAI_API_KEY is
//       present, the adapter omits the apiKey field and lets the underlying
//       Codex CLI resolve auth from its local token store.
//
// MCP limitations: The Codex SDK does not support dynamic MCP server configuration.
// MCP servers must be pre-configured via `codex mcp add` CLI command or ~/.codex/config.toml.
// The Codex CLI has full MCP support (add/list/remove), but the SDK's ThreadOptions
// do not expose MCP configuration. Incoming mcp_tool_call events from pre-configured
// servers are normalized to UnifiedEvent.

// SDK is an optional peer dependency — import only types at the top level
// (erased at compile time) and load the runtime value lazily inside execute().
import type { Codex, ThreadItem, Input, UserInput } from '@openai/codex-sdk';
import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
  UsageStats,
  ImageInput,
} from '../types.js';
import { AdapterInitError, AdapterTimeoutError, AdapterAbortError } from '../types.js';
import { resolveModel } from '../models.js';
import { redactSecrets } from '../redact.js';
import { subtractUsage } from '../usage.js';
import { materializeSkills, type MaterializedSkills, type MirroredSkills } from '../skills-tempdir.js';
import { createImageWorkspace, type ImageWorkspace } from '../images-tempdir.js';
import { probePathScope } from '../path-scope.js';

/**
 * Build the Codex `Input`. With no images this is just the prompt string (the
 * SDK's text-only fast path). With images it becomes a `UserInput[]` of one text
 * part plus one `local_image` per image — the SDK only accepts a local PATH, so
 * base64 is written to a temp file and url is downloaded to one (via `workspace`),
 * while a `file` source passes through. `workspace` is created lazily inside those
 * writes and removed by the caller's finally.
 */
export async function buildCodexInput(
  text: string,
  images: ImageInput[] | undefined,
  workspace: ImageWorkspace,
  signal?: AbortSignal,
): Promise<Input> {
  if (!images?.length) return text;
  const parts: UserInput[] = [{ type: 'text', text }];
  for (const img of images) {
    if (img.type === 'file') {
      parts.push({ type: 'local_image', path: img.path });
    } else if (img.type === 'base64') {
      parts.push({ type: 'local_image', path: await workspace.writeBase64(img.data, img.mediaType) });
    } else {
      const { path } = await workspace.download(img.url, signal);
      parts.push({ type: 'local_image', path });
    }
  }
  return parts;
}

// Codex CLI emits error events whose `message` is sometimes a JSON-stringified
// API response body (e.g. `{"type":"error","status":400,"error":{...}}`).
// Walk into nested `.error.message` / `.message` so consumers see the human-
// readable text, not the raw envelope.
function extractCodexErrorMessage(raw: unknown, fallback = 'Codex error'): string {
  if (raw == null) return fallback;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const nested = (obj.error as Record<string, unknown> | undefined)?.message;
    if (typeof nested === 'string' && nested.trim()) return nested;
    if (typeof obj.message === 'string') return extractCodexErrorMessage(obj.message, fallback);
    return fallback;
  }
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return extractCodexErrorMessage(JSON.parse(trimmed), trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed || fallback;
}

// `codex exec --experimental-json` (which @openai/codex-sdk wraps) emits
// turn.completed.usage as CUMULATIVE session totals — `event_processor_with_
// jsonl_output.rs::usage_from_last_total` drops the rust core's per-request
// `ThreadTokenUsage.last` and only emits `.total`. See openai/codex#17539
// (open as of 2026-04-12). The unified contract requires per-execute() delta
// (see UnifiedEvent.result.usage in types.ts), so we track the last cumulative
// we saw per threadId and yield current_cumulative − prior. LRU-capped to
// bound long-running process growth.
const CODEX_USAGE_LRU_CAP = 256;
const codexSessionLastUsage = new Map<string, UsageStats>();

function rememberCodexCumulative(threadId: string, cumulative: UsageStats): void {
  if (codexSessionLastUsage.has(threadId)) {
    codexSessionLastUsage.delete(threadId);
  } else if (codexSessionLastUsage.size >= CODEX_USAGE_LRU_CAP) {
    const oldest = codexSessionLastUsage.keys().next().value;
    if (oldest !== undefined) codexSessionLastUsage.delete(oldest);
  }
  codexSessionLastUsage.set(threadId, cumulative);
}

/** Test-only: clear the module-scoped usage LRU to simulate a process restart. */
export function _clearCodexUsageLruForTest(): void {
  codexSessionLastUsage.clear();
}

// Debug logging for cumulative-as-delta usage flow (issue #17539, quirk #9 in
// .claude/skills/codex-sdk/SKILL.md). Enable by setting any non-empty value:
//   AGENT_ADAPTERS_DEBUG_USAGE=1   ← any architecture
//   DEBUG=agent-adapters:codex     ← debug-style namespace
// Logs go to stderr so they don't pollute stdout streams.
function debugUsage(): boolean {
  const flag = process.env.AGENT_ADAPTERS_DEBUG_USAGE;
  if (flag && flag !== '0' && flag.toLowerCase() !== 'false') return true;
  const debug = process.env.DEBUG;
  if (debug && /(^|,)agent-adapters(:|,|$)|agent-adapters:codex/.test(debug)) return true;
  return false;
}

// --- Adapter ---

export class CodexAdapter implements RuntimeAdapter {
  architecture = 'codex' as const;
  private abortController: AbortController | null = null;
  /** Populated by factory when a provider is configured. */
  _providerConfig?: Record<string, unknown>;

  abort(): void {
    this.abortController?.abort();
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    // subagentTaskId on delta-like events is never populated — Codex SDK has
    // no subagent concept. See .claude/skills/codex-sdk/SKILL.md:73.
    this.abortController = new AbortController();

    // Merge provider-resolved config with user-supplied config
    const config = { ...this._providerConfig, ...params.architectureConfig };

    const apiKey = (config.codex_apiKey as string) ?? process.env.OPENAI_API_KEY;
    // No api key? Fall through and let the Codex CLI resolve auth from
    // ~/.codex/auth.json (set by `codex login` for ChatGPT OAuth).

    // Warn if MCP servers are provided — Codex SDK does not support dynamic MCP configuration
    if (params.mcpServers && Object.keys(params.mcpServers).length > 0) {
      console.warn(
        '[agent-adapters] codex: mcpServers ignored — Codex SDK does not support dynamic MCP server configuration. ' +
        'Pre-configure servers via `codex mcp add` or ~/.codex/config.toml.',
      );
    }

    // Codex SDK has no ask-user / elicitation mechanism — surface once so callers know.
    if (params.onUserInput || params.onElicitation) {
      yield {
        type: 'warning',
        message:
          'codex adapter: onUserInput/onElicitation is not supported — the Codex SDK has no ask-user mechanism. The handler will never be invoked.',
      };
    }

    // Codex SDK has no concept of defining subagents — surface once so callers know.
    if (params.subagents?.length) {
      yield {
        type: 'warning',
        message:
          'codex adapter: subagents are not supported — the Codex SDK has no subagent definition mechanism. The `subagents` field is ignored.',
      };
    }

    const sandboxMode = params.planMode
      ? 'read-only'
      : ((config.codex_sandboxMode as string) ?? 'workspace-write');

    const codexOptions: Record<string, unknown> = {};
    if (apiKey) {
      codexOptions.apiKey = apiKey;
    }
    if (config.codex_baseUrl) {
      codexOptions.baseURL = config.codex_baseUrl as string;
    }

    let Codex: typeof import('@openai/codex-sdk').Codex;
    let codex: InstanceType<typeof Codex>;
    try {
      ({ Codex } = await import('@openai/codex-sdk'));
      codex = new Codex(codexOptions as ConstructorParameters<typeof Codex>[0]);
    } catch (err) {
      yield { type: 'error', error: new AdapterInitError('codex', err), phase: 'init' };
      return;
    }

    let resolvedModel: string;
    try {
      resolvedModel = resolveModel(this.architecture, params.model);
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err : new AdapterInitError('codex', err),
        phase: 'init',
      };
      return;
    }

    const userCwd = params.cwd ?? process.cwd();

    // Filesystem path scoping. Codex's OS sandbox is allow-list-only: `allowedPaths`
    // extend the writable roots via `additionalDirectories` (only meaningful under
    // `workspace-write`; we never widen an existing read-only/plan-mode sandbox).
    // `disallowedPaths` CANNOT be enforced — there is no deny-list primitive — so we
    // surface it as an expressiveness limitation rather than silently dropping it.
    const pathScope = probePathScope('codex', params);
    const existingAdditionalDirs = Array.isArray(config.codex_additionalDirectories)
      ? (config.codex_additionalDirectories as string[])
      : [];
    const additionalDirectories = [...existingAdditionalDirs, ...pathScope.allowed];
    if (pathScope.unenforceable.length) {
      yield {
        type: 'warning',
        message:
          'codex adapter: disallowedPaths cannot be enforced — the Codex sandbox is allow-list-only ' +
          '(no deny carve-outs inside an allowed root). These paths are NOT blocked: ' +
          `${pathScope.unenforceable.join(', ')}.`,
      };
    }

    // Materialize inline skills BEFORE thread start so codex CLI's first scan
    // of <cwd>/.agents/skills/ picks them up. The Codex SDK has no programmatic
    // skills API; we mirror under uuid-prefixed dirs and remove only what we
    // wrote in the finally below.
    let materialized: MaterializedSkills | undefined;
    let mirrored: MirroredSkills | undefined;
    if (params.skills?.length) {
      try {
        materialized = await materializeSkills(params.skills);
        mirrored = await materialized.mirrorTo(userCwd, '.agents/skills');
      } catch (err) {
        await materialized?.cleanup().catch(() => {});
        yield { type: 'error', error: new AdapterInitError('codex', err), phase: 'init' };
        return;
      }
    }

    // Session resumption: resumeThread if sessionId provided
    const threadOptions = {
      model: resolvedModel,
      sandboxMode: sandboxMode as 'read-only' | 'workspace-write',
      workingDirectory: userCwd,
      approvalPolicy: 'never' as const,
      modelReasoningEffort: config.codex_reasoningEffort as
        | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
        | undefined,
      ...(additionalDirectories.length ? { additionalDirectories } : {}),
    };

    yield {
      type: 'adapter_ready',
      adapter: 'codex',
      sdkConfig: redactSecrets({
        codexOptions,
        threadOptions,
        ...(params.resumeSessionId ? { resumeSessionId: params.resumeSessionId } : {}),
      }),
      ...(pathScope.requested ? { pathScope } : {}),
    };

    const thread = params.resumeSessionId
      ? codex.resumeThread(params.resumeSessionId, threadOptions)
      : codex.startThread(threadOptions);

    // System prompt baked into prompt (no native support)
    const fullPrompt = params.systemPrompt
      ? `${params.systemPrompt}\n\n${params.prompt}`
      : params.prompt;

    // Lazy temp dir for materializing images (base64/url → local file path, the
    // only image form Codex's SDK accepts). Created on first write; removed in
    // the finally below. No disk touched when there are no images.
    const imageWorkspace = createImageWorkspace();

    const rawMessages: NormalizedMessage[] = [];
    // Per-execute() delta = current cumulative (from turn.completed.usage) - prior
    // cumulative. Lookup priority:
    //   1. params.priorUsage  — caller-supplied (cross-process: LRU starts empty
    //      every turn, so the caller persists the prior cumulative themselves
    //      and passes it back; see RuntimeExecuteParams.priorUsage JSDoc)
    //   2. codexSessionLastUsage  — module-scoped LRU (single-process resume)
    //   3. {0,0}  — fresh thread, or first resume after process restart with
    //      no priorUsage supplied (yields cumulative-as-delta one-shot artifact)
    const lruPrior = params.resumeSessionId
      ? codexSessionLastUsage.get(params.resumeSessionId)
      : undefined;
    const priorSource: 'params' | 'lru' | 'zero-fallback' = params.priorUsage
      ? 'params'
      : lruPrior
        ? 'lru'
        : 'zero-fallback';
    const priorUsage: UsageStats =
      params.priorUsage ?? lruPrior ?? { inputTokens: 0, outputTokens: 0 };

    if (debugUsage()) {
      console.error('[agent-adapters codex] execute() priorUsage', {
        resumeSessionId: params.resumeSessionId,
        priorSource,
        priorUsage,
        paramsPriorUsageProvided: params.priorUsage !== undefined,
        lruSize: codexSessionLastUsage.size,
      });
    }
    let threadId: string | undefined;

    // Timeout handling
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        this.abortController?.abort();
      }, params.timeoutMs);
    }

    let lastErrorMessage: string | null = null;

    try {
      const input = await buildCodexInput(
        fullPrompt,
        params.images,
        imageWorkspace,
        this.abortController.signal,
      );
      const { events } = await thread.runStreamed(input, {
        signal: this.abortController.signal,
      });

      for await (const event of events) {
        if (this.abortController.signal.aborted) {
          if (timedOut) {
            yield { type: 'error', error: new AdapterTimeoutError('codex', params.timeoutMs!), phase: 'runtime' };
          } else {
            yield { type: 'error', error: new AdapterAbortError('codex'), phase: 'runtime' };
          }
          return;
        }

        switch (event.type) {
          case 'item.completed': {
            const item = event.item;

            if (item.type === 'agent_message') {
              yield { type: 'text_delta', text: item.text, isSubagent: false };

              const message: NormalizedMessage = {
                role: 'assistant',
                content: [{ type: 'text', text: item.text }],
                timestamp: new Date().toISOString(),
                native: item,
              };
              rawMessages.push(message);
              yield { type: 'assistant_message', message };
            } else if (item.type === 'command_execution') {
              yield {
                type: 'tool_use',
                toolName: 'shell',
                toolUseId: item.id,
                input: { command: item.command },
                isSubagent: false,
              };
              yield {
                type: 'tool_result',
                toolUseId: item.id,
                summary: item.aggregated_output ?? `exit_code: ${item.exit_code}`,
                isSubagent: false,
                isError: item.status === 'failed' || (item.exit_code != null && item.exit_code !== 0),
              };
            } else if (item.type === 'file_change') {
              yield {
                type: 'tool_use',
                toolName: 'file',
                toolUseId: item.id,
                input: { changes: item.changes },
                isSubagent: false,
              };
              yield {
                type: 'tool_result',
                toolUseId: item.id,
                summary: item.changes.map((c) => `${c.kind}: ${c.path}`).join(', '),
                isSubagent: false,
                isError: item.status === 'failed',
              };
            } else if (item.type === 'mcp_tool_call') {
              yield {
                type: 'tool_use',
                toolName: `mcp__${item.server}__${item.tool}`,
                toolUseId: item.id,
                input: item.arguments,
                isSubagent: false,
              };
              yield {
                type: 'tool_result',
                toolUseId: item.id,
                summary: item.error?.message ?? JSON.stringify(item.result ?? ''),
                isSubagent: false,
                isError: item.status === 'failed' || item.error != null,
              };
            } else if (item.type === 'reasoning') {
              yield { type: 'thinking', text: item.text, isSubagent: false };
            } else if (item.type === 'error') {
              const msg = extractCodexErrorMessage(item.message);
              if (msg !== lastErrorMessage) {
                lastErrorMessage = msg;
                yield { type: 'error', error: new Error(msg), phase: 'runtime' };
              }
            }
            break;
          }

          case 'thread.started': {
            threadId = (event as { thread_id?: string }).thread_id ?? threadId;
            break;
          }

          case 'turn.completed': {
            // event.usage is cumulative session usage from `codex exec` JSONL — compute
            // per-execute() delta against last-seen cumulative for this thread.
            // OpenAI convention: `cached_input_tokens` is a sub-field of
            // `input_tokens` (cache reads count toward `input_tokens`, just at a
            // discounted rate). Forward it as `cacheReadInputTokens` so callers
            // can compute "fresh" input as `inputTokens - (cacheReadInputTokens ?? 0)`.
            const currentCumulative: UsageStats = {
              inputTokens: event.usage?.input_tokens ?? 0,
              outputTokens: event.usage?.output_tokens ?? 0,
              ...(event.usage?.cached_input_tokens != null
                ? { cacheReadInputTokens: event.usage.cached_input_tokens }
                : {}),
            };
            const deltaUsage = subtractUsage(currentCumulative, priorUsage);

            if (debugUsage()) {
              console.error('[agent-adapters codex] turn.completed', {
                rawSdkUsage: event.usage,
                currentCumulative,
                priorUsage,
                emittedDelta: deltaUsage,
                threadId: threadId ?? thread.id ?? null,
              });
            }

            const lastText = rawMessages
              .filter((m) => m.role === 'assistant')
              .map((m) =>
                m.content
                  .filter((c) => c.type === 'text')
                  .map((c) => (c as { text: string }).text)
                  .join(''),
              )
              .join('\n');

            threadId = threadId ?? thread.id ?? undefined;
            if (threadId) {
              rememberCodexCumulative(threadId, currentCumulative);
            }

            yield {
              type: 'result',
              output: lastText,
              rawMessages,
              usage: deltaUsage,
              contextSize: deltaUsage.inputTokens + deltaUsage.outputTokens,
              sessionId: threadId,
            };
            break;
          }

          case 'turn.failed': {
            const msg = extractCodexErrorMessage(event.error);
            if (msg !== lastErrorMessage) {
              lastErrorMessage = msg;
              yield { type: 'error', error: new Error(msg), phase: 'runtime' };
            }
            break;
          }

          case 'error': {
            const msg = extractCodexErrorMessage(event.message);
            if (msg !== lastErrorMessage) {
              lastErrorMessage = msg;
              yield { type: 'error', error: new Error(msg), phase: 'runtime' };
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
          yield { type: 'error', error: new AdapterTimeoutError('codex', params.timeoutMs!), phase: 'runtime' };
        } else {
          yield { type: 'error', error: new AdapterAbortError('codex'), phase: 'runtime' };
        }
        return;
      }
      // The codex-sdk rethrows `Codex Exec exited with <detail>: <stderr>`
      // after the subprocess exits non-zero, even when the underlying cause
      // (e.g. unsupported model) was already surfaced as a turn.failed/error
      // event. Suppress the duplicate so consumers see exactly one structured
      // error per failure.
      if (
        lastErrorMessage !== null &&
        err instanceof Error &&
        err.message.startsWith('Codex Exec exited with')
      ) {
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)), phase: 'runtime' };
    } finally {
      clearTimeout(timeoutId);
      await mirrored?.cleanupMirror().catch((err) =>
        console.warn('[agent-adapters] codex mirrored skill cleanup failed', err),
      );
      await materialized?.cleanup().catch((err) =>
        console.warn('[agent-adapters] codex skill cleanup failed', err),
      );
      await imageWorkspace.cleanup().catch((err) =>
        console.warn('[agent-adapters] codex image cleanup failed', err),
      );
    }
  }
}
