// M01 `toolCallTimeoutMs` / M06 `subagentTimeoutMs`: per-unit caps moved only by a
// closed vocabulary attached to their unit.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRunCaps } from './run-caps.js';
import type { UnifiedEvent } from './types.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

function caps(toolCallMs: number | undefined, subagentMs: number | undefined) {
  const onExpire = vi.fn();
  return { c: createRunCaps({ toolCallMs, subagentMs, onExpire }), onExpire };
}

const toolUse = (id: string, toolName = 'Bash'): UnifiedEvent => ({ type: 'tool_use', toolName, toolUseId: id, input: {}, isSubagent: false });
const toolResult = (id: string): UnifiedEvent => ({ type: 'tool_result', toolUseId: id, summary: 'ok', isSubagent: false });
const text: UnifiedEvent = { type: 'text_delta', text: 'hi', isSubagent: false };
const started = (taskId: string, toolUseId: string, resumed?: true): UnifiedEvent => ({
  type: 'subagent_started',
  taskId,
  toolUseId,
  description: 'd',
  ...(resumed ? { resumed } : {}),
});
const progress = (taskId: string): UnifiedEvent => ({ type: 'subagent_progress', taskId, description: 'p' });
const completed = (taskId: string): UnifiedEvent => ({ type: 'subagent_completed', taskId, status: 'completed' });
const inputRequest = (requestId: string): UnifiedEvent => ({
  type: 'user_input_request',
  request: { requestId, source: 'mcp-elicitation', origin: 'srv', questions: [] },
});

describe('createRunCaps — absent fields', () => {
  it('creates no timer at all when both caps are absent', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { c, onExpire } = caps(undefined, undefined);
    c.observe(toolUse('t1'));
    c.observe(started('s1', 'a1'));
    vi.advanceTimersByTime(10 * 60_000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('createRunCaps — toolCallTimeoutMs', () => {
  it('ends the run naming the call that stood still', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('t1', 'mcp__srv__slow'));
    vi.advanceTimersByTime(99);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledWith({ kind: 'tool', toolName: 'mcp__srv__slow', toolUseId: 't1' });
  });

  it('is armed per call: sequential calls each get the full value', () => {
    const { c, onExpire } = caps(100, undefined);
    for (const id of ['t1', 't2', 't3']) {
      c.observe(toolUse(id));
      vi.advanceTimersByTime(90);
      c.observe(toolResult(id));
    }
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('is not moved by other traffic', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('t1'));
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(10);
      c.observe(text);
    }
    vi.advanceTimersByTime(10);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('never arms for a tool_use that opens a subagent', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('a1', 'Agent'));
    c.observe(toolUse('a2', 'Task'));
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('disarms a call once a subagent_started names it', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('m1', 'SendMessage'));
    vi.advanceTimersByTime(50);
    c.observe(started('s1', 'm1', true));
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('is suspended under an unanswered user_input_request and re-armed once answered', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('t1', 'mcp__srv__ask'));
    vi.advanceTimersByTime(50);
    c.observe(inputRequest('r1'));
    vi.advanceTimersByTime(60 * 60_000); // a slow human
    expect(onExpire).not.toHaveBeenCalled();
    c.inputAnswered('r1');
    vi.advanceTimersByTime(99);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledWith({ kind: 'tool', toolName: 'mcp__srv__ask', toolUseId: 't1' });
  });

  it('stays suspended while any request is still unanswered', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('t1'));
    c.observe(inputRequest('r1'));
    c.observe(inputRequest('r2'));
    c.inputAnswered('r1');
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
    c.inputAnswered('r2');
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('drops calls still open at a result', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('t1'));
    c.observe({ type: 'result', output: '', rawMessages: [], usage: { inputTokens: 0, outputTokens: 0 }, contextSize: 0 });
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('beginToolCall arms a call the stream does not show in flight (codex)', () => {
    const { c, onExpire } = caps(100, undefined);
    c.beginToolCall('item_1', 'shell');
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledWith({ kind: 'tool', toolName: 'shell', toolUseId: 'item_1' });
  });

  it('fires once and goes quiet after dispose', () => {
    const { c, onExpire } = caps(100, undefined);
    c.observe(toolUse('t1'));
    c.observe(toolUse('t2'));
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledOnce();
    const d = caps(100, undefined);
    d.c.observe(toolUse('t1'));
    d.c.dispose();
    vi.advanceTimersByTime(1000);
    expect(d.onExpire).not.toHaveBeenCalled();
  });
});

describe('createRunCaps — subagentTimeoutMs', () => {
  it('ends the run for an open subagent that reports nothing', () => {
    const { c, onExpire } = caps(undefined, 100);
    c.observe(started('s1', 'a1'));
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledWith({ kind: 'subagent', taskId: 's1' });
  });

  it('is re-armed to its full value by its own subagent_progress', () => {
    const { c, onExpire } = caps(undefined, 100);
    c.observe(started('s1', 'a1'));
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(90);
      c.observe(progress('s1'));
    }
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledWith({ kind: 'subagent', taskId: 's1' });
  });

  it('is re-armed by a resumed start, and by nothing else', () => {
    const { c, onExpire } = caps(undefined, 100);
    c.observe(started('s1', 'a1'));
    vi.advanceTimersByTime(90);
    c.observe(started('s1', 'm1', true));
    vi.advanceTimersByTime(90);
    expect(onExpire).not.toHaveBeenCalled();
    // Another subagent's progress, tool traffic and text do not count.
    c.observe(started('s2', 'a2'));
    c.observe(progress('s2'));
    c.observe(toolUse('t1'));
    c.observe(text);
    vi.advanceTimersByTime(10);
    expect(onExpire).toHaveBeenCalledWith({ kind: 'subagent', taskId: 's1' });
  });

  it('is disarmed by subagent_completed', () => {
    const { c, onExpire } = caps(undefined, 100);
    c.observe(started('s1', 'a1'));
    vi.advanceTimersByTime(50);
    c.observe(completed('s1'));
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('progress for a subagent that is not open does not arm a cap', () => {
    const { c, onExpire } = caps(undefined, 100);
    c.observe(progress('ghost'));
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
