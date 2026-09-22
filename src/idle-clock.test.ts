// M01 idle clock: advances only while nothing is outstanding, stops (without
// resetting) while work is in flight, and never re-arms on ordinary events.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleClock, createIdleHandle, observeIdle } from './idle-clock.js';
import type { UnifiedEvent } from './types.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

function clock(idleMs: number | undefined) {
  const onExpire = vi.fn();
  return { c: createIdleClock({ idleMs, onExpire }), onExpire };
}

const toolUse = (id: string): UnifiedEvent => ({ type: 'tool_use', toolName: 'Bash', toolUseId: id, input: {}, isSubagent: false });
const toolResult = (id: string): UnifiedEvent => ({ type: 'tool_result', toolUseId: id, summary: 'ok', isSubagent: false });
const text: UnifiedEvent = { type: 'text_delta', text: 'hi', isSubagent: false };

describe('createIdleClock', () => {
  it('expires after idleMs with nothing outstanding', () => {
    const { onExpire } = clock(100);
    vi.advanceTimersByTime(99);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('is not a last-activity timer: ordinary events do not re-arm it', () => {
    const { c, onExpire } = clock(100);
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(10);
      c.observe(text);
    }
    vi.advanceTimersByTime(10);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('does not advance while a tool call is open, however long it takes', () => {
    const { c, onExpire } = clock(100);
    c.observe(toolUse('t1'));
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
    c.observe(toolResult('t1'));
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('the budget is cumulative: a pause stops the clock without resetting it', () => {
    const { c, onExpire } = clock(100);
    vi.advanceTimersByTime(60);
    c.observe({ type: 'subagent_started', taskId: 's1', description: 'd', toolUseId: 'tu' });
    vi.advanceTimersByTime(5_000);
    c.observe({ type: 'subagent_completed', taskId: 's1', status: 'completed' });
    vi.advanceTimersByTime(39);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('tracks background tasks and explicit keys (pending user input, nested turns)', () => {
    const { c, onExpire } = clock(100);
    c.observe({ type: 'background_task_started', taskId: 'b1', taskType: 'shell', description: 'sleep' } as UnifiedEvent);
    c.begin('uin:r1');
    vi.advanceTimersByTime(1_000);
    c.observe({ type: 'background_task_completed', taskId: 'b1' } as UnifiedEvent);
    vi.advanceTimersByTime(1_000);
    expect(onExpire).not.toHaveBeenCalled();
    c.end('uin:r1');
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('a `result` drops tool calls left dangling, but keeps subagents open', () => {
    const { c, onExpire } = clock(100);
    c.observe(toolUse('never-answered'));
    c.observe({ type: 'subagent_started', taskId: 's1', description: 'd', toolUseId: 'tu' });
    c.observe({ type: 'result' } as UnifiedEvent);
    vi.advanceTimersByTime(1_000);
    expect(onExpire).not.toHaveBeenCalled();
    c.observe({ type: 'subagent_completed', taskId: 's1', status: 'completed' });
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('absent (or non-positive) idleMs creates no timer at all', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    for (const idleMs of [undefined, 0, -1]) {
      const { c, onExpire } = clock(idleMs);
      c.observe(toolUse('t'));
      c.observe(toolResult('t'));
      vi.advanceTimersByTime(1e9);
      expect(onExpire).not.toHaveBeenCalled();
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('dispose() stops it for good', () => {
    const { c, onExpire } = clock(100);
    c.dispose();
    c.begin('x');
    c.end('x');
    vi.advanceTimersByTime(1_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});

describe('observeIdle', () => {
  it('feeds each event to the clock before yielding it, and disposes on exit', async () => {
    const handle = createIdleHandle();
    const seen: string[] = [];
    handle.clock = {
      observe: (e) => seen.push(`observe:${e.type}`),
      begin() {},
      end() {},
      dispose: () => seen.push('dispose'),
    };
    async function* source(): AsyncGenerator<UnifiedEvent> {
      yield text;
      yield toolUse('t');
    }
    for await (const e of observeIdle(handle, source())) seen.push(`yield:${e.type}`);
    expect(seen).toEqual(['observe:text_delta', 'yield:text_delta', 'observe:tool_use', 'yield:tool_use', 'dispose']);
  });
});
