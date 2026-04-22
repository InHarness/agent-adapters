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
  UsageStats,
  TodoItem,
  UserInputRequest,
  UserInputResponse,
  UserInputHandler,
  UserInputQuestion,
  ElicitationRequest,
  ElicitationResponse,
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
const CLAUDE_CODE_READONLY_BUILTINS: string[] = [
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'AskUserQuestion',
];
const CLAUDE_CODE_MUTATING_BUILTINS: string[] = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'Task',
];

// --- Normalization helpers ---

function normalizeClaudeUsage(raw: unknown): UsageStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
  const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
  const cacheReadInputTokens = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined;
  const cacheCreationInputTokens = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : undefined;
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

function safeParseJson(s: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
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

    // Architecture-specific config (merge provider-resolved config with user-supplied config)
    const config = { ...this._providerConfig, ...params.architectureConfig };

    if (config.claude_thinking) {
      const mode = config.claude_thinking as 'adaptive' | 'enabled';
      const budget = config.claude_thinking_budget as number | undefined;

      if (mode === 'enabled' && ADAPTIVE_THINKING_ONLY.has(resolvedModel)) {
        console.warn(
          `[agent-adapters] Model "${resolvedModel}" only supports adaptive thinking. ` +
            `Auto-converting 'enabled' → 'adaptive'.`,
        );
        options.thinking = { type: 'adaptive' } as Options['thinking'];
      } else if (mode === 'enabled') {
        options.thinking = {
          type: 'enabled',
          ...(budget ? { budgetTokens: budget } : {}),
        } as Options['thinking'];
      } else {
        options.thinking = { type: 'adaptive' } as Options['thinking'];
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
    // Track TodoWrite tool_use IDs so we can suppress their matching tool_result
    // (both the UnifiedEvent and the ContentBlock in rawMessages). The payload
    // of that tool_result is `{ oldTodos, newTodos }` — redundant with the
    // snapshot already surfaced via `todoList` / `todo_list_updated`.
    const pendingTodoToolUseIds = new Set<string>();
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

    let q: Query;
    try {
      q = query({ prompt: params.prompt, options });
    } catch (err) {
      clearTimeout(timeoutId);
      throw new AdapterInitError('claude-code', err);
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
            yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
          }
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

            // Replace TodoWrite `toolUse` blocks with unified `todoList` blocks
            // in-place so rawMessages and the assistant_message event both
            // carry the normalized shape.
            for (let i = 0; i < normalized.content.length; i++) {
              const block = normalized.content[i];
              if (block.type === 'toolUse' && block.toolName === 'TodoWrite') {
                const items = todoItemsFromTodoWriteInput(block.input);
                pendingTodoToolUseIds.add(block.toolUseId);
                lastTodoSnapshot = items;
                normalized.content[i] = { type: 'todoList', items };
              }
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
              // Strip tool_result blocks that correspond to a TodoWrite tool_use
              // we already projected as `todo_list_updated`. The tool_result's
              // `{ oldTodos, newTodos }` payload is redundant and would leak
              // the raw TodoWrite shape back into rawMessages / the event stream.
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
              yield {
                type: 'result',
                output: (resultEvent.result as string) ?? '',
                rawMessages,
                // Session-cumulative total from the SDK — do not double-count with per-message usage on NormalizedMessage.
                usage: normalizeClaudeUsage(resultEvent.usage) ?? { inputTokens: 0, outputTokens: 0 },
                sessionId,
                ...(lastTodoSnapshot ? { todoListSnapshot: lastTodoSnapshot } : {}),
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
