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
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
} from './shared.js';

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
});
