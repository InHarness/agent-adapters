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

    // --- Turn 1: fresh thread; cumulative 1000/200 input/output, 800 cached.
    nextThreadId = 'T-codex-usage-1';
    currentEvents = [
      { type: 'thread.started', thread_id: nextThreadId },
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm1', text: 'turn-1' },
      },
      {
        type: 'turn.completed',
        usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 200 },
      },
    ];
    const events1 = await collectEvents(
      adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })),
    );
    const result1 = events1.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result1).toBeDefined();
    expect(result1!.sessionId).toBe(nextThreadId);
    expect(result1!.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadInputTokens: 800,
    });
    // contextSize = post-subtract input + output (cache reads are inside input)
    expect(result1!.contextSize).toBe(1200);

    // --- Turn 2: resume; cumulative 1750/500 input/output, 1500 cached →
    //     delta 750/300, cache delta 700.
    currentEvents = [
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm2', text: 'turn-2' },
      },
      {
        type: 'turn.completed',
        usage: { input_tokens: 1750, cached_input_tokens: 1500, output_tokens: 500 },
      },
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
    expect(result2!.usage).toEqual({
      inputTokens: 750,
      outputTokens: 300,
      cacheReadInputTokens: 700,
    });
    expect(result2!.contextSize).toBe(1050);

    // --- Turn 3: resume; cumulative 2400/750 input/output, 2100 cached →
    //     delta 650/250, cache delta 600.
    currentEvents = [
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm3', text: 'turn-3' },
      },
      {
        type: 'turn.completed',
        usage: { input_tokens: 2400, cached_input_tokens: 2100, output_tokens: 750 },
      },
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
    expect(result3!.usage).toEqual({
      inputTokens: 650,
      outputTokens: 250,
      cacheReadInputTokens: 600,
    });
    expect(result3!.contextSize).toBe(900);
  });

  // Cross-process scenario: each turn runs in a fresh process, so the module
  // LRU starts empty every time. Without `params.priorUsage` the adapter
  // emits cumulative-as-delta (a known artifact, documented in
  // .claude/skills/codex-sdk/SKILL.md). With `priorUsage`, the caller
  // restores the prior cumulative and the adapter computes the correct
  // per-execute() delta.
  it('honors params.priorUsage when LRU is empty (cross-process scenario)', async () => {
    const { CodexAdapter, _clearCodexUsageLruForTest } = await import('./codex.js');

    // Turn 1: fresh thread, cumulative 12500/130 → delta 12500/130.
    nextThreadId = 'T-codex-cross-process';
    currentEvents = [
      { type: 'thread.started', thread_id: nextThreadId },
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm1', text: 'turn-1' },
      },
      { type: 'turn.completed', usage: { input_tokens: 12500, output_tokens: 130 } },
    ];
    const events1 = await collectEvents(
      new CodexAdapter().execute(createTestParams({ model: 'gpt-5.5-codex' })),
    );
    const result1 = events1.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result1).toBeDefined();
    expect(result1!.usage).toEqual({ inputTokens: 12500, outputTokens: 130 });

    // Simulate process restart — module LRU is wiped.
    _clearCodexUsageLruForTest();

    // Turn 2: resume same thread with cumulative 25200/340.
    // Without priorUsage: adapter would emit 25200/340 (cumulative-as-delta).
    // With priorUsage = result1's raw cumulative: adapter emits 12700/210 delta.
    currentEvents = [
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm2', text: 'turn-2' },
      },
      { type: 'turn.completed', usage: { input_tokens: 25200, output_tokens: 340 } },
    ];
    const events2 = await collectEvents(
      new CodexAdapter().execute(
        createTestParams({
          model: 'gpt-5.5-codex',
          resumeSessionId: nextThreadId,
          priorUsage: { inputTokens: 12500, outputTokens: 130 },
        }),
      ),
    );
    const result2 = events2.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result2).toBeDefined();
    expect(result2!.sessionId).toBe(nextThreadId);
    expect(result2!.usage).toEqual({ inputTokens: 12700, outputTokens: 210 });

    // Turn 3: another "restart". Caller passes priorUsage = result2's
    // cumulative (12500+12700, 130+210). Adapter emits the next delta.
    _clearCodexUsageLruForTest();
    currentEvents = [
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm3', text: 'turn-3' },
      },
      { type: 'turn.completed', usage: { input_tokens: 38000, output_tokens: 600 } },
    ];
    const events3 = await collectEvents(
      new CodexAdapter().execute(
        createTestParams({
          model: 'gpt-5.5-codex',
          resumeSessionId: nextThreadId,
          priorUsage: { inputTokens: 25200, outputTokens: 340 },
        }),
      ),
    );
    const result3 = events3.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result3).toBeDefined();
    expect(result3!.usage).toEqual({ inputTokens: 12800, outputTokens: 260 });
  });

  // Document the "no priorUsage in cross-process" path so the artifact stays
  // observable in the test suite — if someone changes the fallback semantics,
  // this test catches it.
  it('without params.priorUsage and empty LRU, emits cumulative as delta (documented artifact)', async () => {
    const { CodexAdapter, _clearCodexUsageLruForTest } = await import('./codex.js');

    nextThreadId = 'T-codex-no-prior';
    currentEvents = [
      { type: 'thread.started', thread_id: nextThreadId },
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'a1', text: 'first' },
      },
      { type: 'turn.completed', usage: { input_tokens: 10000, output_tokens: 100 } },
    ];
    await collectEvents(
      new CodexAdapter().execute(createTestParams({ model: 'gpt-5.5-codex' })),
    );

    _clearCodexUsageLruForTest();

    // Resume without priorUsage → SDK reports 22000 cumulative → adapter
    // emits the full cumulative as delta (artifact).
    currentEvents = [
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'a2', text: 'second' },
      },
      { type: 'turn.completed', usage: { input_tokens: 22000, output_tokens: 250 } },
    ];
    const events = await collectEvents(
      new CodexAdapter().execute(
        createTestParams({ model: 'gpt-5.5-codex', resumeSessionId: nextThreadId }),
      ),
    );
    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result!.usage).toEqual({ inputTokens: 22000, outputTokens: 250 });
  });
});
