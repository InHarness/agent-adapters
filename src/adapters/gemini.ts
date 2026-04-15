// Gemini adapter — EXPERIMENTAL
// SDK: @google/gemini-cli-core (NOT a standalone SDK — requires full CLI infrastructure)
// Auth: GOOGLE_API_KEY or GEMINI_API_KEY env var
//
// This adapter documents the AgentEvent → UnifiedEvent mapping discovered during Spike 3.
// The SDK requires Config + GeminiClient + Scheduler infrastructure from the full Gemini CLI.
// For production use, consider wrapping the `gemini` CLI binary or using Gemini REST API directly.

import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
  UsageStats,
} from '../types.js';
import { AdapterInitError } from '../types.js';

// Dynamic type — SDK structure may change
type AgentEvent = {
  id: string;
  type: string;
  streamId: string;
  threadId?: string;
  timestamp: string;
  [key: string]: unknown;
};

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

  abort(): void {
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

    const config = params.architectureConfig ?? {};
    let session: { sendStream(payload: Record<string, unknown>): AsyncIterable<AgentEvent>; abort(): Promise<void> };

    try {
      const createContentGeneratorConfig = sdk.createContentGeneratorConfig as
        | ((opts: Record<string, unknown>) => Record<string, unknown>)
        | undefined;
      const createContentGenerator = sdk.createContentGenerator as
        | ((config: Record<string, unknown>) => Record<string, unknown>)
        | undefined;
      const GeminiClient = sdk.GeminiClient as (new (opts: Record<string, unknown>) => Record<string, unknown>) | undefined;

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
        thinkingConfig: config.gemini_thinkingBudget
          ? { thinkingBudget: config.gemini_thinkingBudget as number }
          : config.gemini_thinkingLevel
            ? { thinkingLevel: config.gemini_thinkingLevel as string }
            : undefined,
        temperature: config.gemini_temperature as number | undefined,
        topP: config.gemini_topP as number | undefined,
        topK: config.gemini_topK as number | undefined,
      });

      const generator = createContentGenerator(genConfig);
      const client = new GeminiClient({ contentGenerator: generator });

      session = new LegacyAgentSession({
        config: { model: params.model },
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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
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
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
