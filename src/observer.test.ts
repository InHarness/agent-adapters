import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import { dispatchEvent, observeStream, createConsoleObserver } from './observer.js';
import type { StreamObserver } from './observer.js';
import type { UnifiedEvent, NormalizedMessage } from './types.js';

function captureStream(): { stream: Writable; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, output: () => chunks.join('') };
}

const msg: NormalizedMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello' }],
  timestamp: new Date().toISOString(),
};

describe('dispatchEvent', () => {
  it('dispatches text_delta to onTextDelta', () => {
    const onTextDelta = vi.fn();
    const observer: StreamObserver = { onTextDelta };

    dispatchEvent({ type: 'text_delta', text: 'hello', isSubagent: false }, [observer]);
    expect(onTextDelta).toHaveBeenCalledWith('hello', false);
  });

  it('dispatches to multiple observers', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const observers: StreamObserver[] = [{ onTextDelta: fn1 }, { onTextDelta: fn2 }];

    dispatchEvent({ type: 'text_delta', text: 'hi', isSubagent: false }, observers);
    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  it('handles missing methods gracefully', () => {
    const observer: StreamObserver = {};
    expect(() => {
      dispatchEvent({ type: 'text_delta', text: 'hi', isSubagent: false }, [observer]);
    }).not.toThrow();
  });

  it('dispatches all event types', () => {
    const observer: StreamObserver = {
      onTextDelta: vi.fn(),
      onToolUse: vi.fn(),
      onToolResult: vi.fn(),
      onThinking: vi.fn(),
      onAssistantMessage: vi.fn(),
      onSubagentStarted: vi.fn(),
      onSubagentProgress: vi.fn(),
      onSubagentCompleted: vi.fn(),
      onFlush: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
    };

    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'a', isSubagent: false },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'tu1', input: {}, isSubagent: false },
      { type: 'tool_result', toolUseId: 'tu1', summary: 'ok' },
      { type: 'thinking', text: 'hmm', isSubagent: false },
      { type: 'assistant_message', message: msg },
      { type: 'subagent_started', taskId: 't1', description: 'sub', toolUseId: 'tu2' },
      { type: 'subagent_progress', taskId: 't1', description: 'working' },
      { type: 'subagent_completed', taskId: 't1', status: 'completed' },
      { type: 'flush' },
      { type: 'result', output: 'done', rawMessages: [msg], usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'error', error: new Error('test') },
    ];

    for (const event of events) {
      dispatchEvent(event, [observer]);
    }

    expect(observer.onTextDelta).toHaveBeenCalled();
    expect(observer.onToolUse).toHaveBeenCalled();
    expect(observer.onToolResult).toHaveBeenCalled();
    expect(observer.onThinking).toHaveBeenCalled();
    expect(observer.onAssistantMessage).toHaveBeenCalled();
    expect(observer.onSubagentStarted).toHaveBeenCalled();
    expect(observer.onSubagentProgress).toHaveBeenCalled();
    expect(observer.onSubagentCompleted).toHaveBeenCalled();
    expect(observer.onFlush).toHaveBeenCalled();
    expect(observer.onResult).toHaveBeenCalled();
    expect(observer.onError).toHaveBeenCalled();
  });
});

describe('observeStream', () => {
  it('dispatches events and yields them', async () => {
    const onTextDelta = vi.fn();
    const observer: StreamObserver = { onTextDelta };

    async function* source(): AsyncIterable<UnifiedEvent> {
      yield { type: 'text_delta', text: 'a', isSubagent: false };
      yield { type: 'text_delta', text: 'b', isSubagent: false };
    }

    const collected: UnifiedEvent[] = [];
    for await (const event of observeStream(source(), [observer])) {
      collected.push(event);
    }

    expect(collected).toHaveLength(2);
    expect(onTextDelta).toHaveBeenCalledTimes(2);
  });
});

describe('createConsoleObserver', () => {
  it('writes text_delta verbatim without prefix', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false });

    dispatchEvent({ type: 'text_delta', text: 'hello ', isSubagent: false }, [obs]);
    dispatchEvent({ type: 'text_delta', text: 'world', isSubagent: false }, [obs]);

    expect(output()).toBe('hello world');
  });

  it('formats tool_use and tool_result', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false });

    dispatchEvent({ type: 'tool_use', toolName: 'Read', toolUseId: 'tu1', input: {}, isSubagent: false }, [obs]);
    dispatchEvent({ type: 'tool_result', toolUseId: 'tu1', summary: 'file contents' }, [obs]);

    expect(output()).toContain('[tool] Read (tu1)');
    expect(output()).toContain('[result] file contents');
  });

  it('truncates tool_result summary at toolResultMaxLen', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false, toolResultMaxLen: 10 });

    dispatchEvent({ type: 'tool_result', toolUseId: 'tu1', summary: 'abcdefghijklmnop' }, [obs]);

    expect(output()).toContain('abcdefghij…');
    expect(output()).not.toContain('klmnop');
  });

  it('hides thinking by default and shows it when enabled', () => {
    const c1 = captureStream();
    const obsOff = createConsoleObserver({ stream: c1.stream, color: false });
    dispatchEvent({ type: 'thinking', text: 'pondering', isSubagent: false }, [obsOff]);
    expect(c1.output()).toBe('');

    const c2 = captureStream();
    const obsOn = createConsoleObserver({ stream: c2.stream, color: false, thinking: true });
    dispatchEvent({ type: 'thinking', text: 'pondering', isSubagent: false }, [obsOn]);
    expect(c2.output()).toContain('[think] pondering');
  });

  it('shows subagent events with taskId prefix and can be disabled', () => {
    const c1 = captureStream();
    const obsOn = createConsoleObserver({ stream: c1.stream, color: false });
    dispatchEvent({ type: 'subagent_started', taskId: 't1', description: 'sub', toolUseId: 'tu2' }, [obsOn]);
    dispatchEvent({ type: 'subagent_progress', taskId: 't1', description: 'working', lastToolName: 'Read' }, [obsOn]);
    dispatchEvent({ type: 'subagent_completed', taskId: 't1', status: 'completed' }, [obsOn]);
    const out = c1.output();
    expect(out).toContain('[sub t1] → sub');
    expect(out).toContain('[sub t1] working (Read)');
    expect(out).toContain('[sub t1] ✓ completed');

    const c2 = captureStream();
    const obsOff = createConsoleObserver({ stream: c2.stream, color: false, subagents: false });
    dispatchEvent({ type: 'subagent_started', taskId: 't1', description: 'sub', toolUseId: 'tu2' }, [obsOff]);
    expect(c2.output()).toBe('');
  });

  it('prints usage on result by default and skips when usage=false', () => {
    const msg: NormalizedMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
      timestamp: new Date().toISOString(),
    };
    const c1 = captureStream();
    const obsOn = createConsoleObserver({ stream: c1.stream, color: false });
    dispatchEvent({ type: 'result', output: 'done', rawMessages: [msg], usage: { inputTokens: 10, outputTokens: 5 } }, [obsOn]);
    expect(c1.output()).toContain('[done] 10in / 5out');

    const c2 = captureStream();
    const obsOff = createConsoleObserver({ stream: c2.stream, color: false, usage: false });
    dispatchEvent({ type: 'result', output: 'done', rawMessages: [msg], usage: { inputTokens: 10, outputTokens: 5 } }, [obsOff]);
    expect(c2.output()).toBe('');
  });

  it('formats errors', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false });
    dispatchEvent({ type: 'error', error: new Error('boom') }, [obs]);
    expect(output()).toContain('[error] boom');
  });

  it('emits ANSI codes when color=true', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: true });
    dispatchEvent({ type: 'tool_use', toolName: 'Read', toolUseId: 'tu1', input: {}, isSubagent: false }, [obs]);
    expect(output()).toMatch(/\x1b\[/);
  });

  it('omits ANSI codes when color=false', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false });
    dispatchEvent({ type: 'tool_use', toolName: 'Read', toolUseId: 'tu1', input: {}, isSubagent: false }, [obs]);
    expect(output()).not.toMatch(/\x1b\[/);
  });
});
