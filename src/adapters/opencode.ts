// OpenCode adapter — multi-provider via OpenRouter, SSE-based streaming
// SDK: @opencode-ai/sdk
// Auth: OPENROUTER_API_KEY env var
// Requires: opencode CLI in PATH

import { createOpencode } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';
import { createOpencodeClient as createOpencodeClientV2 } from '@opencode-ai/sdk/v2/client';
import type {
  RuntimeAdapter,
  RuntimeExecuteParams,
  UnifiedEvent,
  NormalizedMessage,
  ContentBlock,
  UsageStats,
  TodoItem,
  UserInputRequest,
  UserInputResponse,
  UserInputQuestion,
} from '../types.js';
import { AdapterInitError, AdapterTimeoutError, AdapterAbortError } from '../types.js';
import { resolveModel } from '../models.js';
import { redactSecrets } from '../redact.js';
import { materializeSkills, type MaterializedSkills, type MirroredSkills } from '../skills-tempdir.js';
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
  /** Populated by factory when a provider is configured. */
  _providerConfig?: Record<string, unknown>;

  abort(): void {
    this.abortController?.abort();
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Merge provider-resolved config with user-supplied config
    const config = { ...this._providerConfig, ...params.architectureConfig };

    const apiKey = (config.opencode_apiKey as string) ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      yield {
        type: 'error',
        error: new AdapterInitError('opencode', new Error('OPENROUTER_API_KEY env var is required')),
        phase: 'init',
      };
      return;
    }

    if (params.planMode) {
      console.warn('[agent-adapters] opencode: planMode not natively supported — ignored');
    }

    // Resolve model alias to full ID before splitting into provider/model
    const resolvedModel = resolveModel(this.architecture, params.model);

    // Provider ID and model can be overridden by provider config (e.g. MiniMax uses 'anthropic' provider).
    // When an override is set, the full resolved model is the modelID — the provider config key is
    // independent of the model namespace. OpenRouter is the canonical example: providerID='openrouter'
    // routes to the openrouter `provider:` config, while the API model is the full slug like
    // 'anthropic/claude-sonnet-4'. Stripping the prefix would mangle OpenRouter slugs.
    const overrideProviderID = config.opencode_providerID as string | undefined;
    let providerID: string;
    let modelID: string;
    if (overrideProviderID) {
      providerID = overrideProviderID;
      modelID = resolvedModel;
    } else {
      const modelParts = resolvedModel.split('/');
      if (modelParts.length > 1) {
        providerID = modelParts[0];
        modelID = modelParts.slice(1).join('/');
      } else {
        providerID = 'openrouter';
        modelID = resolvedModel;
      }
    }

    const port = getAvailablePort();

    // Build MCP config from params — OpenCode only supports stdio-based servers
    const mcpConfig: Record<string, unknown> = {};
    if (params.mcpServers) {
      for (const [name, serverConfig] of Object.entries(params.mcpServers)) {
        if (serverConfig.type && serverConfig.type !== 'stdio') {
          // SSE, HTTP, and SDK server types are not supported by OpenCode
          continue;
        }
        const stdioConfig = serverConfig as { command: string; args?: string[]; env?: Record<string, string> };
        mcpConfig[name] = {
          command: stdioConfig.command,
          args: stdioConfig.args,
          env: stdioConfig.env,
        };
      }
    }

    // Materialize inline skills BEFORE the server starts so opencode's first
    // skill scan picks them up. OpenCode has no server-level cwd override
    // (ServerOptions only takes hostname/port/signal/timeout/config), and the
    // server + v2 client both key by per-request `directory: cwd`. So we
    // mirror into <cwd>/.opencode/skills/agent-adapters-<uuid>-<slug>/SKILL.md
    // and remove only what we wrote in the finally below.
    const userCwd = params.cwd ?? process.cwd();
    let materialized: MaterializedSkills | undefined;
    let mirrored: MirroredSkills | undefined;
    if (params.skills?.length) {
      try {
        materialized = await materializeSkills(params.skills);
        mirrored = await materialized.mirrorTo(userCwd, '.opencode/skills');
      } catch (err) {
        await materialized?.cleanup().catch(() => {});
        yield { type: 'error', error: new AdapterInitError('opencode', err), phase: 'init' };
        return;
      }
    }

    let client: OpencodeClient;
    try {
      // Build provider entry — may include baseURL for custom backends
      const providerEntry: Record<string, unknown> = { api: apiKey };
      if (config.opencode_baseUrl) {
        providerEntry.baseURL = config.opencode_baseUrl as string;
      }

      // Model string: use override from provider config or derive from params
      const modelString = (config.opencode_model as string) ?? `${providerID}/${modelID}`;

      const opencodeConfig: Record<string, unknown> = {
        provider: {
          [providerID]: providerEntry,
        },
        agent: {
          build: {
            model: modelString,
            temperature: config.opencode_temperature as number | undefined,
            top_p: config.opencode_topP as number | undefined,
            permission: { edit: 'allow', bash: 'allow' },
          },
        },
      };

      if (Object.keys(mcpConfig).length > 0) {
        opencodeConfig.mcp = mcpConfig;
      }

      yield {
        type: 'adapter_ready',
        adapter: 'opencode',
        sdkConfig: redactSecrets({ port, config: opencodeConfig }),
      };

      const result = await createOpencode({
        signal,
        port,
        config: opencodeConfig,
      });
      client = result.client;
      this.serverClose = result.server.close;
    } catch (err) {
      await mirrored?.cleanupMirror().catch(() => {});
      await materialized?.cleanup().catch(() => {});
      yield { type: 'error', error: new AdapterInitError('opencode', err), phase: 'init' };
      return;
    }

    const rawMessages: NormalizedMessage[] = [];
    let totalUsage: UsageStats = { inputTokens: 0, outputTokens: 0 };
    let sessionId: string | undefined;
    let lastTodoSnapshot: TodoItem[] | undefined;

    // v2 client for the question API (reply/reject). v2 SDK is additive over v1 —
    // both clients talk to the same server on the same port.
    type PendingUserInput = {
      req: UserInputRequest;
      resolve: (res: UserInputResponse) => void;
    };
    const pendingUserInputs: PendingUserInput[] = [];
    // Meta events (warnings/errors) surfaced from background tasks like the v2
    // question subscription IIFE, which cannot yield directly. The main loop
    // drains this alongside pendingUserInputs.
    const pendingMetaEvents: UnifiedEvent[] = [];
    let userInputWaker: (() => void) | null = null;
    let v2Client: ReturnType<typeof createOpencodeClientV2> | undefined;
    let v2SubscriptionCancel: (() => void) | undefined;

    const maybeInitV2 = () => {
      if (!params.onUserInput || v2Client) return;
      v2Client = createOpencodeClientV2({ baseUrl: `http://127.0.0.1:${port}` } as unknown as Parameters<typeof createOpencodeClientV2>[0]);
      const cwd = params.cwd ?? process.cwd();
      // Parallel SSE subscription just for question events. Pushes pending entries
      // into the queue and wakes the main loop. Swallow errors — question flow is
      // an optional enhancement; the main v1 stream is authoritative.
      (async () => {
        try {
          const sub = await v2Client!.event.subscribe({ directory: cwd });
          v2SubscriptionCancel = () => {
            try {
              (sub as { stream?: { cancel?: () => void } }).stream?.cancel?.();
            } catch {
              /* noop */
            }
          };
          const stream = (sub as { stream?: AsyncIterable<unknown> }).stream;
          if (!stream) return;
          for await (const evt of stream) {
            if (signal.aborted) return;
            const e = evt as { type?: string; properties?: Record<string, unknown> };
            if (e.type !== 'question.asked') continue;
            const props = e.properties as {
              id: string;
              sessionID: string;
              questions: Array<{
                question: string;
                header?: string;
                options: Array<{ label: string; description: string }>;
                multiple?: boolean;
                custom?: boolean;
              }>;
              tool?: { messageID: string; callID: string };
            };
            if (sessionId && props.sessionID && props.sessionID !== sessionId) continue;
            const questions: UserInputQuestion[] = props.questions.map((q) => ({
              question: q.question,
              header: q.header,
              options: q.options.map((o) => ({ label: o.label, description: o.description })),
              multiSelect: q.multiple,
              allowCustom: q.custom,
            }));
            const req: UserInputRequest = {
              requestId: props.id,
              source: 'model-tool',
              origin: 'opencode',
              questions,
              native: props,
            };
            await new Promise<UserInputResponse>((resolve) => {
              pendingUserInputs.push({ req, resolve });
              userInputWaker?.();
              userInputWaker = null;
            }).then(async (res) => {
              if (!v2Client) return;
              try {
                if (res.action === 'accept' && res.answers) {
                  await v2Client.question.reply({ requestID: props.id, directory: cwd, answers: res.answers });
                } else {
                  await v2Client.question.reject({ requestID: props.id, directory: cwd });
                }
              } catch {
                /* best-effort */
              }
            });
          }
        } catch (err) {
          // SSE setup or iteration failed. The main v1 stream is authoritative,
          // so we don't error out the run — but we surface a warning so the
          // user-input feature's absence isn't invisible.
          pendingMetaEvents.push({
            type: 'warning',
            message: `opencode: v2 question subscription failed (${err instanceof Error ? err.message : String(err)}) — user-input flow disabled for this session`,
          });
          userInputWaker?.();
          userInputWaker = null;
        }
      })();
    };
    maybeInitV2();

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
      // 1. Create session
      const cwd = params.cwd ?? process.cwd();
      const sessionResult = await client.session.create({
        query: { directory: cwd },
      });
      const session = (sessionResult as { data?: { id?: string } }).data;
      sessionId = session?.id;

      if (!sessionId) {
        yield { type: 'error', error: new Error('Failed to create OpenCode session'), phase: 'runtime' };
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
        yield { type: 'error', error: new Error('SSE stream not available'), phase: 'runtime' };
        return;
      }

      const currentBlocks: ContentBlock[] = [];
      let lastMessageId: string | undefined;
      // OpenCode's SSE does not attach a task/call ID to text/reasoning deltas.
      // We correlate by ordering: deltas observed between a task tool's
      // running → completed/error window are attributed to that task.
      // Assumes chronological SSE delivery and a single active subagent
      // (OpenCode doesn't ship nested tasks today — if it ever does, this
      // must become a stack).
      let activeSubagentTaskId: string | undefined;

      const v1Iterator = sseResult.stream[Symbol.asyncIterator]();
      let pendingNext: Promise<IteratorResult<unknown>> | null = null;

      outer: while (true) {
        // Drain meta events (warnings/errors from background tasks) first.
        while (pendingMetaEvents.length > 0) {
          yield pendingMetaEvents.shift()!;
        }
        // Drain pending user-input requests before consuming the next v1 event.
        while (pendingUserInputs.length > 0) {
          const { req, resolve } = pendingUserInputs.shift()!;
          yield { type: 'user_input_request', request: req };
          if (!params.onUserInput) {
            resolve({ action: 'decline' });
            continue;
          }
          try {
            const res = await params.onUserInput(req);
            resolve(res);
          } catch (err) {
            resolve({ action: 'cancel' });
            yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)), phase: 'runtime' };
          }
        }

        if (!pendingNext) pendingNext = v1Iterator.next();
        const wake = new Promise<'wake'>((resolve) => {
          userInputWaker = () => resolve('wake');
        });
        const winner = await Promise.race([
          pendingNext.then((r) => ({ kind: 'sdk' as const, value: r })),
          wake.then(() => ({ kind: 'wake' as const })),
        ]);
        userInputWaker = null;
        if (winner.kind === 'wake') continue;
        pendingNext = null;
        if (winner.value.done) break outer;
        const event = winner.value.value;

        if (signal.aborted) {
          if (timedOut) {
            yield { type: 'error', error: new AdapterTimeoutError('opencode', params.timeoutMs!), phase: 'runtime' };
          } else {
            yield { type: 'error', error: new AdapterAbortError('opencode'), phase: 'runtime' };
          }
          return;
        }

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
                yield {
                  type: 'text_delta',
                  text: delta,
                  isSubagent: activeSubagentTaskId != null,
                  subagentTaskId: activeSubagentTaskId,
                };
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
              yield {
                type: 'thinking',
                text: props.delta ?? (part.text as string) ?? '',
                isSubagent: activeSubagentTaskId != null,
                subagentTaskId: activeSubagentTaskId,
              };
              currentBlocks.push({ type: 'thinking', text: part.text as string });
            } else if (partType === 'tool') {
              const state = part.state as Record<string, unknown>;
              const status = state.status as string;
              const toolName = part.tool as string;
              const callId = (part.callID as string) ?? (part.id as string);
              const isSubagent = toolName === 'task';

              if (status === 'running') {
                if (isSubagent) activeSubagentTaskId = callId;
                yield {
                  type: 'tool_use',
                  toolName: isSubagent ? 'Agent' : toolName,
                  toolUseId: callId,
                  input: (state.input as unknown) ?? {},
                  isSubagent,
                  subagentTaskId: isSubagent ? callId : activeSubagentTaskId,
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
                  isSubagent,
                  subagentTaskId: isSubagent ? callId : activeSubagentTaskId,
                };
                if (isSubagent) {
                  yield {
                    type: 'subagent_completed',
                    taskId: callId,
                    status: 'completed',
                    summary: (state.output as string) ?? '',
                  };
                  if (activeSubagentTaskId === callId) activeSubagentTaskId = undefined;
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
                  isSubagent,
                  isError: true,
                  subagentTaskId: isSubagent ? callId : activeSubagentTaskId,
                };
                if (isSubagent) {
                  yield {
                    type: 'subagent_completed',
                    taskId: callId,
                    status: 'failed',
                    summary: (state.error as string) ?? '',
                  };
                  if (activeSubagentTaskId === callId) activeSubagentTaskId = undefined;
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

          case 'todo.updated': {
            const props = evt.properties as {
              sessionID?: string;
              todos?: Array<{
                id?: string;
                content?: string;
                status?: string;
                priority?: string;
              }>;
            };
            if (props.sessionID && props.sessionID !== sessionId) break;
            const rawTodos = Array.isArray(props.todos) ? props.todos : [];
            const items: TodoItem[] = rawTodos.map((t, idx) => ({
              id: typeof t.id === 'string' ? t.id : String(idx),
              content: typeof t.content === 'string' ? t.content : '',
              status: (typeof t.status === 'string' ? t.status : 'pending') as TodoItem['status'],
              ...(t.priority === 'low' || t.priority === 'medium' || t.priority === 'high'
                ? { priority: t.priority }
                : {}),
            }));
            lastTodoSnapshot = items;
            yield {
              type: 'todo_list_updated',
              items,
              source: 'session-state',
              isSubagent: false,
            };
            // Synthesize an assistant message so rawMessages has a consistent
            // cross-adapter history of todo changes. `native: undefined`
            // signals that this message is a projection from the session-state
            // channel, not a passthrough of any SDK message.
            rawMessages.push({
              role: 'assistant',
              content: [{ type: 'todoList', items }],
              timestamp: new Date().toISOString(),
              native: undefined,
            });
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
              ...(lastTodoSnapshot ? { todoListSnapshot: lastTodoSnapshot } : {}),
            };
            return;
          }

          case 'session.error': {
            const props = evt.properties as { sessionID?: string; error?: Record<string, unknown> };
            if (props.sessionID && props.sessionID !== sessionId) break;
            // OpenCode wraps upstream errors as { name, data: { message } }; fall back to a
            // top-level message for older shapes, then to a generic label.
            const errObj = props.error as Record<string, unknown> | undefined;
            const errData = errObj?.data as Record<string, unknown> | undefined;
            const errMsg =
              (errData?.message as string | undefined) ??
              (errObj?.message as string | undefined) ??
              'Session error';
            yield { type: 'error', error: new Error(errMsg), phase: 'runtime' };
            return;
          }

          default:
            break;
        }
      }
    } catch (err) {
      v2SubscriptionCancel?.();
      if (signal.aborted) {
        if (timedOut) {
          yield { type: 'error', error: new AdapterTimeoutError('opencode', params.timeoutMs!), phase: 'runtime' };
        } else {
          yield { type: 'error', error: new AdapterAbortError('opencode'), phase: 'runtime' };
        }
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)), phase: 'runtime' };
    } finally {
      v2SubscriptionCancel?.();
      clearTimeout(timeoutId);
      this.serverClose?.();
      this.serverClose = null;
      await mirrored?.cleanupMirror().catch((err) =>
        console.warn('[agent-adapters] opencode mirrored skill cleanup failed', err),
      );
      await materialized?.cleanup().catch((err) =>
        console.warn('[agent-adapters] opencode skill cleanup failed', err),
      );
    }
  }
}
