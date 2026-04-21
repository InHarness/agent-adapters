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
  UserInputRequest,
  UserInputResponse,
  UserInputQuestion,
} from '../types.js';
import { AdapterInitError, AdapterTimeoutError, AdapterAbortError } from '../types.js';
import { resolveModel } from '../models.js';

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

/** @internal Exported for unit tests. */
export function contentPartsToBlocks(parts: Array<Record<string, unknown>>): ContentBlock[] {
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
    const resolvedModel = resolveModel(this.architecture, params.model);
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AdapterInitError('gemini', new Error('GOOGLE_API_KEY or GEMINI_API_KEY env var is required'));

    let sdk: Record<string, unknown>;
    try {
      sdk = await import('@google/gemini-cli-core');
    } catch (err) {
      yield { type: 'error', error: new AdapterInitError('gemini', err) };
      return;
    }

    const GeminiConfig = sdk.Config as
      | (new (params: Record<string, unknown>) => {
          initialize(): Promise<void>;
          refreshAuth(authType: string, apiKey?: string): Promise<void>;
          storage: { getProjectTempDir(): string };
        })
      | undefined;
    const GeminiClient = sdk.GeminiClient as
      | (new (ctx: unknown) => {
          initialize(): Promise<void>;
          resumeChat(
            history: Array<{ role: string; parts: unknown[] }>,
            resumedSessionData: { conversation: unknown; filePath: string },
          ): Promise<void>;
        })
      | undefined;
    const LegacyAgentSession = sdk.LegacyAgentSession as
      | (new (deps: Record<string, unknown>) => {
          sendStream(payload: Record<string, unknown>): AsyncIterable<AgentEvent>;
          abort(): Promise<void>;
        })
      | undefined;
    const GeminiMCPServerConfig = sdk.MCPServerConfig as (new (...args: unknown[]) => unknown) | undefined;
    const AuthType = sdk.AuthType as Record<string, string> | undefined;
    const MessageBusType = sdk.MessageBusType as Record<string, string> | undefined;
    const ToolConfirmationOutcome = sdk.ToolConfirmationOutcome as Record<string, string> | undefined;

    if (!GeminiConfig || !GeminiClient || !LegacyAgentSession || !AuthType) {
      yield {
        type: 'error',
        error: new AdapterInitError(
          'gemini',
          new Error('Gemini SDK missing required exports (Config/GeminiClient/LegacyAgentSession/AuthType).'),
        ),
      };
      return;
    }

    const archConfig = params.architectureConfig ?? {};
    const debug = (archConfig.debug as boolean | undefined) ?? false;
    const approvalMode = params.planMode
      ? 'plan'
      : ((archConfig.gemini_approvalMode as string | undefined) ?? 'yolo');
    const cwd = params.cwd ?? process.cwd();

    const generateContentConfig: Record<string, unknown> = {};
    if (archConfig.gemini_temperature !== undefined) generateContentConfig.temperature = archConfig.gemini_temperature;
    if (archConfig.gemini_topP !== undefined) generateContentConfig.topP = archConfig.gemini_topP;
    if (archConfig.gemini_topK !== undefined) generateContentConfig.topK = archConfig.gemini_topK;
    if (archConfig.gemini_thinkingBudget) {
      generateContentConfig.thinkingConfig = { thinkingBudget: archConfig.gemini_thinkingBudget };
    } else if (archConfig.gemini_thinkingLevel) {
      generateContentConfig.thinkingConfig = { thinkingLevel: archConfig.gemini_thinkingLevel };
    }
    const hasModelParams = Object.keys(generateContentConfig).length > 0;

    const mappedMcpServers =
      params.mcpServers && GeminiMCPServerConfig ? mapMcpServersToGemini(params.mcpServers, GeminiMCPServerConfig) : {};

    let session: {
      sendStream(payload: Record<string, unknown>): AsyncIterable<AgentEvent>;
      abort(): Promise<void>;
    };
    let geminiConfigRef: {
      messageBus?: {
        subscribe(type: string, listener: (msg: Record<string, unknown>) => void): void;
        publish(msg: Record<string, unknown>): Promise<void>;
      };
    } | undefined;

    const { randomUUID } = await import('node:crypto');
    const effectiveSessionId = params.resumeSessionId ?? randomUUID();

    try {
      // Only exclude ask_user when the consumer didn't wire a handler — otherwise
      // allow the model to invoke it and bridge responses via MessageBus below.
      const excludeTools = params.onUserInput ? undefined : ['ask_user'];

      const geminiConfig = new GeminiConfig({
        sessionId: effectiveSessionId,
        targetDir: cwd,
        cwd,
        debugMode: debug,
        model: resolvedModel,
        approvalMode,
        excludeTools,
        maxSessionTurns: params.maxTurns ?? -1,
        mcpServers: Object.keys(mappedMcpServers).length > 0 ? mappedMcpServers : undefined,
        modelConfigServiceConfig: hasModelParams
          ? { overrides: [{ match: { model: resolvedModel }, modelConfig: { generateContentConfig } }] }
          : undefined,
      });

      await geminiConfig.initialize();
      await geminiConfig.refreshAuth(AuthType.USE_GEMINI, apiKey);

      // Locate prior session file using the SDK's own project-identifier mapping
      // (~/.gemini/projects.json → slug-based temp dir). This must run after
      // geminiConfig.initialize() which populates storage.projectIdentifier.
      let resumedSessionData:
        | { conversation: { messages: Array<{ type: string; content: unknown }> }; filePath: string }
        | undefined;
      if (params.resumeSessionId) {
        const { join } = await import('node:path');
        const { readdir, readFile } = await import('node:fs/promises');
        const chatsDir = join(geminiConfig.storage.getProjectTempDir(), 'chats');
        const shortId = params.resumeSessionId.slice(0, 8);
        try {
          const files = await readdir(chatsDir);
          const match = files.find((f) => f.startsWith('session-') && f.endsWith(`-${shortId}.json`));
          if (match) {
            const filePath = join(chatsDir, match);
            const record = JSON.parse(await readFile(filePath, 'utf8'));
            resumedSessionData = { conversation: record, filePath };
          }
        } catch {
          // No prior session directory — start fresh with effectiveSessionId.
        }
      }

      const client = new GeminiClient(geminiConfig);
      // Avoid calling client.initialize() when resuming — initialize() calls
      // startChat() without resumedSessionData, which overwrites the existing
      // session file on disk (SDK's filename uses minute-precision timestamp +
      // shortId, so same-minute turns collide). resumeChat() alone sets up the
      // chat state and points ChatRecordingService at the existing file.
      if (resumedSessionData) {
        const history = resumedSessionData.conversation.messages
          .filter((m) => m.type === 'user' || m.type === 'gemini')
          .map((m) => ({
            role: m.type === 'gemini' ? 'model' : 'user',
            parts: Array.isArray(m.content) ? (m.content as unknown[]) : [m.content],
          }));
        await client.resumeChat(history, resumedSessionData);
      } else {
        await client.initialize();
      }

      session = new LegacyAgentSession({ config: geminiConfig, client });
      this.abortFn = () => session.abort();
      geminiConfigRef = geminiConfig as unknown as {
        messageBus?: {
          subscribe(type: string, listener: (msg: Record<string, unknown>) => void): void;
          publish(msg: Record<string, unknown>): Promise<void>;
        };
      };
    } catch (err) {
      yield {
        type: 'error',
        error: new AdapterInitError('gemini', err instanceof Error ? err : new Error(String(err))),
      };
      return;
    }

    const rawMessages: NormalizedMessage[] = [];
    let totalUsage: UsageStats = { inputTokens: 0, outputTokens: 0 };

    // User-input bridge via Gemini's MessageBus (ask_user tool ↔ onUserInput).
    type PendingUserInput = { req: UserInputRequest; correlationId: string };
    const pendingUserInputs: PendingUserInput[] = [];
    let userInputWaker: (() => void) | null = null;

    // ask_user in Gemini doesn't publish to ASK_USER_REQUEST — it publishes a
    // TOOL_CONFIRMATION_REQUEST with `details.type === 'ask_user'` and waits for
    // TOOL_CONFIRMATION_RESPONSE. The scheduler ALSO subscribes and immediately
    // replies with `requiresUserConfirmation: true` (which awaitConfirmation maps
    // to Cancel). To win, we subscribe FIRST (before sendStream → scheduler init)
    // and publish a ProceedOnce response with payload.answers as soon as we get
    // the user's answer back from onUserInput.
    // KNOWN LIMITATION: gemini ask_user integration is partial.
    //
    // The SDK routes ask_user through TOOL_CONFIRMATION_REQUEST with `details.type === 'ask_user'`,
    // not the (defined-but-unused) ASK_USER_REQUEST channel. Worse, the Scheduler subscribes to
    // TOOL_CONFIRMATION_REQUEST during construction and IMMEDIATELY publishes a default response
    // with `requiresUserConfirmation: true` (which awaitConfirmation maps to Cancel). Because our
    // onUserInput callback is async, our real reply loses the race.
    //
    // We still wire the subscription so the unified UnifiedEvent fires (consumers can observe the
    // request), but the model will see a Cancel and the tool will return "User dismissed dialog".
    // A complete fix requires either monkey-patching messageBus.publish or replacing the Scheduler's
    // subscriber — both invasive. Tracked separately.
    if (params.onUserInput && MessageBusType && ToolConfirmationOutcome && geminiConfigRef?.messageBus) {
      const bus = geminiConfigRef.messageBus;
      bus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, (rawMsg) => {
        const msg = rawMsg as {
          correlationId: string;
          details?: { type?: string; questions?: Array<Record<string, unknown>> };
        };
        const details = msg.details;
        if (!details || details.type !== 'ask_user') return;
        const correlationId = msg.correlationId;
        const rawQuestions = Array.isArray(details.questions) ? details.questions : [];
        const questions: UserInputQuestion[] = rawQuestions.map((q) => {
          const qType = q.type as 'choice' | 'text' | 'yesno' | undefined;
          if (qType === 'yesno') {
            return {
              question: q.question as string,
              header: q.header as string | undefined,
              options: [{ label: 'Yes' }, { label: 'No' }],
              allowCustom: true,
              placeholder: q.placeholder as string | undefined,
            };
          }
          if (qType === 'text') {
            return {
              question: q.question as string,
              header: q.header as string | undefined,
              placeholder: q.placeholder as string | undefined,
            };
          }
          const opts = Array.isArray(q.options) ? (q.options as Array<Record<string, unknown>>) : [];
          return {
            question: q.question as string,
            header: q.header as string | undefined,
            options: opts.map((o) => ({
              label: o.label as string,
              description: o.description as string | undefined,
            })),
            multiSelect: q.multiSelect as boolean | undefined,
          };
        });
        const req: UserInputRequest = {
          requestId: correlationId,
          source: 'model-tool',
          origin: 'gemini',
          questions,
          native: msg,
        };
        pendingUserInputs.push({ req, correlationId });
        userInputWaker?.();
        userInputWaker = null;
      });
    }

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

      const sdkIterator = eventStream[Symbol.asyncIterator]();
      let pendingNext: Promise<IteratorResult<AgentEvent>> | null = null;

      outer: while (true) {
        // Drain pending user-input requests first.
        while (pendingUserInputs.length > 0) {
          const { req, correlationId } = pendingUserInputs.shift()!;
          yield { type: 'user_input_request', request: req };
          let res: UserInputResponse;
          try {
            res = params.onUserInput ? await params.onUserInput(req) : { action: 'decline' };
          } catch (err) {
            res = { action: 'cancel' };
            yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
          }
          const bus = geminiConfigRef?.messageBus;
          if (bus && MessageBusType && ToolConfirmationOutcome) {
            // Reply on the TOOL_CONFIRMATION_RESPONSE channel with payload.answers
            // — this is what AskUserTool.shouldConfirmExecute.onConfirm reads.
            const answersMap: Record<string, string> = {};
            if (res.action === 'accept' && res.answers) {
              res.answers.forEach((answer, idx) => {
                answersMap[String(idx)] = answer.join(', ');
              });
            }
            await bus.publish({
              type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
              correlationId,
              confirmed: res.action === 'accept',
              outcome:
                res.action === 'accept'
                  ? ToolConfirmationOutcome.ProceedOnce
                  : ToolConfirmationOutcome.Cancel,
              payload: res.action === 'accept' ? { answers: answersMap } : undefined,
            });
          }
        }

        if (!pendingNext) pendingNext = sdkIterator.next();
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

        switch (event.type) {
          case 'message': {
            const role = event.role as string;
            const content = event.content as Array<Record<string, unknown>>;
            if (!content) break;

            const isSubagent = !!event.threadId;
            const subagentTaskId = event.threadId as string | undefined;

            if (role === 'agent') {
              for (const part of content) {
                if (part.type === 'thought') {
                  // Gemini emits each thought as a complete summary (not a token delta),
                  // so each event must start a new block instead of concatenating.
                  yield { type: 'thinking', text: part.thought as string, isSubagent, replace: true, subagentTaskId };
                } else if (part.type === 'text') {
                  yield { type: 'text_delta', text: part.text as string, isSubagent, subagentTaskId };
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
            const subagentTaskId = event.threadId as string | undefined;
            yield {
              type: 'tool_use',
              toolName: event.name as string,
              toolUseId: event.requestId as string,
              input: event.args as unknown,
              isSubagent,
              subagentTaskId,
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
            const isSubagent = !!event.threadId;
            const subagentTaskId = event.threadId as string | undefined;
            yield {
              type: 'tool_result',
              toolUseId: event.requestId as string,
              summary,
              isSubagent,
              isError: event.isError as boolean | undefined,
              subagentTaskId,
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

            const reason = event.reason as string | undefined;
            if (reason === 'aborted') {
              yield {
                type: 'error',
                error: timedOut ? new AdapterTimeoutError('gemini', params.timeoutMs!) : new AdapterAbortError('gemini'),
              };
              return;
            }

            const output = rawMessages
              .filter((m) => m.role === 'assistant')
              .flatMap((m) => m.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text))
              .join('\n');

            // Fallback: Gemini 2.5 with implicit thinking sometimes omits candidatesTokenCount,
            // so outputTokens comes through as 0. Estimate from produced text length (~4 chars/token).
            if (totalUsage.outputTokens === 0) {
              const outputChars = rawMessages
                .filter((m) => m.role === 'assistant')
                .flatMap((m) => m.content.filter((c) => c.type === 'text' || c.type === 'thinking'))
                .reduce((sum, c) => sum + ((c as { text?: string }).text?.length ?? 0), 0);
              if (outputChars > 0) {
                totalUsage = { ...totalUsage, outputTokens: Math.max(1, Math.round(outputChars / 4)) };
              }
            }

            yield {
              type: 'result',
              output,
              rawMessages,
              usage: totalUsage,
              sessionId: effectiveSessionId,
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
