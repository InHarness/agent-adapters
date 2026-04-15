// Gemini adapter — uses @google/gemini-cli-core
// Auth: GOOGLE_API_KEY or GEMINI_API_KEY env var
//
// MCP: Full support via gemini-cli-core's Config.mcpServers (stdio, SSE, HTTP transports).
// The SDK handles tool discovery, transport management, and connection lifecycle internally.

import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
  UsageStats,
  McpServerConfig,
} from '../types.js';
import { AdapterInitError, AdapterTimeoutError, AdapterAbortError } from '../types.js';

// Dynamic type — SDK structure may change
type AgentEvent = {
  id: string;
  type: string;
  streamId: string;
  threadId?: string;
  timestamp: string;
  [key: string]: unknown;
};

/**
 * Map our McpServerConfig entries to gemini-cli-core MCPServerConfig instances.
 * Gemini supports stdio, SSE, and HTTP transports natively.
 */
function mapMcpServersToGemini(
  mcpServers: Record<string, McpServerConfig>,
  GeminiMCPServerConfig: new (...args: unknown[]) => unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, config] of Object.entries(mcpServers)) {
    const type = config.type;
    if (type === 'sdk') {
      // In-process SDK servers are not supported by Gemini CLI — skip
      continue;
    }
    if (!type || type === 'stdio') {
      const stdio = config as { command: string; args?: string[]; env?: Record<string, string> };
      result[name] = new GeminiMCPServerConfig(
        stdio.command,  // command
        stdio.args,     // args
        stdio.env,      // env
      );
    } else if (type === 'sse') {
      const sse = config as { url: string; headers?: Record<string, string> };
      result[name] = new GeminiMCPServerConfig(
        undefined,      // command
        undefined,      // args
        undefined,      // env
        undefined,      // cwd
        sse.url,        // url
        undefined,      // httpUrl
        sse.headers,    // headers
      );
    } else if (type === 'http') {
      const http = config as { url: string; headers?: Record<string, string> };
      result[name] = new GeminiMCPServerConfig(
        undefined,      // command
        undefined,      // args
        undefined,      // env
        undefined,      // cwd
        undefined,      // url
        http.url,       // httpUrl
        http.headers,   // headers
        undefined,      // tcp
        'http',         // type
      );
    }
  }
  return result;
}

// --- Normalization helpers ---

function contentPartsToBlocks(parts: Array<Record<string, unknown>>): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    switch (part.type) {
      case 'text':
        blocks.push({ type: 'text', text: part.text as string });
        break;
      case 'thought':
        // Gemini uses "thought" not "thinking"
        blocks.push({ type: 'thinking', text: part.thought as string });
        break;
      case 'media': {
        if (part.data) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              mediaType: (part.mimeType as string) ?? 'image/png',
              data: part.data as string,
            },
          });
        } else if (part.uri) {
          blocks.push({
            type: 'image',
            source: { type: 'url', url: part.uri as string },
          });
        }
        break;
      }
    }
  }
  return blocks;
}

// --- Adapter ---

export class GeminiAdapter implements RuntimeAdapter {
  architecture = 'gemini' as const;
  private abortFn: (() => Promise<void>) | null = null;
  private aborted = false;

  abort(): void {
    this.aborted = true;
    this.abortFn?.();
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AdapterInitError('gemini', new Error('GOOGLE_API_KEY or GEMINI_API_KEY env var is required'));

    let sdk: Record<string, unknown>;
    try {
      sdk = await import('@google/gemini-cli-core');
    } catch (err) {
      yield { type: 'error', error: new AdapterInitError('gemini', err) };
      return;
    }

    const LegacyAgentSession = sdk.LegacyAgentSession as new (deps: Record<string, unknown>) => {
      sendStream(payload: Record<string, unknown>): AsyncIterable<AgentEvent>;
      abort(): Promise<void>;
    };

    if (!LegacyAgentSession) {
      yield { type: 'error', error: new AdapterInitError('gemini', new Error('LegacyAgentSession not found in SDK')) };
      return;
    }

    const archConfig = params.architectureConfig ?? {};
    let session: { sendStream(payload: Record<string, unknown>): AsyncIterable<AgentEvent>; abort(): Promise<void> };

    try {
      const createContentGeneratorConfig = sdk.createContentGeneratorConfig as
        | ((opts: Record<string, unknown>) => Record<string, unknown>)
        | undefined;
      const createContentGenerator = sdk.createContentGenerator as
        | ((config: Record<string, unknown>) => Record<string, unknown>)
        | undefined;
      const GeminiClient = sdk.GeminiClient as (new (opts: Record<string, unknown>) => Record<string, unknown>) | undefined;
      const GeminiConfig = sdk.Config as (new (configParams: Record<string, unknown>) => Record<string, unknown>) | undefined;
      const GeminiMCPServerConfig = sdk.MCPServerConfig as (new (...args: unknown[]) => unknown) | undefined;

      if (!GeminiClient || !createContentGeneratorConfig || !createContentGenerator) {
        yield {
          type: 'error',
          error: new AdapterInitError(
            'gemini',
            new Error(
              'Gemini SDK missing required exports. The SDK is designed for the full Gemini CLI, not standalone usage. ' +
              'Consider wrapping the gemini CLI binary or using Gemini REST API directly.',
            ),
          ),
        };
        return;
      }

      const genConfig = createContentGeneratorConfig({
        model: params.model,
        apiKey,
        thinkingConfig: archConfig.gemini_thinkingBudget
          ? { thinkingBudget: archConfig.gemini_thinkingBudget as number }
          : archConfig.gemini_thinkingLevel
            ? { thinkingLevel: archConfig.gemini_thinkingLevel as string }
            : undefined,
        temperature: archConfig.gemini_temperature as number | undefined,
        topP: archConfig.gemini_topP as number | undefined,
        topK: archConfig.gemini_topK as number | undefined,
      });

      const generator = createContentGenerator(genConfig);
      const client = new GeminiClient({ contentGenerator: generator });

      // Build config — with MCP servers if provided and Config class is available
      let geminiConfig: Record<string, unknown>;
      if (GeminiConfig && params.mcpServers && Object.keys(params.mcpServers).length > 0 && GeminiMCPServerConfig) {
        const mcpServers = mapMcpServersToGemini(params.mcpServers, GeminiMCPServerConfig);
        geminiConfig = new GeminiConfig({
          model: params.model,
          cwd: params.cwd ?? process.cwd(),
          mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
        });
      } else {
        geminiConfig = { model: params.model } as Record<string, unknown>;
      }

      session = new LegacyAgentSession({
        config: geminiConfig,
        client,
      });
      this.abortFn = () => session.abort();
    } catch (err) {
      yield {
        type: 'error',
        error: new AdapterInitError(
          'gemini',
          new Error(
            `Failed to initialize Gemini infrastructure: ${err}. ` +
            'The @google/gemini-cli-core package requires full CLI config system. ' +
            'Consider wrapping the gemini CLI binary or using Gemini REST API directly.',
          ),
        ),
      };
      return;
    }

    const rawMessages: NormalizedMessage[] = [];
    let totalUsage: UsageStats = { inputTokens: 0, outputTokens: 0 };

    // Timeout handling
    let timedOut = false;
    this.aborted = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        this.aborted = true;
        this.abortFn?.();
      }, params.timeoutMs);
    }

    // Track subagent state via threadId
    const activeSubagents = new Set<string>();

    try {
      const eventStream = session.sendStream({
        message: {
          content: [{ type: 'text', text: params.prompt }],
        },
      });

      for await (const event of eventStream) {
        switch (event.type) {
          case 'message': {
            const role = event.role as string;
            const content = event.content as Array<Record<string, unknown>>;
            if (!content) break;

            const isSubagent = !!event.threadId;

            if (role === 'agent') {
              for (const part of content) {
                if (part.type === 'thought') {
                  yield { type: 'thinking', text: part.thought as string, isSubagent };
                } else if (part.type === 'text') {
                  yield { type: 'text_delta', text: part.text as string, isSubagent };
                }
              }

              const normalized: NormalizedMessage = {
                role: 'assistant',
                content: contentPartsToBlocks(content),
                timestamp: event.timestamp,
                subagentTaskId: event.threadId,
                native: event,
              };
              rawMessages.push(normalized);
              yield { type: 'assistant_message', message: normalized };
            }
            break;
          }

          case 'tool_request': {
            const isSubagent = !!event.threadId;
            yield {
              type: 'tool_use',
              toolName: event.name as string,
              toolUseId: event.requestId as string,
              input: event.args as unknown,
              isSubagent,
            };

            // Synthesize subagent_started from tool_request with threadId
            if (event.threadId && !activeSubagents.has(event.threadId)) {
              activeSubagents.add(event.threadId);
              yield {
                type: 'subagent_started',
                taskId: event.threadId,
                description: event.name as string,
                toolUseId: event.requestId as string,
              };
            }
            break;
          }

          case 'tool_response': {
            const content = event.content as Array<Record<string, unknown>> | undefined;
            const summary = content
              ?.filter((p) => p.type === 'text')
              .map((p) => p.text as string)
              .join('\n') ?? '';
            yield {
              type: 'tool_result',
              toolUseId: event.requestId as string,
              summary,
            };
            break;
          }

          case 'tool_update': {
            // Synthesize subagent_progress from tool_update with threadId
            if (event.threadId && activeSubagents.has(event.threadId)) {
              yield {
                type: 'subagent_progress',
                taskId: event.threadId,
                description: (event.status as string) ?? '',
                lastToolName: event.name as string | undefined,
              };
            }
            break;
          }

          case 'usage': {
            totalUsage = {
              inputTokens: totalUsage.inputTokens + ((event.inputTokens as number) ?? 0),
              outputTokens: totalUsage.outputTokens + ((event.outputTokens as number) ?? 0),
            };
            break;
          }

          case 'agent_end': {
            // Synthesize subagent_completed if this is a subagent thread ending
            if (event.threadId && activeSubagents.has(event.threadId)) {
              activeSubagents.delete(event.threadId);
              yield {
                type: 'subagent_completed',
                taskId: event.threadId,
                status: (event.reason as string) === 'failed' ? 'failed' : 'completed',
              };
              break;
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
            };
            break;
          }

          case 'error': {
            const fatal = event.fatal as boolean;
            yield { type: 'error', error: new Error((event.message as string) ?? 'Gemini error') };
            if (fatal) return;
            break;
          }

          default:
            // initialize, session_update, agent_start, elicitation_*, custom — ignored
            break;
        }
      }
    } catch (err) {
      if (this.aborted) {
        if (timedOut) {
          yield { type: 'error', error: new AdapterTimeoutError('gemini', params.timeoutMs!) };
        } else {
          yield { type: 'error', error: new AdapterAbortError('gemini') };
        }
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
