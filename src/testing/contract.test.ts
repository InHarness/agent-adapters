import { describe, it, expect } from 'vitest';
import { MockAdapter, createTestParams } from './helpers.js';
import { assertSimpleText, assertToolUse, assertThinking, assertMultiTurn } from './contract.js';
import type { UnifiedEvent, NormalizedMessage } from '../types.js';

const assistantMsg: NormalizedMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello world' }],
  timestamp: new Date().toISOString(),
};

describe('contract assertions with MockAdapter', () => {
  it('assertSimpleText passes with valid events', async () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'Hello', isSubagent: false },
      { type: 'text_delta', text: ' world', isSubagent: false },
      { type: 'assistant_message', message: assistantMsg },
      { type: 'result', output: 'Hello world', rawMessages: [assistantMsg], usage: { inputTokens: 10, outputTokens: 5 } },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertSimpleText(mock.execute(createTestParams()));
    expect(result.passed).toBe(true);
    expect(result.assertions.every((a) => a.passed)).toBe(true);
  });

  it('assertSimpleText fails without text_delta', async () => {
    const events: UnifiedEvent[] = [
      { type: 'assistant_message', message: assistantMsg },
      { type: 'result', output: 'Hello', rawMessages: [assistantMsg], usage: { inputTokens: 10, outputTokens: 5 } },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertSimpleText(mock.execute(createTestParams()));
    expect(result.passed).toBe(false);
  });

  it('assertToolUse passes with tool events', async () => {
    const events: UnifiedEvent[] = [
      { type: 'tool_use', toolName: 'Read', toolUseId: 'tu_1', input: { path: '/tmp' }, isSubagent: false },
      { type: 'tool_result', toolUseId: 'tu_1', summary: 'file contents' },
      { type: 'assistant_message', message: assistantMsg },
      { type: 'result', output: 'Done', rawMessages: [assistantMsg], usage: { inputTokens: 20, outputTokens: 10 } },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertToolUse(mock.execute(createTestParams()));
    expect(result.passed).toBe(true);
  });

  it('assertThinking passes with thinking before text', async () => {
    const events: UnifiedEvent[] = [
      { type: 'thinking', text: 'Let me think...', isSubagent: false },
      { type: 'text_delta', text: 'Answer', isSubagent: false },
      { type: 'assistant_message', message: assistantMsg },
      { type: 'result', output: 'Answer', rawMessages: [assistantMsg], usage: { inputTokens: 15, outputTokens: 8 } },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertThinking(mock.execute(createTestParams()));
    expect(result.passed).toBe(true);
  });

  it('assertMultiTurn passes with multiple turns', async () => {
    const msg2: NormalizedMessage = { ...assistantMsg, content: [{ type: 'text', text: 'Second' }] };
    const events: UnifiedEvent[] = [
      { type: 'tool_use', toolName: 'Read', toolUseId: 'tu_1', input: {}, isSubagent: false },
      { type: 'tool_result', toolUseId: 'tu_1', summary: 'file1' },
      { type: 'assistant_message', message: assistantMsg },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'tu_2', input: {}, isSubagent: false },
      { type: 'tool_result', toolUseId: 'tu_2', summary: 'file2' },
      { type: 'assistant_message', message: msg2 },
      { type: 'result', output: 'Summary', rawMessages: [assistantMsg, msg2], usage: { inputTokens: 30, outputTokens: 15 } },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertMultiTurn(mock.execute(createTestParams()));
    expect(result.passed).toBe(true);
  });
});
