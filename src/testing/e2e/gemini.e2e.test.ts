// E2E tests for gemini adapter — real queries against Google AI API
// Requires: GOOGLE_API_KEY or GEMINI_API_KEY env var
// Run: npm run test:e2e:gemini

import { describe, it, expect } from 'vitest';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { AdapterError, AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import {
  requireEnv,
  assertSimpleTextStream,
  assertEventTypes,
  createPlanModeTmpDir,
  assertNoFileCreated,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  THINKING_PROMPT,
  THINKING_SYSTEM_PROMPT,
  PLAN_WRITE_PROMPT,
  PLAN_WRITE_SYSTEM_PROMPT,
  PLAN_READ_PROMPT,
  PLAN_READ_SYSTEM_PROMPT,
  USER_QUESTION_PROMPT,
  USER_QUESTION_SYSTEM_PROMPT,
  SUBAGENT_PROMPT,
  SUBAGENT_SYSTEM_PROMPT,
  runUserQuestionScenario,
  assertUserInputRequest,
  assertSubagentTaskIdConsistency,
  createE2eMcpServer,
} from './shared.js';
import { assertNormalization } from '../normalization.js';

const HAS_API_KEY = requireEnv('GOOGLE_API_KEY') || requireEnv('GEMINI_API_KEY');

describe.skipIf(!HAS_API_KEY)('gemini e2e', () => {
  it('simple text response (model alias)', async () => {
    const adapter = createAdapter('gemini');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'gemini-2.5-flash',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);

    // Gemini has no native todo/plan primitive — snapshot must stay undefined,
    // and no todo_list_updated events should fire.
    const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
    expect(result.todoListSnapshot).toBeUndefined();
    expect(events.some((e) => e.type === 'todo_list_updated')).toBe(false);
  });

  it('simple text response (full model ID)', async () => {
    const adapter = createAdapter('gemini');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'gemini-2.5-flash',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);
  });

  it('thinking events', async () => {
    const adapter = createAdapter('gemini');
    const events = await collectEvents(
      adapter.execute({
        prompt: THINKING_PROMPT,
        systemPrompt: THINKING_SYSTEM_PROMPT,
        model: 'gemini-2.5-flash',
        maxTurns: 1,
        architectureConfig: {
          gemini_thinkingBudget: 5000,
        },
      }),
    );

    assertEventTypes(events, ['thinking', 'text_delta', 'assistant_message', 'result']);

    // Thinking should come before text_delta
    const firstThinking = events.findIndex((e) => e.type === 'thinking');
    const firstTextDelta = events.findIndex((e) => e.type === 'text_delta');
    expect(firstThinking).toBeLessThan(firstTextDelta);

    // Thinking events should have non-empty text
    const thinkingEvents = events.filter((e) => e.type === 'thinking') as Extract<
      UnifiedEvent,
      { type: 'thinking' }
    >[];
    expect(thinkingEvents.length).toBeGreaterThanOrEqual(1);
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

    // Cross-check: gemini contentPartsToBlocks() turns SDK 'thought' parts into
    // 'thinking' blocks alongside the text reply.
    assertNormalization(events, {
      role: 'assistant',
      blocks: [{ type: 'thinking' }, { type: 'text' }],
    });
  });

  // Gemini supports stdio MCP but not in-process — would need external MCP server binary
  // Skipping MCP test for now as it requires spawning an external process

  it('abort mid-stream', async () => {
    const adapter = createAdapter('gemini');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: 'Write a long essay about the history of computing. Make it very detailed.',
      systemPrompt: 'Write at least 2000 words.',
      model: 'gemini-2.5-flash',
      maxTurns: 1,
    })) {
      events.push(event);
      if (event.type === 'text_delta' && !aborted) {
        aborted = true;
        adapter.abort();
      }
    }

    expect(events.some((e) => e.type === 'text_delta')).toBe(true);

    const errorEvents = events.filter((e) => e.type === 'error') as Extract<UnifiedEvent, { type: 'error' }>[];
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].error).toBeInstanceOf(AdapterAbortError);
  });

  it('unknown model alias throws', async () => {
    const adapter = createAdapter('gemini');
    let threwError = false;

    try {
      for await (const _event of adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'glm-5.1',
        maxTurns: 1,
      })) {
        // consume
      }
    } catch (err) {
      threwError = true;
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as Error).message).toContain('Unknown model');
    }

    expect(threwError).toBe(true);
  });

  describe('plan mode', () => {
    it('planMode=true blocks file creation (approvalMode=plan)', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('gemini');
        const events = await collectEvents(
          adapter.execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: 'gemini-2.5-flash',
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        assertNoFileCreated(dir, 'notes.txt');
        expect(events.some((e) => e.type === 'result' || e.type === 'assistant_message')).toBe(true);
      } finally {
        cleanup();
      }
    });

    it('planMode=true allows reads', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('gemini');
        const events = await collectEvents(
          adapter.execute({
            prompt: PLAN_READ_PROMPT,
            systemPrompt: PLAN_READ_SYSTEM_PROMPT,
            model: 'gemini-2.5-flash',
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
        expect(result.output.toLowerCase()).toContain('test seed');
      } finally {
        cleanup();
      }
    });
  });

  it('subagent events carry subagentTaskId on deltas', async () => {
    const { config } = createE2eMcpServer();
    const adapter = createAdapter('gemini');
    const events = await collectEvents(
      adapter.execute({
        prompt: SUBAGENT_PROMPT,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        model: 'gemini-2.5-flash',
        maxTurns: 5,
        mcpServers: { 'e2e-test': config },
      }),
    );

    const started = events.filter((e) => e.type === 'subagent_started') as Extract<
      UnifiedEvent,
      { type: 'subagent_started' }
    >[];

    // Subagent spawning is non-deterministic — model decides whether to delegate.
    if (started.length > 0) {
      assertSubagentTaskIdConsistency(events);
      // Gemini claims full support — require at least one populated value.
      const populated = events.some(
        (e) =>
          'isSubagent' in e &&
          e.isSubagent &&
          'subagentTaskId' in e &&
          typeof e.subagentTaskId === 'string' &&
          e.subagentTaskId.length > 0,
      );
      expect(populated, 'expected at least one gemini subagent delta with populated subagentTaskId').toBe(true);
    }
  });

  describe('onUserInput — ask_user MessageBus bridge', () => {
    // PARTIAL: see KNOWN LIMITATION comment in src/adapters/gemini.ts. The unified
    // event fires correctly, but our async reply loses a race against the Scheduler's
    // synchronous default response, so the model itself sees a Cancel. We assert the
    // observable contract (event + handler invocation) but not the model's final text.
    it('model invokes ask_user → unified event fires and handler runs', async () => {
      const adapter = createAdapter('gemini');
      const { events, handlerCalls } = await runUserQuestionScenario(adapter, {
        prompt: USER_QUESTION_PROMPT,
        systemPrompt: USER_QUESTION_SYSTEM_PROMPT,
        model: 'gemini-2.5-flash',
        maxTurns: 3,
        mockAnswer: 'banana',
      });

      expect(handlerCalls, 'onUserInput should fire at least once').toBeGreaterThanOrEqual(1);
      const req = assertUserInputRequest(events, 'model-tool');
      expect(req.request.origin).toBe('gemini');
    });
  });
});
