// M01 `idleTimeoutMs` on codex. Codex emits `tool_use` and `tool_result` together at
// `item.completed`, so a long command would look like silence to a clock fed only the
// unified stream — the adapter tracks it from `item.started` instead.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnifiedEvent } from '../types.js';
import { AdapterIdleTimeoutError } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

/** `{ sleep: ms }` pauses the scripted stream; the sleep ends early on abort. */
let currentEvents: ReadonlyArray<unknown> = [];

vi.mock('@openai/codex-sdk', () => {
  class FakeThread {
    get id() {
      return 'T-idle';
    }
    async runStreamed(_prompt: unknown, opts: { signal?: AbortSignal }) {
      const events = currentEvents;
      async function* gen() {
        for (const e of events) {
          const ms = (e as { sleep?: number }).sleep;
          if (ms !== undefined) {
            await new Promise<void>((resolve, reject) => {
              const t = setTimeout(resolve, ms);
              opts.signal?.addEventListener('abort', () => {
                clearTimeout(t);
                reject(new Error('aborted'));
              });
            });
            continue;
          }
          yield e;
        }
      }
      return { events: gen() };
    }
  }
  class Codex {
    constructor(_opts: unknown) {}
    startThread() {
      return new FakeThread();
    }
    resumeThread() {
      return new FakeThread();
    }
  }
  return { Codex };
});

beforeEach(() => {
  process.env.OPENAI_API_KEY ??= 'test-key';
});

const IDLE_MS = 150;
const command = { type: 'command_execution', id: 'cmd-1', command: 'sleep 1', aggregated_output: '', status: 'in_progress' };
const turnCompleted = { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } };

async function run(): Promise<UnifiedEvent[]> {
  const { CodexAdapter } = await import('./codex.js');
  return collectEvents(new CodexAdapter().execute(createTestParams({ idleTimeoutMs: IDLE_MS })), 10_000);
}

describe('codex — idleTimeoutMs', () => {
  it('a long command between item.started and item.completed does not expire on the idle clock', async () => {
    currentEvents = [
      { type: 'thread.started', thread_id: 'T-idle' },
      { type: 'item.started', item: command },
      { sleep: 5 * IDLE_MS },
      { type: 'item.completed', item: { ...command, status: 'completed', exit_code: 0 } },
      turnCompleted,
    ];
    const events = await run();

    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('a silent engine with nothing in flight ends with AdapterIdleTimeoutError', async () => {
    currentEvents = [{ type: 'thread.started', thread_id: 'T-idle' }, { sleep: 60_000 }, turnCompleted];
    const events = await run();

    const errs = events.filter((e) => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ phase: 'runtime' });
    expect((errs[0] as { error: Error }).error).toBeInstanceOf(AdapterIdleTimeoutError);
  });

  it('a slow consumer is not an idle engine — before or after the result', async () => {
    currentEvents = [
      { type: 'thread.started', thread_id: 'T-idle' },
      { type: 'item.completed', item: { type: 'agent_message', id: 'm-1', text: 'hi' } },
      turnCompleted,
    ];
    const { CodexAdapter } = await import('./codex.js');
    const events: UnifiedEvent[] = [];
    for await (const e of new CodexAdapter().execute(createTestParams({ idleTimeoutMs: IDLE_MS }))) {
      events.push(e);
      await new Promise((r) => setTimeout(r, 3 * IDLE_MS));
    }

    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });
});
