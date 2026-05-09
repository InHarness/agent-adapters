// Cumulative-vs-delta usage regression for codex.
//
// `codex exec --experimental-json` (wrapped by @openai/codex-sdk) emits
// turn.completed.usage as cumulative session totals, NOT per-turn delta — see
// openai/codex#17539 (`event_processor_with_jsonl_output.rs::usage_from_last_total`
// drops the rust core's per-request `ThreadTokenUsage.last`). The unified
// contract requires per-execute() delta in `result.usage`. This test mocks the
// SDK to feed scripted cumulative totals across three sequential turns and
// asserts the adapter yields delta = current_cumulative − prior_cumulative.
//
// Mirrors the vi.mock pattern in codex.normalize.test.ts; the per-test thunk
// `currentEvents` lets us script different cumulative totals per turn.
//
// Usage of internal LRU map: each test creates a fresh threadId, so cap-eviction
// is not exercised here (covered conceptually by the inline LRU code in codex.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnifiedEvent } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

// Per-test scripted event stream + thread id. The fake `Codex` reads these on
// each runStreamed call, so we can sequence turns 1/2/3 with different totals.
let currentEvents: ReadonlyArray<unknown> = [];
let nextThreadId: string = 'T-codex-usage-1';

vi.mock('@openai/codex-sdk', () => {
  // Mirrors @openai/codex-sdk Thread surface used by the adapter:
  //   - `thread.id` getter (populated after `thread.started` is yielded)
  //   - `thread.runStreamed(prompt, opts) → { events: AsyncGenerator<ThreadEvent> }`
  // Real SDK assigns `_id` from the `thread.started` event during streaming
  // (see node_modules/@openai/codex-sdk/dist/index.js:85-87) — we replicate that.
  class FakeThread {
    _id: string | null;
    constructor(id: string | null) {
      this._id = id;
    }
    get id() {
      return this._id;
    }
    async runStreamed(_prompt: string, _opts: unknown) {
      const self = this;
      const events = currentEvents;
      async function* gen() {
        for (const e of events) {
          if ((e as { type: string }).type === 'thread.started') {
            self._id = (e as { thread_id: string }).thread_id;
          }
          yield e;
        }
      }
      return { events: gen() };
    }
  }
  class Codex {
    constructor(_opts: unknown) {}
    startThread(_opts: unknown) {
      // Fresh thread — id is null until `thread.started` lands.
      return new FakeThread(null);
    }
    resumeThread(id: string, _opts: unknown) {
      // Resumed thread — id is already known to the SDK before any events.
      return new FakeThread(id);
    }
  }
  return { Codex };
});

beforeEach(() => {
  process.env.OPENAI_API_KEY ??= 'test-key';
});

describe('codex usage delta (cumulative → per-execute() delta)', () => {
  it('subtracts prior cumulative across three sequential turns on the same thread', async () => {
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();

    // --- Turn 1: fresh thread; SDK announces thread_id then cumulative 1000/200.
    nextThreadId = 'T-codex-usage-1';
    currentEvents = [
      { type: 'thread.started', thread_id: nextThreadId },
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm1', text: 'turn-1' },
      },
      { type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 200 } },
    ];
    const events1 = await collectEvents(
      adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })),
    );
    const result1 = events1.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result1).toBeDefined();
    expect(result1!.sessionId).toBe(nextThreadId);
    expect(result1!.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });

    // --- Turn 2: resume same thread; cumulative jumped to 1750/500 → delta 750/300.
    currentEvents = [
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm2', text: 'turn-2' },
      },
      { type: 'turn.completed', usage: { input_tokens: 1750, output_tokens: 500 } },
    ];
    const events2 = await collectEvents(
      adapter.execute(
        createTestParams({ model: 'gpt-5.5-codex', resumeSessionId: nextThreadId }),
      ),
    );
    const result2 = events2.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result2).toBeDefined();
    expect(result2!.sessionId).toBe(nextThreadId);
    expect(result2!.usage).toEqual({ inputTokens: 750, outputTokens: 300 });

    // --- Turn 3: resume again; cumulative 2400/750 → delta 650/250.
    currentEvents = [
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm3', text: 'turn-3' },
      },
      { type: 'turn.completed', usage: { input_tokens: 2400, output_tokens: 750 } },
    ];
    const events3 = await collectEvents(
      adapter.execute(
        createTestParams({ model: 'gpt-5.5-codex', resumeSessionId: nextThreadId }),
      ),
    );
    const result3 = events3.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result3).toBeDefined();
    expect(result3!.sessionId).toBe(nextThreadId);
    expect(result3!.usage).toEqual({ inputTokens: 650, outputTokens: 250 });
  });
});
