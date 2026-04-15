import { describe, it, expect, vi } from 'vitest';
import { dispatchEvent, observeStream } from './observer.js';
import type { StreamObserver } from './observer.js';
import type { UnifiedEvent, NormalizedMessage } from './types.js';

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
