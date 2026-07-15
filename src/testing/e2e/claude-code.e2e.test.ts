// E2E tests for claude-code adapter — real queries against Claude API
// Requires: ANTHROPIC_API_KEY env var or Claude Code OAuth
// Run: npm run test:e2e:claude
// Run specific model: E2E_CLAUDE_MODEL=opus-4.7 npm run test:e2e:claude

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { resolveModel } from '../../models.js';
import { assertSimpleText, assertToolUse, assertThinking, assertAdapterReady } from '../contract.js';
import { AdapterAbortError, AdapterTimeoutError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import { architectureCapabilities } from '../../capabilities.js';
import { probePathScope, detectOsSandbox } from '../../path-scope.js';
import { PEER_SDK_RANGES, resolvePeerSdkVersion, evaluatePeerSdkVersion } from '../../sdk-version.js';
import { assertNormalization } from '../normalization.js';
import {
  requireEnv,
  assertSimpleTextStream,
  assertEventTypes,
  assertNormalizedMessage,
  createE2eMcpServer,
  createPlanModeTmpDir,
  assertNoFileCreated,
  assertFileCreated,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  TOOL_PROMPT,
  TOOL_SYSTEM_PROMPT,
  THINKING_PROMPT,
  THINKING_SYSTEM_PROMPT,
  SUBAGENT_PROMPT,
  SUBAGENT_SYSTEM_PROMPT,
  assertSubagentTaskIdConsistency,
  assertAtLeastOneSubagentTaskIdPopulated,
  PLAN_WRITE_PROMPT,
  PLAN_WRITE_SYSTEM_PROMPT,
  PLAN_READ_PROMPT,
  PLAN_READ_SYSTEM_PROMPT,
  USER_QUESTION_PROMPT,
  USER_QUESTION_SYSTEM_PROMPT,
  runUserQuestionScenario,
  assertUserInputRequest,
  TODO_PROMPT,
  TODO_SYSTEM_PROMPT,
  assertTodoListUpdated,
  runResumeScenario,
  RESUME_EXPECTED_NUMBER,
  assertResumeUsageIndependence,
  makeSolidColorPng,
  IMAGE_RGB,
  IMAGE_EXPECTED_COLOR,
  IMAGE_PROMPT,
  IMAGE_SYSTEM_PROMPT,
  assertImageDescribed,
  assertUsageLegible,
  createPathScopeDirs,
  createElicitingMcpServer,
  ELICIT_PROMPT,
  ELICIT_SYSTEM_PROMPT,
  ELICIT_ANSWER_TIME,
  TIMEOUT_PROMPT,
  TIMEOUT_SYSTEM_PROMPT,
} from './shared.js';

/** Narrow a collected stream to its `result` event (undefined if none). */
function findResult(events: UnifiedEvent[]): Extract<UnifiedEvent, { type: 'result' }> | undefined {
  return events.find((e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result');
}

// Claude Code SDK manages auth internally (OAuth, cached credentials, or ANTHROPIC_API_KEY).
// We skip only if SKIP_CLAUDE_E2E is explicitly set — otherwise we let the SDK try its auth flow.
const SKIP = !!process.env.SKIP_CLAUDE_E2E;

// Model to test — override with E2E_CLAUDE_MODEL env var (alias or full ID)
const MODEL = process.env.E2E_CLAUDE_MODEL || 'sonnet-4.6';
const FULL_MODEL_ID = resolveModel('claude-code', MODEL);

describe.skipIf(SKIP)(`claude-code e2e [${MODEL}]`, () => {
  it('emits adapter_ready with SDK-native options before first message', async () => {
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 1,
      }),
    );

    const contractResult = assertAdapterReady(events, 'claude-code');
    expect(contractResult.passed, contractResult.assertions.filter((a) => !a.passed).map((a) => a.message).join('; ')).toBe(true);

    const ready = events.find((e) => e.type === 'adapter_ready') as Extract<UnifiedEvent, { type: 'adapter_ready' }>;
    const sdk = ready.sdkConfig as { options: { model: string; systemPrompt?: unknown; cwd?: string } };
    expect(sdk.options).toBeDefined();
    expect(sdk.options.model).toBe(FULL_MODEL_ID);
  });

  it('simple text response (model alias)', async () => {
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);

    // Also validate with contract assertion
    // Re-run with fresh adapter since stream is consumed
    const adapter2 = createAdapter('claude-code');
    const contractResult = await assertSimpleText(
      adapter2.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 1,
      }),
    );
    expect(contractResult.passed).toBe(true);
  });

  it('simple text response (full model ID)', async () => {
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: FULL_MODEL_ID,
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);
  });

  it('thinking events', async () => {
    const adapter = createAdapter('claude-code');
    // Use 'enabled' for all models — adapter auto-converts to 'adaptive' for models that need it
    const events = await collectEvents(
      adapter.execute({
        prompt: THINKING_PROMPT,
        systemPrompt: THINKING_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 1,
        architectureConfig: {
          claude_thinking: 'enabled',
          claude_thinking_budget: 5000,
        },
      }),
    );

    assertEventTypes(events, ['text_delta', 'assistant_message', 'result']);

    // Thinking events may or may not appear (adaptive models decide autonomously)
    const thinkingEvents = events.filter((e) => e.type === 'thinking') as Extract<
      UnifiedEvent,
      { type: 'thinking' }
    >[];
    if (thinkingEvents.length > 0) {
      const firstThinking = events.findIndex((e) => e.type === 'thinking');
      const firstTextDelta = events.findIndex((e) => e.type === 'text_delta');
      expect(firstThinking).toBeLessThan(firstTextDelta);

      for (const te of thinkingEvents) {
        expect(typeof te.text).toBe('string');
        expect(te.isSubagent).toBe(false);
      }

      // assistant_message should contain thinking content block
      const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Extract<
        UnifiedEvent,
        { type: 'assistant_message' }
      >[];
      const hasThinkingBlock = assistantMsgs.some((am) => am.message.content.some((b) => b.type === 'thinking'));
      expect(hasThinkingBlock, 'No assistant_message with thinking content block').toBe(true);
    }
  });

  it('tool use (in-process MCP)', async () => {
    const { config } = createE2eMcpServer();
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: TOOL_PROMPT,
        systemPrompt: TOOL_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 3,
        mcpServers: { 'e2e-test': config },
      }),
    );

    assertEventTypes(events, ['tool_use', 'tool_result', 'text_delta', 'result']);

    // tool_use should have echo tool
    const toolUses = events.filter((e) => e.type === 'tool_use') as Extract<UnifiedEvent, { type: 'tool_use' }>[];
    expect(toolUses.length).toBeGreaterThanOrEqual(1);
    const echoUse = toolUses.find((tu) => tu.toolName.includes('echo'));
    expect(echoUse, 'No tool_use for echo tool found').toBeDefined();
    expect(echoUse!.toolUseId.length).toBeGreaterThan(0);

    // tool_result should contain echo response
    const toolResults = events.filter((e) => e.type === 'tool_result') as Extract<
      UnifiedEvent,
      { type: 'tool_result' }
    >[];
    expect(toolResults.length).toBeGreaterThanOrEqual(1);

    // tool_result should come after tool_use
    const tuIdx = events.indexOf(toolUses[0]);
    const trIdx = events.indexOf(toolResults[0]);
    expect(trIdx).toBeGreaterThan(tuIdx);

    // assistant_message should contain toolUse content block
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Extract<
      UnifiedEvent,
      { type: 'assistant_message' }
    >[];
    const assistantBlocks = assistantMsgs.flatMap((am) => am.message.content);
    expect(assistantBlocks.some((b) => b.type === 'toolUse'), 'No toolUse content block in assistant message').toBe(true);

    // toolResult appears in rawMessages (as user role — tool responses come from "user")
    const resultEvent = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
    const allRawBlocks = resultEvent.rawMessages.flatMap((m) => m.content);
    expect(allRawBlocks.some((b) => b.type === 'toolResult'), 'No toolResult content block in rawMessages').toBe(true);

    // Cross-check the same contract via the shared normalization helper.
    // claude-code splits tool-use (assistant role) and tool-result (user role) across rawMessages.
    assertNormalization(events, {
      blocks: [{ type: 'toolUse' }, { type: 'toolResult' }],
    });
  });

  it('subagent events', async () => {
    const { config } = createE2eMcpServer();
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: SUBAGENT_PROMPT,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 5,
        mcpServers: { 'e2e-test': config },
      }),
    );

    assertEventTypes(events, ['text_delta', 'assistant_message', 'result']);

    // Check for subagent lifecycle events
    const started = events.filter((e) => e.type === 'subagent_started') as Extract<
      UnifiedEvent,
      { type: 'subagent_started' }
    >[];
    const completed = events.filter((e) => e.type === 'subagent_completed') as Extract<
      UnifiedEvent,
      { type: 'subagent_completed' }
    >[];

    // Subagent spawning is non-deterministic — model decides whether to delegate.
    // We validate structure if subagents were spawned, but don't fail if they weren't.
    if (started.length > 0) {
      for (const s of started) {
        expect(s.taskId).toBeTruthy();
        expect(typeof s.description).toBe('string');
      }

      expect(completed.length).toBeGreaterThanOrEqual(1);
      for (const c of completed) {
        expect(c.taskId).toBeTruthy();
        expect(typeof c.status).toBe('string');
      }

      // At least some events should be marked as coming from subagent
      const hasSubagentEvents = events.some(
        (e) => ('isSubagent' in e && e.isSubagent) || e.type.startsWith('subagent_'),
      );
      expect(hasSubagentEvents).toBe(true);

      // subagentTaskId on deltas must match the surrounding subagent_started.taskId
      assertSubagentTaskIdConsistency(events);
      assertAtLeastOneSubagentTaskIdPopulated(events);
    }
  });

  it('defines a custom subagent the model can invoke', async () => {
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt:
          'Use the joke-teller subagent to come up with one short, clean programming joke, then relay it.',
        systemPrompt:
          'When a specialized subagent fits the task, delegate to it via the Agent tool.',
        model: MODEL,
        maxTurns: 6,
        subagents: [
          {
            name: 'joke-teller',
            description: 'Use this agent whenever a short, clean joke is requested.',
            prompt: 'You are a comedian. Reply with exactly one short, clean joke and nothing else.',
            tools: [],
            effort: 'low',
          },
        ],
      }),
    );

    assertEventTypes(events, ['text_delta', 'assistant_message', 'result']);

    // Delegation is non-deterministic, but when the model DOES spawn a subagent
    // it must be the one we defined — assert structure only if it delegated.
    const started = events.filter((e) => e.type === 'subagent_started') as Extract<
      UnifiedEvent,
      { type: 'subagent_started' }
    >[];
    if (started.length > 0) {
      for (const s of started) {
        expect(s.taskId).toBeTruthy();
      }
      assertSubagentTaskIdConsistency(events);
    }
  });

  it('abort mid-stream', async () => {
    const adapter = createAdapter('claude-code');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: 'Write a long essay about the history of computing. Make it very detailed.',
      systemPrompt: 'Write at least 2000 words.',
      model: MODEL,
      maxTurns: 1,
    })) {
      events.push(event);
      if (event.type === 'text_delta' && !aborted) {
        aborted = true;
        adapter.abort();
      }
    }

    // Should have received at least one text_delta before abort
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);

    // Should end with an error event (AdapterAbortError)
    const errorEvents = events.filter((e) => e.type === 'error') as Extract<UnifiedEvent, { type: 'error' }>[];
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].error).toBeInstanceOf(AdapterAbortError);
  });

  it('reports midTurnPush capability', () => {
    expect(architectureCapabilities('claude-code').midTurnPush).toBe(true);
  });

  // Resolves risk R1: does streaming-input deliver a pushed message BETWEEN
  // tool calls (true mid-turn) or only at the turn boundary (next-turn-in-
  // session)? This logs the post-push event sequence so the README wording can
  // be pinned to observed behavior; assertions stay loose to avoid flakiness.
  it(
    'streaming-input: pushMessage is accepted and delivered to the live session',
    async () => {
      const adapter = createAdapter('claude-code');
      const events: UnifiedEvent[] = [];
      let pushed = false;
      let pushAccepted: boolean | null = null;
      let pushEventIndex = -1;

      for await (const event of adapter.execute({
        prompt:
          'Use the Bash tool to run `echo first`, then briefly summarize what you did.',
        systemPrompt:
          'You are a helpful assistant. Use the Bash tool when asked. Keep responses short.',
        model: MODEL,
        streamingInput: true,
      })) {
        events.push(event);
        // Inject a follow-up the moment the model makes its first tool call,
        // while the turn is still live.
        if (event.type === 'tool_use' && !pushed) {
          pushed = true;
          pushAccepted = adapter.pushMessage?.('Now also run `echo second`.') ?? false;
          pushEventIndex = events.length - 1;
        }
      }

      // The push landed while the turn was live.
      expect(pushAccepted).toBe(true);

      // The accepted push surfaced as a user_message event with our text.
      const userMessages = events.filter(
        (e): e is Extract<UnifiedEvent, { type: 'user_message' }> => e.type === 'user_message',
      );
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      expect(userMessages.some((m) => m.text.includes('echo second'))).toBe(true);

      // The session produced at least one result and ran to completion.
      const results = events.filter((e) => e.type === 'result');
      expect(results.length).toBeGreaterThanOrEqual(1);

      // R1 diagnostic: dump the event-type sequence after the push so we can
      // see whether delivery interleaved with the live turn or started a new one.
      const afterPush = events.slice(pushEventIndex + 1).map((e) => e.type);
      // eslint-disable-next-line no-console
      console.log('[R1] post-push event sequence:', afterPush.join(' → '));
      // eslint-disable-next-line no-console
      console.log('[R1] total results:', results.length, '| user_messages:', userMessages.length);
    },
    180_000,
  );

  it('unknown model alias warns and passes through (SDK rejects)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const adapter = createAdapter('claude-code');
      const events: UnifiedEvent[] = [];
      let threwError = false;

      try {
        for await (const event of adapter.execute({
          prompt: SIMPLE_PROMPT,
          systemPrompt: SIMPLE_SYSTEM_PROMPT,
          model: 'glm-5.1',
          maxTurns: 1,
        })) {
          events.push(event);
        }
      } catch {
        threwError = true;
      }

      expect(threwError).toBe(false);
      const passthroughWarns = warnSpy.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('Unknown model "glm-5.1"') &&
          c[0].includes('passing through'),
      );
      expect(passthroughWarns.length).toBeGreaterThanOrEqual(1);
      const errorEvents = events.filter((e) => e.type === 'error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  describe('plan mode', () => {
    it('planMode=true blocks file creation', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('claude-code');
        const events = await collectEvents(
          adapter.execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: MODEL,
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        assertNoFileCreated(dir, 'notes.txt');
        // In plan mode SDK should still finish the stream (with a plan or ExitPlanMode).
        expect(events.some((e) => e.type === 'result' || e.type === 'assistant_message')).toBe(true);
      } finally {
        cleanup();
      }
    });

    it('planMode=true allows reads', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('claude-code');
        const events = await collectEvents(
          adapter.execute({
            prompt: PLAN_READ_PROMPT,
            systemPrompt: PLAN_READ_SYSTEM_PROMPT,
            model: MODEL,
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        const readUses = (events.filter((e) => e.type === 'tool_use') as Extract<UnifiedEvent, { type: 'tool_use' }>[])
          .filter((tu) => /^Read$/i.test(tu.toolName));
        expect(readUses.length, 'Read tool should have been used in plan mode').toBeGreaterThanOrEqual(1);
        const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
        expect(result.output.toLowerCase()).toContain('test seed');
      } finally {
        cleanup();
      }
    });

    it('planMode=undefined allows writes (baseline sanity)', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('claude-code');
        await collectEvents(
          adapter.execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: MODEL,
            maxTurns: 3,
            cwd: dir,
            // planMode omitted = default bypassPermissions
          }),
        );
        assertFileCreated(dir, 'notes.txt');
      } finally {
        cleanup();
      }
    });

    it('planMode=true keeps MCP tools executable (consumer-curated read-only servers)', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const { config } = createE2eMcpServer();
        const adapter = createAdapter('claude-code');
        const events = await collectEvents(
          adapter.execute({
            prompt:
              'First call the echo tool with the message "hello plan". Then create a file notes.txt with the echo result. If you cannot create the file, just report the echo result.',
            systemPrompt:
              'You have an echo MCP tool and filesystem tools. Use echo first, then try Write.',
            model: MODEL,
            maxTurns: 4,
            cwd: dir,
            planMode: true,
            mcpServers: { 'e2e-test': config },
          }),
        );

        // MCP tool executes freely under planMode (server is consumer-curated).
        const toolUses = events.filter((e) => e.type === 'tool_use') as Extract<UnifiedEvent, { type: 'tool_use' }>[];
        const echoUse = toolUses.find((tu) => tu.toolName.includes('echo'));
        expect(echoUse, 'MCP echo tool should execute in planMode').toBeDefined();

        // Mutating built-ins must not be in the catalog, so no Write tool_use.
        expect(
          toolUses.find((tu) => /^(Write|Edit|NotebookEdit)$/i.test(tu.toolName)),
          'Write-family built-ins should be hidden in planMode',
        ).toBeUndefined();

        // Filesystem must remain untouched.
        assertNoFileCreated(dir, 'notes.txt');
      } finally {
        cleanup();
      }
    });
  });

  describe('onUserInput — AskUserQuestion tool bridge', () => {
    it('model invokes AskUserQuestion → handler runs → answer reaches the model', async () => {
      const adapter = createAdapter('claude-code');
      const { events, handlerCalls } = await runUserQuestionScenario(adapter, {
        prompt: USER_QUESTION_PROMPT,
        systemPrompt: USER_QUESTION_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 4,
        mockAnswer: 'banana',
      });

      expect(handlerCalls, 'onUserInput should fire at least once').toBeGreaterThanOrEqual(1);
      const req = assertUserInputRequest(events, 'model-tool');
      expect(req.request.origin).toBe('claude-code');

      // The model should continue and reference "banana" in its final text.
      const finalText = (events.filter((e) => e.type === 'assistant_message') as Extract<
        UnifiedEvent,
        { type: 'assistant_message' }
      >[])
        .flatMap((m) => m.message.content.filter((c) => c.type === 'text'))
        .map((c) => (c as { text: string }).text)
        .join(' ')
        .toLowerCase();
      expect(finalText, `expected "banana" in final output, got: ${finalText}`).toContain('banana');
    });

    it('decline path — model sees the cancellation and keeps going', async () => {
      const adapter = createAdapter('claude-code');
      const { events, handlerCalls } = await runUserQuestionScenario(adapter, {
        prompt: USER_QUESTION_PROMPT,
        systemPrompt: USER_QUESTION_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 3,
        mockAnswer: 'cancel',
      });
      expect(handlerCalls).toBeGreaterThanOrEqual(1);
      assertUserInputRequest(events, 'model-tool');
      // No crash — completion event must still be present.
      expect(events.some((e) => e.type === 'result' || e.type === 'error')).toBe(true);
    });
  });

  describe('todo list (TodoWrite → todoList projection)', () => {
    it('emits todo_list_updated, drops tool_use TodoWrite, and snapshots on result', async () => {
      const adapter = createAdapter('claude-code');
      const events = await collectEvents(
        adapter.execute({
          prompt: TODO_PROMPT,
          systemPrompt: TODO_SYSTEM_PROMPT,
          model: MODEL,
          // 3 turns: deferred-tool discovery (ToolSearch) → TodoWrite → final response.
          // Recent SDK versions register ToolSearch as a built-in for newer Claude
          // models, so the model burns one turn discovering tools before TodoWrite.
          maxTurns: 3,
        }),
      );

      // 1. At least one todo_list_updated with source 'model-tool'.
      const todoEvent = assertTodoListUpdated(events, { expectedSource: 'model-tool' });
      expect(todoEvent.items.length).toBeGreaterThanOrEqual(1);

      // 2. No raw tool_use event leaked for TodoWrite.
      const todoWriteToolUse = events.filter(
        (e): e is Extract<UnifiedEvent, { type: 'tool_use' }> =>
          e.type === 'tool_use' && e.toolName === 'TodoWrite',
      );
      expect(
        todoWriteToolUse.length,
        'TodoWrite tool_use should be replaced by todo_list_updated',
      ).toBe(0);

      // 3. result.rawMessages contains a todoList content block, and no
      //    leftover toolUse for TodoWrite.
      const result = events.find(
        (e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result',
      );
      expect(result, 'result event expected').toBeDefined();
      const allBlocks = result!.rawMessages.flatMap((m) => m.content);
      expect(allBlocks.some((b) => b.type === 'todoList')).toBe(true);
      expect(
        allBlocks.some((b) => b.type === 'toolUse' && b.toolName === 'TodoWrite'),
        'TodoWrite toolUse should be replaced by todoList in rawMessages',
      ).toBe(false);

      // 4. result.todoListSnapshot matches the last todo_list_updated items.
      expect(result!.todoListSnapshot).toBeDefined();
      expect(result!.todoListSnapshot).toEqual(todoEvent.items);
    });
  });

  describe('resume_session (resumeSessionId round-trip)', () => {
    it('turn 2 recalls a number set in turn 1 and reports per-call usage', async () => {
      const { sessionId, result1, result2 } = await runResumeScenario(
        () => createAdapter('claude-code'),
        { model: MODEL, maxTurns: 1 },
      );

      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
      expect(result2.output).toContain(RESUME_EXPECTED_NUMBER);

      assertResumeUsageIndependence(result1, result2);
    });
  });

  // --- M12 scenario: image (base64 / file → described) ---
  // `url` delivery is intentionally not exercised here: it would depend on a
  // stable public image host, coupling a live-model assertion to third-party
  // network availability. base64 + file cover both materialization paths
  // (native content block / read-and-inline).
  describe('image input (base64 / file → described)', () => {
    it('describes a base64 image', async () => {
      const png = makeSolidColorPng(IMAGE_RGB);
      const adapter = createAdapter('claude-code');
      const events = await collectEvents(
        adapter.execute({
          prompt: IMAGE_PROMPT,
          systemPrompt: IMAGE_SYSTEM_PROMPT,
          model: MODEL,
          maxTurns: 1,
          images: [{ type: 'base64', mediaType: 'image/png', data: png.toString('base64') }],
        }),
      );
      const result = findResult(events);
      expect(result, 'expected a result event').toBeDefined();
      assertImageDescribed(result!, IMAGE_EXPECTED_COLOR);
    }, 120_000);

    it('describes a file image', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-adapters-img-'));
      const path = join(dir, 'solid.png');
      writeFileSync(path, makeSolidColorPng(IMAGE_RGB));
      try {
        const adapter = createAdapter('claude-code');
        const events = await collectEvents(
          adapter.execute({
            prompt: IMAGE_PROMPT,
            systemPrompt: IMAGE_SYSTEM_PROMPT,
            model: MODEL,
            maxTurns: 1,
            images: [{ type: 'file', path }],
          }),
        );
        const result = findResult(events);
        expect(result, 'expected a result event').toBeDefined();
        assertImageDescribed(result!, IMAGE_EXPECTED_COLOR);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);
  });

  // --- M12 scenario: path-scope (allowedPaths / disallowedPaths) ---
  describe('path scope (allowedPaths / disallowedPaths)', () => {
    it('resolves scope on adapter_ready with disallowedPaths precedence (soft gate)', async () => {
      const { cwd, extraDir, secretDir, cleanup } = createPathScopeDirs();
      try {
        const adapter = createAdapter('claude-code');
        // secretDir is in BOTH allow and deny → disallowedPaths must win.
        const events = await collectEvents(
          adapter.execute({
            prompt: 'Reply with the single word: ready.',
            systemPrompt: 'Answer in one word.',
            model: MODEL,
            maxTurns: 1,
            cwd,
            allowedPaths: [extraDir, secretDir],
            disallowedPaths: [secretDir],
          }),
        );
        const ready = events.find(
          (e): e is Extract<UnifiedEvent, { type: 'adapter_ready' }> => e.type === 'adapter_ready',
        );
        expect(ready?.pathScope, 'adapter_ready should carry pathScope when requested').toBeDefined();
        const ps = ready!.pathScope!;
        expect(ps.requested).toBe(true);
        // No claude_sandbox opt-in → soft (model-visible permission rules only).
        expect(ps.strength).toBe('soft');
        expect(ps.allowed).toContain(extraDir);
        expect(ps.disallowed).toContain(secretDir);

        // The pure resolver agrees (deterministic cross-check of precedence).
        const probed = probePathScope('claude-code', {
          cwd,
          allowedPaths: [extraDir, secretDir],
          disallowedPaths: [secretDir],
        });
        expect(probed.strength).toBe('soft');
        expect(probed.disallowed).toContain(secretDir);
      } finally {
        cleanup();
      }
    }, 120_000);

    it('a file under a disallowedPath cannot be read (soft deny blocks Read)', async () => {
      const { cwd, secretDir, secretFile, cleanup } = createPathScopeDirs();
      try {
        const adapter = createAdapter('claude-code');
        const events = await collectEvents(
          adapter.execute({
            prompt: `Use the Read tool to open ${secretFile} and tell me its exact contents verbatim. If the read is denied, reply with exactly the word BLOCKED.`,
            systemPrompt: 'You have a Read tool. If a read is denied by permissions, reply with exactly: BLOCKED.',
            model: MODEL,
            maxTurns: 3,
            cwd,
            disallowedPaths: [secretDir],
          }),
        );
        const result = findResult(events);
        expect(result, 'expected a result event').toBeDefined();
        // The soft gate denies Read(secret/**) — the marker must never surface.
        expect(
          result!.output.includes('TOP-SECRET-1729'),
          `disallowedPath leaked: secret content appeared in output: ${result!.output}`,
        ).toBe(false);
      } finally {
        cleanup();
      }
    }, 120_000);
  });

  // --- M12 scenario: usage (billing tokens vs contextSize + cache buckets) ---
  describe('usage (billing tokens vs contextSize + cache buckets)', () => {
    it('reports legible per-call billing usage and context-window size on result', async () => {
      const adapter = createAdapter('claude-code');
      const events = await collectEvents(
        adapter.execute({
          prompt: SIMPLE_PROMPT,
          systemPrompt: SIMPLE_SYSTEM_PROMPT,
          model: MODEL,
          maxTurns: 1,
        }),
      );
      const result = findResult(events);
      expect(result, 'expected a result event').toBeDefined();
      assertUsageLegible(result!);
    }, 120_000);
  });

  // --- M12 scenario: mcp elicitation (elicitation_request / onElicitation bridge) ---
  // NOTE: exercises the server-side elicitation side-channel end-to-end. Whether
  // an in-process SDK-MCP server's `elicitation/create` is forwarded to the
  // adapter's `options.onElicitation` is a claude-agent-sdk behavior; if the SDK
  // stops forwarding it, this scenario is the canary. timeoutMs bounds the run so
  // a non-bridged elicitation fails fast instead of hanging.
  describe('mcp elicitation (elicitation_request / onElicitation bridge)', () => {
    it('bridges an MCP elicitation to user_input_request and the answer reaches the model', async () => {
      const { config } = createElicitingMcpServer();
      const adapter = createAdapter('claude-code');
      let handlerCalls = 0;
      const events: UnifiedEvent[] = [];
      for await (const e of adapter.execute({
        prompt: ELICIT_PROMPT,
        systemPrompt: ELICIT_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 5,
        mcpServers: { 'e2e-elicit': config },
        timeoutMs: 90_000,
        onElicitation: async () => {
          handlerCalls += 1;
          return { action: 'accept', content: { time: ELICIT_ANSWER_TIME } };
        },
      })) {
        events.push(e);
      }

      // The elicitation surfaced through the unified bridge (source mcp-elicitation).
      const req = assertUserInputRequest(events, 'mcp-elicitation');
      expect(req.request.source).toBe('mcp-elicitation');
      expect(handlerCalls, 'onElicitation should fire at least once').toBeGreaterThanOrEqual(1);

      // The deprecated legacy event is still emitted for back-compat.
      expect(events.some((e) => e.type === 'elicitation_request')).toBe(true);

      // The elicited answer reached the model and shows up in its final output.
      const result = findResult(events);
      expect(result?.output.toLowerCase()).toContain(ELICIT_ANSWER_TIME);
    }, 120_000);
  });

  // --- M12 scenario: timeout edge (timeoutMs → AdapterTimeoutError) ---
  describe('timeout (timeoutMs → AdapterTimeoutError)', () => {
    it('exceeding timeoutMs ends with a runtime AdapterTimeoutError and closes the input channel', async () => {
      const adapter = createAdapter('claude-code');
      const events: UnifiedEvent[] = [];
      for await (const e of adapter.execute({
        prompt: TIMEOUT_PROMPT,
        systemPrompt: TIMEOUT_SYSTEM_PROMPT,
        model: MODEL,
        streamingInput: true,
        timeoutMs: 8000,
      })) {
        events.push(e);
      }

      const errorEvents = events.filter(
        (e): e is Extract<UnifiedEvent, { type: 'error' }> => e.type === 'error',
      );
      const timeoutErr = errorEvents.find((e) => e.error instanceof AdapterTimeoutError);
      expect(timeoutErr, `expected an AdapterTimeoutError, got: ${errorEvents.map((e) => e.error?.name).join(', ')}`).toBeDefined();
      expect(timeoutErr!.phase).toBe('runtime');

      // After a timed-out run the input channel is closed — a late push is rejected.
      expect(adapter.pushMessage?.('late message') ?? false).toBe(false);
    }, 60_000);
  });

  // --- M12 scenario: os-sandbox-degrade edge (hard→soft where the host lacks a sandbox) ---
  describe('os sandbox degrade (claude_sandbox on a host with/without bubblewrap/seatbelt)', () => {
    it('path-scope strength tracks host capability; degrades hard→soft with a warning when no OS sandbox', async () => {
      const { cwd, extraDir, cleanup } = createPathScopeDirs();
      try {
        const adapter = createAdapter('claude-code');
        const events = await collectEvents(
          adapter.execute({
            prompt: 'Reply with the single word: ready.',
            systemPrompt: 'Answer in one word.',
            model: MODEL,
            maxTurns: 1,
            cwd,
            allowedPaths: [extraDir],
            architectureConfig: { claude_sandbox: { enabled: true } },
          }),
        );
        const ready = events.find(
          (e): e is Extract<UnifiedEvent, { type: 'adapter_ready' }> => e.type === 'adapter_ready',
        );
        const hasOsSandbox = detectOsSandbox();
        expect(ready?.pathScope?.strength).toBe(hasOsSandbox ? 'hard' : 'soft');

        const degradeWarning = events.some(
          (e) => e.type === 'warning' && /degraded hard→soft/.test(e.message),
        );
        if (hasOsSandbox) {
          expect(degradeWarning, 'no degrade warning expected when an OS sandbox is available').toBe(false);
        } else {
          expect(degradeWarning, 'expected a hard→soft degrade warning on a host without an OS sandbox').toBe(true);
        }
      } finally {
        cleanup();
      }
    }, 120_000);
  });
});

// --- M12 scenario: sdk-version-gate (verified-range evidence) ---
// Deterministic and creds-free, so it runs even when SKIP_CLAUDE_E2E is set: the
// e2e suite runs against a dev-pinned SDK, and THAT installed version is the
// evidence for the declared peerDependencies range. If they ever diverge, the
// declared range is no longer "verified" and this fails. The reject-message shape
// ("installed X … requires Y") backs the non-suppressible init AdapterInitError
// asserted at unit level in `src/adapters/claude-code.sdk-version.test.ts`.
describe('sdk-version-gate — verified-range evidence [@anthropic-ai/claude-agent-sdk]', () => {
  const PKG = '@anthropic-ai/claude-agent-sdk';

  it('the dev-pinned SDK the e2e suite runs against satisfies the declared peer range', () => {
    const range = PEER_SDK_RANGES[PKG];
    const installed = resolvePeerSdkVersion(PKG);
    expect(installed, 'could not resolve the installed claude-agent-sdk version').toBeTruthy();
    const check = evaluatePeerSdkVersion(PKG, range, installed);
    expect(check.status, `installed ${installed} must satisfy declared range ${range}`).toBe('ok');
  });

  it('an out-of-range install is a mismatch with an "installed X … requires Y" message', () => {
    const range = PEER_SDK_RANGES[PKG];
    const check = evaluatePeerSdkVersion(PKG, range, '0.2.0');
    expect(check.status).toBe('mismatch');
    expect(check.message).toMatch(/installed .* requires/);
  });
});
