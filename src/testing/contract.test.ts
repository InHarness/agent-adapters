import { describe, it, expect } from 'vitest';
import { MockAdapter, createTestParams } from './helpers.js';
import {
  assertSimpleText,
  assertToolUse,
  assertThinking,
  assertMultiTurn,
  assertSubagentLifecycle,
} from './contract.js';
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
      { type: 'result', output: 'Hello world', rawMessages: [assistantMsg], usage: { inputTokens: 10, outputTokens: 5 }, contextSize: 15 },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertSimpleText(mock.execute(createTestParams()));
    expect(result.passed).toBe(true);
    expect(result.assertions.every((a) => a.passed)).toBe(true);
  });

  it('assertSimpleText fails without text_delta', async () => {
    const events: UnifiedEvent[] = [
      { type: 'assistant_message', message: assistantMsg },
      { type: 'result', output: 'Hello', rawMessages: [assistantMsg], usage: { inputTokens: 10, outputTokens: 5 }, contextSize: 15 },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertSimpleText(mock.execute(createTestParams()));
    expect(result.passed).toBe(false);
  });

  it('assertSimpleText tolerates a warning trailing the terminal result', async () => {
    // `warning` is side-band and may legitimately follow the terminal `result`: the
    // background-task hold raises one from a timer callback, which by construction
    // fires after the last result of the run (M17). "Result is terminal" means last
    // non-`warning`, non-`flush` event.
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'Hello world', isSubagent: false },
      { type: 'assistant_message', message: assistantMsg },
      { type: 'result', output: 'Hello world', rawMessages: [assistantMsg], usage: { inputTokens: 10, outputTokens: 5 }, contextSize: 15 },
      { type: 'warning', message: 'claude-code: background work still in flight after 120000ms' },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertSimpleText(mock.execute(createTestParams()));
    expect(
      result.assertions.find((a) => a.name === 'result is terminal event')?.passed,
      'a trailing warning must not read as a non-terminal stream',
    ).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('assertToolUse passes with tool events', async () => {
    const events: UnifiedEvent[] = [
      { type: 'tool_use', toolName: 'Read', toolUseId: 'tu_1', input: { path: '/tmp' }, isSubagent: false },
      { type: 'tool_result', toolUseId: 'tu_1', summary: 'file contents' },
      { type: 'assistant_message', message: assistantMsg },
      { type: 'result', output: 'Done', rawMessages: [assistantMsg], usage: { inputTokens: 20, outputTokens: 10 }, contextSize: 30 },
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
      { type: 'result', output: 'Answer', rawMessages: [assistantMsg], usage: { inputTokens: 15, outputTokens: 8 }, contextSize: 23 },
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
      { type: 'result', output: 'Summary', rawMessages: [assistantMsg, msg2], usage: { inputTokens: 30, outputTokens: 15 }, contextSize: 45 },
    ];

    const mock = new MockAdapter('test', events);
    const result = await assertMultiTurn(mock.execute(createTestParams()));
    expect(result.passed).toBe(true);
  });
});

describe('assertSubagentLifecycle', () => {
  it('anchors "nothing after the terminal error" on the LAST error, not the first', () => {
    // `error` is not always terminal: claude-code yields one when a consumer's
    // `onUserInput` callback throws and keeps iterating, gemini yields non-fatal ones.
    // Anchoring on the first would fail a perfectly conformant run whose delegation
    // merely happened after such an event.
    const events: UnifiedEvent[] = [
      { type: 'error', error: new Error('non-fatal hiccup'), phase: 'runtime' },
      { type: 'subagent_started', taskId: 's-1', description: 'work' },
      { type: 'subagent_completed', taskId: 's-1', status: 'aborted' },
      { type: 'error', error: new Error('terminal'), phase: 'runtime' },
    ];
    const result = assertSubagentLifecycle(events);
    expect(result.assertions.filter((a) => !a.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('still fails a flush that lands after the terminal error', () => {
    const events: UnifiedEvent[] = [
      { type: 'subagent_started', taskId: 's-1', description: 'work' },
      { type: 'error', error: new Error('terminal'), phase: 'runtime' },
      { type: 'subagent_completed', taskId: 's-1', status: 'aborted' },
    ];
    expect(assertSubagentLifecycle(events).passed).toBe(false);
  });
});
