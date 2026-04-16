// Claude Code adapter — reference adapter, closest mapping to UnifiedEvent
// SDK: @anthropic-ai/claude-agent-sdk
// Auth: SDK manages internally (OAuth, cached credentials, ANTHROPIC_API_KEY)

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, Options, Query } from '@anthropic-ai/claude-agent-sdk';
import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
  McpSdkServerConfig,
} from '../types.js';
import { AdapterInitError, AdapterTimeoutError, AdapterAbortError } from '../types.js';
import { resolveModel, ADAPTIVE_THINKING_ONLY } from '../models.js';

// Re-export SDK MCP primitives for consumers building in-process MCP servers
export { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

// Re-export generic MCP builder from the library
export { createMcpServer, mcpTool } from '../mcp.js';
export type {
  McpToolDefinition,
  McpToolHandler,
  McpToolResult,
  CreateMcpServerOptions,
  McpServerInstance,
} from '../mcp.js';

// --- Normalization helpers ---

function normalizeContentBlocks(blocks: unknown[]): ContentBlock[] {
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

function normalizeAssistantMessage(msg: SDKMessage & { type: 'assistant' }): NormalizedMessage {
  const betaMessage = msg.message as unknown as Record<string, unknown>;
  const content = Array.isArray(betaMessage.content) ? betaMessage.content : [];
  return {
    role: 'assistant',
    content: normalizeContentBlocks(content),
    timestamp: new Date().toISOString(),
    subagentTaskId: msg.parent_tool_use_id ?? undefined,
    native: msg,
  };
}

// --- Adapter ---

export class ClaudeCodeAdapter implements RuntimeAdapter {
  architecture = 'claude-code' as const;
  private abortController: AbortController | null = null;
  /** Populated by factory when a provider is configured. */
  _providerConfig?: Record<string, unknown>;

  abort(): void {
    this.abortController?.abort();
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    this.abortController = new AbortController();

    const resolvedModel = resolveModel(this.architecture, params.model);

    const options: Options = {
      abortController: this.abortController,
      model: resolvedModel,
      systemPrompt: params.systemPrompt,
      maxTurns: params.maxTurns,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      cwd: params.cwd ?? process.cwd(),
      includePartialMessages: true,
    };

    // Architecture-specific config (merge provider-resolved config with user-supplied config)
    const config = { ...this._providerConfig, ...params.architectureConfig };

    if (config.claude_thinking) {
      const thinkingCfg = config.claude_thinking as Record<string, unknown>;
      if (thinkingCfg.type === 'enabled' && ADAPTIVE_THINKING_ONLY.has(resolvedModel)) {
        console.warn(
          `[agent-adapters] Model "${resolvedModel}" only supports adaptive thinking. ` +
            `Auto-converting { type: 'enabled' } → { type: 'adaptive' }.`,
        );
        options.thinking = { type: 'adaptive' } as Options['thinking'];
      } else {
        options.thinking = thinkingCfg as Options['thinking'];
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

    const rawMessages: NormalizedMessage[] = [];
    let sessionId: string | undefined;

    // Timeout handling
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        this.abortController?.abort();
      }, params.timeoutMs);
    }

    let q: Query;
    try {
      q = query({ prompt: params.prompt, options });
    } catch (err) {
      clearTimeout(timeoutId);
      throw new AdapterInitError('claude-code', err);
    }

    try {
      for await (const event of q) {
        if (this.abortController.signal.aborted) {
          if (timedOut) {
            yield { type: 'error', error: new AdapterTimeoutError('claude-code', params.timeoutMs!) };
          } else {
            yield { type: 'error', error: new AdapterAbortError('claude-code') };
          }
          return;
        }

        sessionId = (event as Record<string, unknown>).session_id as string | undefined ?? sessionId;

        switch (event.type) {
          case 'stream_event': {
            const streamEvent = event.event as unknown as Record<string, unknown>;
            const isSubagent = event.parent_tool_use_id != null;

            if (streamEvent.type === 'content_block_delta') {
              const delta = streamEvent.delta as Record<string, unknown>;
              if (delta.type === 'text_delta') {
                yield { type: 'text_delta', text: delta.text as string, isSubagent };
              } else if (delta.type === 'thinking_delta') {
                yield { type: 'thinking', text: delta.thinking as string, isSubagent };
              }
            }
            break;
          }

          case 'assistant': {
            const normalized = normalizeAssistantMessage(event);
            rawMessages.push(normalized);
            const isSubagent = event.parent_tool_use_id != null;

            for (const block of normalized.content) {
              if (block.type === 'toolUse') {
                yield {
                  type: 'tool_use',
                  toolName: block.toolName,
                  toolUseId: block.toolUseId,
                  input: block.input,
                  isSubagent,
                };
              }
            }

            yield { type: 'assistant_message', message: normalized };
            break;
          }

          case 'user': {
            const userMsg = event as Record<string, unknown>;
            const isSubagent = (userMsg as Record<string, unknown>).parent_tool_use_id != null;
            const message = userMsg.message as Record<string, unknown>;
            if (message && Array.isArray(message.content)) {
              const normalized: NormalizedMessage = {
                role: 'user',
                content: normalizeContentBlocks(message.content),
                timestamp: new Date().toISOString(),
                native: event,
              };
              rawMessages.push(normalized);

              for (const block of normalized.content) {
                if (block.type === 'toolResult') {
                  yield { type: 'tool_result', toolUseId: block.toolUseId, summary: block.content, isSubagent };
                }
              }
            }
            break;
          }

          case 'tool_use_summary': {
            const isSubagent = (event as Record<string, unknown>).parent_tool_use_id != null;
            yield {
              type: 'tool_result',
              toolUseId: event.preceding_tool_use_ids?.[0] ?? 'unknown',
              summary: event.summary,
              isSubagent,
            };
            break;
          }

          case 'system': {
            const subtype = (event as Record<string, unknown>).subtype as string;
            if (subtype === 'task_started') {
              const e = event as Record<string, unknown>;
              yield {
                type: 'subagent_started',
                taskId: e.task_id as string,
                description: e.description as string,
                toolUseId: (e.tool_use_id as string) ?? '',
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
                usage: e.usage,
              };
            } else if (subtype === 'compact_boundary') {
              yield { type: 'flush' };
            }
            break;
          }

          case 'result': {
            const resultEvent = event as Record<string, unknown>;
            if (resultEvent.subtype === 'success') {
              const usage = resultEvent.usage as Record<string, number> | undefined;
              yield {
                type: 'result',
                output: (resultEvent.result as string) ?? '',
                rawMessages,
                usage: {
                  inputTokens: usage?.input_tokens ?? 0,
                  outputTokens: usage?.output_tokens ?? 0,
                },
                sessionId,
              };
            } else {
              yield { type: 'error', error: new Error((resultEvent.result as string) ?? 'Unknown error') };
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
          yield { type: 'error', error: new AdapterTimeoutError('claude-code', params.timeoutMs!) };
        } else {
          yield { type: 'error', error: new AdapterAbortError('claude-code') };
        }
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
