// Codex adapter — sandbox-based adapter for OpenAI models
// SDK: @openai/codex-sdk
// Auth: OPENAI_API_KEY env var

import { Codex } from '@openai/codex-sdk';
import type { ThreadItem } from '@openai/codex-sdk';
import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
} from '../types.js';
import { AdapterInitError } from '../types.js';

// --- Adapter ---

export class CodexAdapter implements RuntimeAdapter {
  architecture = 'codex' as const;
  private abortController: AbortController | null = null;

  abort(): void {
    this.abortController?.abort();
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    this.abortController = new AbortController();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AdapterInitError('codex', new Error('OPENAI_API_KEY env var is required'));

    const config = params.architectureConfig ?? {};
    const sandboxMode = (config.codex_sandboxMode as string) ?? 'workspace-write';

    let codex: InstanceType<typeof Codex>;
    try {
      codex = new Codex({ apiKey });
    } catch (err) {
      throw new AdapterInitError('codex', err);
    }

    // Session resumption: resumeThread if sessionId provided
    const threadOptions = {
      model: params.model,
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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, params.timeoutMs);
    }

    try {
      const { events } = await thread.runStreamed(fullPrompt, {
        signal: this.abortController.signal,
      });

      for await (const event of events) {
        if (this.abortController.signal.aborted) return;

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
      if (this.abortController.signal.aborted) return;
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
