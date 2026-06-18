// Unit test: codex emits a one-shot `warning` event (and ignores the field)
// when `RuntimeExecuteParams.subagents` is provided — the Codex SDK has no
// subagent definition mechanism.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import type { SubagentDefinition } from '../types.js';

vi.mock('@openai/codex-sdk', () => {
  class FakeThread {
    async runStreamed(_prompt: string, _opts: unknown) {
      return {
        events: (async function* () {
          // minimal: no events, the stream just ends.
        })(),
      };
    }
  }
  class Codex {
    constructor(_opts: unknown) {}
    startThread(_opts: unknown) {
      return new FakeThread();
    }
    resumeThread(_id: string, _opts: unknown) {
      return new FakeThread();
    }
  }
  return { Codex };
});

beforeEach(() => {
  process.env.OPENAI_API_KEY ??= 'test-key';
});

describe('codex subagents warning', () => {
  it('emits a warning and does not throw when subagents are provided', async () => {
    const subagents: SubagentDefinition[] = [{ name: 'a', description: 'd', prompt: 'p' }];
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ subagents })));
    const warning = events.find((e) => e.type === 'warning');
    expect(warning).toBeDefined();
    expect((warning as { message: string }).message).toMatch(/subagents are not supported/);
  });
});
