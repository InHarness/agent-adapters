// E2E tests for claude-code adapter — real queries against Claude API
// Requires: ANTHROPIC_API_KEY env var or Claude Code OAuth
// Run: npm run test:e2e:claude
// Run specific model: E2E_CLAUDE_MODEL=opus-4.7 npm run test:e2e:claude

import { describe, it, expect } from 'vitest';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { resolveModel } from '../../models.js';
import { assertSimpleText, assertToolUse, assertThinking, assertAdapterReady } from '../contract.js';
import { AdapterError, AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
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
} from './shared.js';

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

  it('unknown model alias throws', async () => {
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
    } catch (err) {
      threwError = true;
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as Error).message).toContain('Unknown model');
      expect((err as Error).message).toContain('glm-5.1');
    }

    expect(threwError, 'Expected AdapterError to be thrown for unknown model alias').toBe(true);
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
          maxTurns: 2,
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
});
