// Unit tests: claude-code adapter native SDK blocks → unified ContentBlock /
// NormalizedMessage. Pure-function level — no SDK calls.

import { describe, it, expect } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { normalizeContentBlocks, normalizeAssistantMessage, todoItemsFromTodoWriteInput } from './claude-code.js';

describe('normalizeContentBlocks', () => {
  it('maps SDK text → text block', () => {
    const out = normalizeContentBlocks([{ type: 'text', text: 'hello' }]);
    expect(out).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('maps SDK thinking → thinking block (uses .thinking field)', () => {
    const out = normalizeContentBlocks([{ type: 'thinking', thinking: 'reasoning…' }]);
    expect(out).toEqual([{ type: 'thinking', text: 'reasoning…' }]);
  });

  it('maps SDK tool_use → toolUse block (renames id→toolUseId, name→toolName)', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_use', id: 'tu_123', name: 'echo', input: { msg: 'hi' } },
    ]);
    expect(out).toEqual([
      { type: 'toolUse', toolUseId: 'tu_123', toolName: 'echo', input: { msg: 'hi' } },
    ]);
  });

  it('defaults missing tool_use input to {}', () => {
    const out = normalizeContentBlocks([{ type: 'tool_use', id: 'x', name: 'noop' }]);
    expect(out).toEqual([{ type: 'toolUse', toolUseId: 'x', toolName: 'noop', input: {} }]);
  });

  it('maps SDK tool_result with string content → toolResult block', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false },
    ]);
    expect(out).toEqual([
      { type: 'toolResult', toolUseId: 'tu_1', content: 'ok', isError: false },
    ]);
  });

  it('JSON-stringifies non-string tool_result content', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_result', tool_use_id: 'tu_2', content: [{ type: 'text', text: 'ok' }] },
    ]);
    expect(out[0]).toMatchObject({
      type: 'toolResult',
      toolUseId: 'tu_2',
      content: JSON.stringify([{ type: 'text', text: 'ok' }]),
    });
  });

  it('passes through tool_result.is_error → isError', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_result', tool_use_id: 'x', content: 'boom', is_error: true },
    ]);
    expect((out[0] as { isError: boolean }).isError).toBe(true);
  });

  it('preserves order across mixed block types', () => {
    const out = normalizeContentBlocks([
      { type: 'thinking', thinking: 'plan' },
      { type: 'text', text: 'answer' },
      { type: 'tool_use', id: 't', name: 'echo', input: { x: 1 } },
    ]);
    expect(out.map((b) => b.type)).toEqual(['thinking', 'text', 'toolUse']);
  });

  it('returns empty for empty input', () => {
    expect(normalizeContentBlocks([])).toEqual([]);
  });

  it('silently drops unknown block types', () => {
    const out = normalizeContentBlocks([
      { type: 'text', text: 'keep' },
      { type: 'mystery_future_type', payload: 'drop' },
    ]);
    expect(out).toEqual([{ type: 'text', text: 'keep' }]);
  });
});

describe('normalizeAssistantMessage', () => {
  function buildSdkAssistant(overrides: Partial<{
    content: unknown[];
    parent_tool_use_id: string | null;
  }>): SDKMessage & { type: 'assistant' } {
    return {
      type: 'assistant',
      parent_tool_use_id: overrides.parent_tool_use_id ?? null,
      message: { content: overrides.content ?? [{ type: 'text', text: 'hi' }] },
    } as unknown as SDKMessage & { type: 'assistant' };
  }

  it('produces an assistant NormalizedMessage with normalized content', () => {
    const msg = normalizeAssistantMessage(
      buildSdkAssistant({ content: [{ type: 'text', text: 'hello' }] }),
    );
    expect(msg.role).toBe('assistant');
    expect(msg.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(typeof msg.timestamp).toBe('string');
    expect(msg.timestamp.length).toBeGreaterThan(0);
  });

  it('preserves the raw SDK message in `native`', () => {
    const sdkMsg = buildSdkAssistant({});
    const out = normalizeAssistantMessage(sdkMsg);
    expect(out.native).toBe(sdkMsg);
  });

  it('maps parent_tool_use_id → subagentTaskId', () => {
    const out = normalizeAssistantMessage(
      buildSdkAssistant({ parent_tool_use_id: 'parent_tu_42' }),
    );
    expect(out.subagentTaskId).toBe('parent_tu_42');
  });

  it('omits subagentTaskId when parent_tool_use_id is null', () => {
    const out = normalizeAssistantMessage(buildSdkAssistant({ parent_tool_use_id: null }));
    expect(out.subagentTaskId).toBeUndefined();
  });

  it('treats non-array content as empty', () => {
    const sdkMsg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: null },
    } as unknown as SDKMessage & { type: 'assistant' };
    const out = normalizeAssistantMessage(sdkMsg);
    expect(out.content).toEqual([]);
  });

  it('round-trips text + tool_use into text + toolUse blocks', () => {
    const out = normalizeAssistantMessage(
      buildSdkAssistant({
        content: [
          { type: 'text', text: 'calling echo…' },
          { type: 'tool_use', id: 'tu_a', name: 'echo', input: { message: 'x' } },
        ],
      }),
    );
    expect(out.content).toEqual([
      { type: 'text', text: 'calling echo…' },
      { type: 'toolUse', toolUseId: 'tu_a', toolName: 'echo', input: { message: 'x' } },
    ]);
  });
});

describe('todoItemsFromTodoWriteInput', () => {
  it('maps TodoWrite.todos → TodoItem[] with synthesized id from index', () => {
    const out = todoItemsFromTodoWriteInput({
      todos: [
        { content: 'First step', status: 'in_progress', activeForm: 'Doing first step' },
        { content: 'Second step', status: 'pending', activeForm: 'Doing second step' },
      ],
    });
    expect(out).toEqual([
      { id: '0', content: 'First step', activeForm: 'Doing first step', status: 'in_progress' },
      { id: '1', content: 'Second step', activeForm: 'Doing second step', status: 'pending' },
    ]);
  });

  it('tolerates missing activeForm', () => {
    const out = todoItemsFromTodoWriteInput({
      todos: [{ content: 'Bare item', status: 'pending' }],
    });
    expect(out).toEqual([{ id: '0', content: 'Bare item', status: 'pending' }]);
  });

  it('defaults missing status to pending and missing content to empty string', () => {
    const out = todoItemsFromTodoWriteInput({ todos: [{}] });
    expect(out).toEqual([{ id: '0', content: '', status: 'pending' }]);
  });

  it('returns [] when todos is missing or not an array', () => {
    expect(todoItemsFromTodoWriteInput({})).toEqual([]);
    expect(todoItemsFromTodoWriteInput({ todos: 'nope' } as unknown as Record<string, unknown>)).toEqual([]);
  });
});
