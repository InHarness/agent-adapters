// Codex adapter — sandbox-based adapter for OpenAI models
// SDK: @openai/codex-sdk
// Auth: OPENAI_API_KEY env var
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
    if (!apiKey) throw new AdapterInitError('codex', new Error('OPENAI_API_KEY env var is required'));

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

    const codexOptions: Record<string, unknown> = { apiKey };
    if (config.codex_baseUrl) {
      codexOptions.baseURL = config.codex_baseUrl as string;
    }

    let codex: InstanceType<typeof Codex>;
    try {
      codex = new Codex(codexOptions as ConstructorParameters<typeof Codex>[0]);
    } catch (err) {
      throw new AdapterInitError('codex', err);
    }

    const resolvedModel = resolveModel(this.architecture, params.model);

    // Session resumption: resumeThread if sessionId provided
    const threadOptions = {
      model: resolvedModel,
      sandboxMode: sandboxMode as 'read-only' | 'workspace-write',
      workingDirectory: params.cwd ?? process.cwd(),
      approvalPolicy: 'never' as const,
      modelReasoningEffort: config.codex_reasoningEffort as
        | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
        | undefined,
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

    try {
      const { events } = await thread.runStreamed(fullPrompt, {
        signal: this.abortController.signal,
      });

      for await (const event of events) {
        if (this.abortController.signal.aborted) {
          if (timedOut) {
            yield { type: 'error', error: new AdapterTimeoutError('codex', params.timeoutMs!) };
          } else {
            yield { type: 'error', error: new AdapterAbortError('codex') };
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
              yield { type: 'error', error: new Error(item.message) };
            }
            break;
          }

          case 'turn.started': {
            threadId = (event as Record<string, unknown>).threadId as string | undefined ?? threadId;
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
            yield { type: 'error', error: new Error(event.error.message) };
            break;
          }

          case 'error': {
            yield { type: 'error', error: new Error(event.message) };
            break;
          }

          default:
            break;
        }
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        if (timedOut) {
          yield { type: 'error', error: new AdapterTimeoutError('codex', params.timeoutMs!) };
        } else {
          yield { type: 'error', error: new AdapterAbortError('codex') };
        }
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
