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

import { Codex } from '@openai/codex-sdk';
import type { ThreadItem } from '@openai/codex-sdk';
import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
} from '../types.js';
import { AdapterInitError, AdapterTimeoutError, AdapterAbortError } from '../types.js';
import { resolveModel } from '../models.js';
import { redactSecrets } from '../redact.js';
import { materializeSkills, type MaterializedSkills, type MirroredSkills } from '../skills-tempdir.js';

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

    let codex: InstanceType<typeof Codex>;
    try {
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
    };

    yield {
      type: 'adapter_ready',
      adapter: 'codex',
      sdkConfig: redactSecrets({
        codexOptions,
        threadOptions,
        ...(params.resumeSessionId ? { resumeSessionId: params.resumeSessionId } : {}),
      }),
    };

    const thread = params.resumeSessionId
      ? codex.resumeThread(params.resumeSessionId, threadOptions)
      : codex.startThread(threadOptions);

    // System prompt baked into prompt (no native support)
    const fullPrompt = params.systemPrompt
      ? `${params.systemPrompt}\n\n${params.prompt}`
      : params.prompt;

    const rawMessages: NormalizedMessage[] = [];
    let totalUsage = { inputTokens: 0, outputTokens: 0 };
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
      const { events } = await thread.runStreamed(fullPrompt, {
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
            totalUsage = {
              inputTokens: totalUsage.inputTokens + (event.usage?.input_tokens ?? 0),
              outputTokens: totalUsage.outputTokens + (event.usage?.output_tokens ?? 0),
            };

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

            yield {
              type: 'result',
              output: lastText,
              rawMessages,
              usage: totalUsage,
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
    }
  }
}
