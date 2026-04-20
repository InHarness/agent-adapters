// E2E tests for codex adapter — real queries against OpenAI API
// Requires: OPENAI_API_KEY env var
// Run: npm run test:e2e:codex

import { describe, it, expect } from 'vitest';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { AdapterError, AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import {
  requireEnv,
  assertSimpleTextStream,
  createPlanModeTmpDir,
  assertNoFileCreated,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  PLAN_WRITE_PROMPT,
  PLAN_WRITE_SYSTEM_PROMPT,
} from './shared.js';
import { assertNormalization } from '../normalization.js';
import type { UserInputHandler } from '../../types.js';

const HAS_API_KEY = requireEnv('OPENAI_API_KEY');

describe.skipIf(!HAS_API_KEY)('codex e2e', () => {
  it('simple text response (model alias)', async () => {
    const adapter = createAdapter('codex');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'o4-mini',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);

    // Codex only persists assistant text in NormalizedMessage.content;
    // shell/file/mcp tool flows surface as events but stay out of rawMessages.
    assertNormalization(events, {
      role: 'assistant',
      hasNative: true,
      blocks: [{ type: 'text' }],
    });
  });

  it('simple text response (full model ID)', async () => {
    const adapter = createAdapter('codex');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'o4-mini',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);
  });

  // Codex does not support dynamic MCP configuration — skipped
  // Codex does not have native thinking events — skipped

  it('abort mid-stream', async () => {
    const adapter = createAdapter('codex');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: 'Write a long essay about the history of computing. Make it very detailed.',
      systemPrompt: 'Write at least 2000 words.',
      model: 'o4-mini',
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
    const adapter = createAdapter('codex');
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
    it('planMode=true blocks file creation (read-only sandbox)', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('codex');
        const events = await collectEvents(
          adapter.execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: 'o4-mini',
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

    it('planMode=true allows listing files via read-only shell', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('codex');
        const events = await collectEvents(
          adapter.execute({
            prompt: 'List the files in the current directory using ls. Then report what you see.',
            systemPrompt: 'Use the shell tool with `ls` to list files.',
            model: 'o4-mini',
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
        expect(result.output.toLowerCase()).toContain('readme');
      } finally {
        cleanup();
      }
    });
  });

  describe('onUserInput — not supported by SDK', () => {
    it('emits warning and never invokes the handler', async () => {
      const adapter = createAdapter('codex');
      let handlerCalls = 0;
      const handler: UserInputHandler = async () => {
        handlerCalls += 1;
        return { action: 'cancel' };
      };
      const events = await collectEvents(
        adapter.execute({
          prompt: SIMPLE_PROMPT,
          systemPrompt: SIMPLE_SYSTEM_PROMPT,
          model: 'o4-mini',
          maxTurns: 1,
          onUserInput: handler,
        }),
      );

      expect(handlerCalls, 'codex must never invoke onUserInput').toBe(0);
      const warnings = events.filter((e) => e.type === 'warning') as Extract<UnifiedEvent, { type: 'warning' }>[];
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].message).toMatch(/codex.*not supported/i);
      expect(events.some((e) => e.type === 'result')).toBe(true);
    });
  });
});
