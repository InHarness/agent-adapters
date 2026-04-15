// OpenCode adapter — multi-provider via OpenRouter, SSE-based streaming
// SDK: @opencode-ai/sdk
// Auth: OPENROUTER_API_KEY env var
// Requires: opencode CLI in PATH

import { createOpencode } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
  UsageStats,
} from '../types.js';
import { AdapterInitError } from '../types.js';
import { execSync } from 'node:child_process';

/** Check if the opencode CLI is available in PATH */
export function isOpencodeAvailable(): boolean {
  try {
    execSync('which opencode', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getAvailablePort(): number {
  return 49152 + Math.floor(Math.random() * 16383);
}

// --- Adapter ---

export class OpencodeAdapter implements RuntimeAdapter {
  architecture = 'opencode' as const;
  private abortController: AbortController | null = null;
  private serverClose: (() => void) | null = null;

  abort(): void {
    this.abortController?.abort();
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new AdapterInitError('opencode', new Error('OPENROUTER_API_KEY env var is required'));

    const modelParts = params.model.split('/');
    const providerID = modelParts.length > 1 ? modelParts[0] : 'openrouter';
    const modelID = modelParts.length > 1 ? modelParts.slice(1).join('/') : params.model;

    const config = params.architectureConfig ?? {};
    const port = getAvailablePort();

    // Build MCP config from params
    const mcpConfig: Record<string, unknown> = {};
    if (params.mcpServers) {
      for (const [name, serverConfig] of Object.entries(params.mcpServers)) {
        mcpConfig[name] = {
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        };
      }
    }

    let client: OpencodeClient;
    try {
      const opencodeConfig: Record<string, unknown> = {
        provider: {
          [providerID]: { api: apiKey },
        },
        agent: {
          build: {
            model: `${providerID}/${modelID}`,
            temperature: config.opencode_temperature as number | undefined,
            top_p: config.opencode_topP as number | undefined,
            permission: { edit: 'allow', bash: 'allow' },
          },
        },
      };

      if (Object.keys(mcpConfig).length > 0) {
        opencodeConfig.mcp = mcpConfig;
      }

      const result = await createOpencode({
        signal,
        port,
        config: opencodeConfig,
      });
      client = result.client;
      this.serverClose = result.server.close;
    } catch (err) {
      yield { type: 'error', error: new AdapterInitError('opencode', err) };
      return;
    }

    const rawMessages: NormalizedMessage[] = [];
    let totalUsage: UsageStats = { inputTokens: 0, outputTokens: 0 };
    let sessionId: string | undefined;

    // Timeout handling
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, params.timeoutMs);
    }

    try {
      // 1. Create session
      const cwd = params.cwd ?? process.cwd();
      const sessionResult = await client.session.create({
        query: { directory: cwd },
      });
      const session = (sessionResult as { data?: { id?: string } }).data;
      sessionId = session?.id;

      if (!sessionId) {
        yield { type: 'error', error: new Error('Failed to create OpenCode session') };
        return;
      }

      // 2. Subscribe to events BEFORE promptAsync (critical — race condition)
      const sseResult = await client.event.subscribe({
        query: { directory: cwd },
      });

      // 3. Send prompt
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          system: params.systemPrompt,
          model: { providerID, modelID },
          parts: [{ type: 'text', text: params.prompt }],
        },
      });

      // 4. Consume SSE events
      if (!sseResult.stream) {
        yield { type: 'error', error: new Error('SSE stream not available') };
        return;
      }

      const currentBlocks: ContentBlock[] = [];
      let lastMessageId: string | undefined;

      for await (const event of sseResult.stream) {
        if (signal.aborted) return;

        const evt = event as { type: string; properties?: Record<string, unknown> };

        switch (evt.type) {
          case 'message.part.updated': {
            const props = evt.properties as { part: Record<string, unknown>; delta?: string };
            const part = props.part;
            const partType = part.type as string;
            const partSessionId = part.sessionID as string;

            if (partSessionId !== sessionId) break;

            const messageId = part.messageID as string;
            if (messageId !== lastMessageId) {
              if (lastMessageId && currentBlocks.length > 0) {
                const msg: NormalizedMessage = {
                  role: 'assistant',
                  content: [...currentBlocks],
                  timestamp: new Date().toISOString(),
                  native: part,
                };
                rawMessages.push(msg);
                yield { type: 'assistant_message', message: msg };
                currentBlocks.length = 0;
              }
              lastMessageId = messageId;
            }

            if (partType === 'text') {
              const delta = props.delta ?? (part.text as string) ?? '';
              if (delta) {
                yield { type: 'text_delta', text: delta, isSubagent: false };
              }
              const existingIdx = currentBlocks.findIndex(
                (b) => b.type === 'text' && (b as { _partId?: string })._partId === part.id,
              );
              if (existingIdx >= 0) {
                currentBlocks[existingIdx] = { type: 'text', text: part.text as string };
              } else {
                const block = { type: 'text' as const, text: part.text as string };
                Object.defineProperty(block, '_partId', { value: part.id, enumerable: false });
                currentBlocks.push(block);
              }
            } else if (partType === 'reasoning') {
              yield { type: 'thinking', text: props.delta ?? (part.text as string) ?? '', isSubagent: false };
              currentBlocks.push({ type: 'thinking', text: part.text as string });
            } else if (partType === 'tool') {
              const state = part.state as Record<string, unknown>;
              const status = state.status as string;
              const toolName = part.tool as string;
              const callId = (part.callID as string) ?? (part.id as string);
              const isSubagent = toolName === 'task';

              if (status === 'running') {
                yield {
                  type: 'tool_use',
                  toolName: isSubagent ? 'Agent' : toolName,
                  toolUseId: callId,
                  input: (state.input as unknown) ?? {},
                  isSubagent,
                };
                if (isSubagent) {
                  yield {
                    type: 'subagent_started',
                    taskId: callId,
                    description: (state.title as string) ?? toolName,
                    toolUseId: callId,
                  };
                }
              } else if (status === 'completed') {
                yield {
                  type: 'tool_result',
                  toolUseId: callId,
                  summary: (state.output as string) ?? '',
                };
                if (isSubagent) {
                  yield {
                    type: 'subagent_completed',
                    taskId: callId,
                    status: 'completed',
                    summary: (state.output as string) ?? '',
                  };
                }
                currentBlocks.push({
                  type: 'toolUse',
                  toolUseId: callId,
                  toolName: isSubagent ? 'Agent' : toolName,
                  input: (state.input as Record<string, unknown>) ?? {},
                });
                currentBlocks.push({
                  type: 'toolResult',
                  toolUseId: callId,
                  content: (state.output as string) ?? '',
                });
              } else if (status === 'error') {
                yield {
                  type: 'tool_result',
                  toolUseId: callId,
                  summary: (state.error as string) ?? 'Tool error',
                };
                if (isSubagent) {
                  yield {
                    type: 'subagent_completed',
                    taskId: callId,
                    status: 'failed',
                    summary: (state.error as string) ?? '',
                  };
                }
                currentBlocks.push({
                  type: 'toolResult',
                  toolUseId: callId,
                  content: (state.error as string) ?? 'Error',
                  isError: true,
                });
              }
            } else if (partType === 'step-finish') {
              const tokens = part.tokens as Record<string, number> | undefined;
              if (tokens) {
                totalUsage = {
                  inputTokens: totalUsage.inputTokens + (tokens.input ?? 0),
                  outputTokens: totalUsage.outputTokens + (tokens.output ?? 0),
                };
              }
            }
            break;
          }

          case 'session.idle': {
            const props = evt.properties as { sessionID: string };
            if (props.sessionID !== sessionId) break;

            if (currentBlocks.length > 0) {
              const msg: NormalizedMessage = {
                role: 'assistant',
                content: [...currentBlocks],
                timestamp: new Date().toISOString(),
              };
              rawMessages.push(msg);
              yield { type: 'assistant_message', message: msg };
              currentBlocks.length = 0;
            }

            const output = rawMessages
              .filter((m) => m.role === 'assistant')
              .flatMap((m) => m.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text))
              .join('\n');

            yield {
              type: 'result',
              output,
              rawMessages,
              usage: totalUsage,
              sessionId,
            };
            return;
          }

          case 'session.error': {
            const props = evt.properties as { sessionID?: string; error?: Record<string, unknown> };
            if (props.sessionID && props.sessionID !== sessionId) break;
            const errMsg = (props.error as Record<string, unknown>)?.message as string ?? 'Session error';
            yield { type: 'error', error: new Error(errMsg) };
            return;
          }

          default:
            break;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      clearTimeout(timeoutId);
      this.serverClose?.();
      this.serverClose = null;
    }
  }
}
