// E2E tests for opencode-openrouter adapter — real queries via OpenRouter
// Requires: OPENROUTER_API_KEY env var + opencode CLI in PATH
// Run: npm run test:e2e:opencode

import { describe, it, expect } from 'vitest';
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
} from './shared.js';

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
});
