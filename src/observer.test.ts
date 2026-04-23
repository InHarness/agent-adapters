import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import {
  dispatchEvent,
  observeStream,
  createConsoleObserver,
  applySdkConfigFilter,
} from './observer.js';
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
      onAdapterReady: vi.fn(),
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
      { type: 'adapter_ready', adapter: 'claude-code', sdkConfig: { model: 'x' } },
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
    expect(observer.onAdapterReady).toHaveBeenCalledWith('claude-code', { model: 'x' });
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

  it('prints adapter_ready header + pretty-printed sdkConfig by default', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false });
    dispatchEvent(
      {
        type: 'adapter_ready',
        adapter: 'claude-code',
        sdkConfig: { options: { model: 'claude-opus-4-7' } },
      },
      [obs],
    );
    const out = output();
    expect(out).toContain('[claude-code] ready');
    expect(out).toContain('"model": "claude-opus-4-7"');
    expect(out.split('\n').length).toBeGreaterThan(2);
  });

  it('prints adapter_ready as a single line when compactAdapterReady=true', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false, compactAdapterReady: true });
    dispatchEvent(
      { type: 'adapter_ready', adapter: 'codex', sdkConfig: { model: 'gpt-5' } },
      [obs],
    );
    const out = output();
    expect(out).toContain('[codex] ready {"model":"gpt-5"}');
    expect(out.match(/\n/g)?.length).toBe(1);
  });

  it('suppresses adapter_ready when showAdapterReady=false', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false, showAdapterReady: false });
    dispatchEvent(
      { type: 'adapter_ready', adapter: 'gemini', sdkConfig: { model: 'gemini-pro' } },
      [obs],
    );
    expect(output()).toBe('');
  });
});

describe('applySdkConfigFilter', () => {
  const sample = {
    model: 'claude-opus-4-7',
    systemPrompt: 'you are...',
    mcpServers: {
      echo: { command: 'node', args: ['echo.js'], instance: { deep: 'secret' } },
      fs: { command: 'fs-bin', instance: { deep: 'secret' } },
    },
  };

  it('returns value unchanged when neither include nor exclude is provided', () => {
    const out = applySdkConfigFilter(sample, {});
    expect(out).toEqual(sample);
  });

  it('exclude replaces matched top-level key with [Excluded], keeps siblings', () => {
    const out = applySdkConfigFilter(sample, { exclude: ['systemPrompt'] }) as Record<
      string,
      unknown
    >;
    expect(out.systemPrompt).toBe('[Excluded]');
    expect(out.model).toBe('claude-opus-4-7');
    expect((out.mcpServers as Record<string, unknown>).echo).toBeDefined();
  });

  it('exclude with wildcard hides nested leaf under every parent', () => {
    const out = applySdkConfigFilter(sample, { exclude: ['mcpServers.*.instance'] }) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(out.mcpServers.echo.instance).toBe('[Excluded]');
    expect(out.mcpServers.fs.instance).toBe('[Excluded]');
    expect(out.mcpServers.echo.command).toBe('node');
    expect(out.mcpServers.echo.args).toEqual(['echo.js']);
  });

  it('include shows only matching keys; all others become [Excluded] but keep their position', () => {
    const out = applySdkConfigFilter(sample, { include: ['model'] }) as Record<string, unknown>;
    expect(out.model).toBe('claude-opus-4-7');
    expect(out.systemPrompt).toBe('[Excluded]');
    expect(out.mcpServers).toBe('[Excluded]');
  });

  it('include descends into nested paths without flattening intermediate keys', () => {
    const out = applySdkConfigFilter(sample, { include: ['mcpServers.echo.command'] }) as {
      model: string;
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(out.model).toBe('[Excluded]');
    expect(out.mcpServers.echo.command).toBe('node');
    expect(out.mcpServers.echo.args).toBe('[Excluded]');
    expect(out.mcpServers.echo.instance).toBe('[Excluded]');
    expect(out.mcpServers.fs).toBe('[Excluded]');
  });

  it('exclude wins when include and exclude both match', () => {
    const out = applySdkConfigFilter(sample, {
      include: ['mcpServers.echo.instance'],
      exclude: ['mcpServers.echo.instance'],
    }) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(out.mcpServers.echo.instance).toBe('[Excluded]');
  });

  it('handles circular references without stack overflow', () => {
    const input: Record<string, unknown> = { name: 'root' };
    input.self = input;
    const out = applySdkConfigFilter(input, { exclude: ['nothing'] }) as Record<string, unknown>;
    expect(out.name).toBe('root');
    expect(out.self).toBe('[CIRCULAR]');
  });
});

describe('createConsoleObserver sdkConfig filtering', () => {
  const sdkConfig = {
    model: 'claude-opus-4-7',
    mcpServers: { echo: { command: 'node', instance: { deep: 'x' } } },
  };

  it('hides excluded paths as "[Excluded]" in pretty-printed output, keeps keys visible', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({
      stream,
      color: false,
      sdkConfigExclude: ['mcpServers.*.instance'],
    });
    dispatchEvent({ type: 'adapter_ready', adapter: 'claude-code', sdkConfig }, [obs]);
    const out = output();
    expect(out).toContain('"instance": "[Excluded]"');
    expect(out).toContain('"command": "node"');
    expect(out).toContain('"model": "claude-opus-4-7"');
  });

  it('applies filter in compact mode as well', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({
      stream,
      color: false,
      compactAdapterReady: true,
      sdkConfigExclude: ['mcpServers'],
    });
    dispatchEvent({ type: 'adapter_ready', adapter: 'claude-code', sdkConfig }, [obs]);
    expect(output()).toContain('"mcpServers":"[Excluded]"');
  });

  it('include narrows the printed sdkConfig to matching paths', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({
      stream,
      color: false,
      sdkConfigInclude: ['model'],
    });
    dispatchEvent({ type: 'adapter_ready', adapter: 'claude-code', sdkConfig }, [obs]);
    const out = output();
    expect(out).toContain('"model": "claude-opus-4-7"');
    expect(out).toContain('"mcpServers": "[Excluded]"');
  });

  it('no filter options = unchanged default output', () => {
    const { stream, output } = captureStream();
    const obs = createConsoleObserver({ stream, color: false });
    dispatchEvent({ type: 'adapter_ready', adapter: 'claude-code', sdkConfig }, [obs]);
    const out = output();
    expect(out).toContain('"deep": "x"');
    expect(out).not.toContain('[Excluded]');
  });
});
