// E2E tests for opencode-openrouter adapter — real queries via OpenRouter
// Requires: OPENROUTER_API_KEY env var + opencode CLI in PATH
// Run: npm run test:e2e:opencode

import { describe, it, expect, vi } from 'vitest';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { isOpencodeAvailable } from '../../adapters/opencode.js';
import { AdapterError, AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import {
  requireEnv,
  assertSimpleTextStream,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  SUBAGENT_PROMPT,
  SUBAGENT_SYSTEM_PROMPT,
  USER_QUESTION_PROMPT,
  USER_QUESTION_SYSTEM_PROMPT,
  runUserQuestionScenario,
  assertUserInputRequest,
  assertSubagentTaskIdConsistency,
} from './shared.js';
import { assertNormalization } from '../normalization.js';

const HAS_API_KEY = requireEnv('OPENROUTER_API_KEY');
const HAS_CLI = isOpencodeAvailable();

describe.skipIf(!HAS_API_KEY || !HAS_CLI)('opencode-openrouter e2e', () => {
  it('simple text response (model alias)', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'claude-sonnet-4',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);

    // OpenCode bundles all blocks (text, thinking, toolUse, toolResult) into
    // a single accumulating NormalizedMessage that flushes on message-id change.
    assertNormalization(events, {
      role: 'assistant',
      blocks: [{ type: 'text' }],
    });
  });

  it('simple text response (full model ID)', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'anthropic/claude-sonnet-4',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);
  });

  // OpenCode: thinking is model-dependent, not architecture-configured — skipped
  // OpenCode: only supports stdio MCP, no in-process MCP — skipped

  it('abort mid-stream', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: 'Write a long essay about the history of computing. Make it very detailed.',
      systemPrompt: 'Write at least 2000 words.',
      model: 'claude-sonnet-4',
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
    const adapter = createAdapter('opencode-openrouter');
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
    it('planMode=true emits warning and runs normally', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const adapter = createAdapter('opencode-openrouter');
        const events = await collectEvents(
          adapter.execute({
            prompt: SIMPLE_PROMPT,
            systemPrompt: SIMPLE_SYSTEM_PROMPT,
            model: 'claude-sonnet-4',
            maxTurns: 1,
            planMode: true,
          }),
        );
        expect(events.some((e) => e.type === 'result')).toBe(true);
        const planWarns = warnSpy.mock.calls.filter(
          (c) => typeof c[0] === 'string' && c[0].includes('planMode not natively supported'),
        );
        expect(planWarns.length).toBeGreaterThanOrEqual(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('planMode=undefined does not emit warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const adapter = createAdapter('opencode-openrouter');
        await collectEvents(
          adapter.execute({
            prompt: SIMPLE_PROMPT,
            systemPrompt: SIMPLE_SYSTEM_PROMPT,
            model: 'claude-sonnet-4',
            maxTurns: 1,
          }),
        );
        const planWarns = warnSpy.mock.calls.filter(
          (c) => typeof c[0] === 'string' && c[0].includes('planMode not natively supported'),
        );
        expect(planWarns.length).toBe(0);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  it('subagent events carry subagentTaskId on deltas (ordering-based)', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events = await collectEvents(
      adapter.execute({
        prompt: SUBAGENT_PROMPT,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        model: 'claude-sonnet-4',
        maxTurns: 5,
      }),
    );

    const started = events.filter((e) => e.type === 'subagent_started') as Extract<
      UnifiedEvent,
      { type: 'subagent_started' }
    >[];

    // Subagent spawning is non-deterministic. Only assert if the model delegated.
    if (started.length > 0) {
      // The ordering heuristic is allowed to miss deltas (undefined is tolerated),
      // but wrong IDs must never appear.
      assertSubagentTaskIdConsistency(events);
    }
  });

  describe('onUserInput — question events bridge', () => {
    it('model fires ask-user question tool → handler runs → answer reaches the model', async () => {
      const adapter = createAdapter('opencode-openrouter');
      const { events, handlerCalls } = await runUserQuestionScenario(adapter, {
        prompt: USER_QUESTION_PROMPT,
        systemPrompt: USER_QUESTION_SYSTEM_PROMPT,
        model: 'claude-sonnet-4',
        maxTurns: 4,
        mockAnswer: 'banana',
      });

      expect(handlerCalls, 'onUserInput should fire at least once').toBeGreaterThanOrEqual(1);
      const req = assertUserInputRequest(events, 'model-tool');
      expect(req.request.origin).toBe('opencode');

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
  });
});
