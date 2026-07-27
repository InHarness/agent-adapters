// M16 id reconciliation, driven through the adapter rather than the pure merge helper.
//
// `TaskCreate`'s input carries no id — the engine assigns one and announces it in the
// create's tool_result ("Task #1 created successfully: …", verbatim on 0.3.153 and
// 0.3.210). Every later `TaskUpdate({ taskId: '1' })` keys on that id, so if the
// adapter fails to recover it the update appends a SECOND, blank-titled item and the
// real one never leaves `pending` — the M16 bug.
//
// Recovering it means regexing English prose, which is a single point of failure a
// CLI reword would break silently. These tests pin the mitigation: the extraction
// accepts several phrasings (see claude-code.normalize.test.ts), and when none match,
// a positional fallback still reconciles the unambiguous case.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import type { UnifiedEvent, TodoItem } from '../types.js';

type QueryArgs = { prompt: AsyncIterable<unknown> | string; options: Record<string, unknown> };

let script: ((args: QueryArgs) => AsyncGenerator<unknown>) | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return { ...actual, query: (args: QueryArgs) => script!(args) };
});

beforeEach(() => {
  script = null;
});

function sdk(msg: Record<string, unknown>): SDKMessage {
  return msg as unknown as SDKMessage;
}

/**
 * The full create→announce→update exchange, as the SDK delivers it: an assistant
 * message carrying the `TaskCreate` tool_use, a user message carrying its
 * tool_result, then the `TaskUpdate` keyed on whatever id the engine announced.
 */
async function runCreateThenUpdate(opts: {
  createResult: string;
  updateTaskId: string;
}): Promise<UnifiedEvent[]> {
  script = async function* ({ prompt }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();

    yield sdk({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_create',
            name: 'TaskCreate',
            input: { subject: 'probe task', description: 'Extract the avatar upload component' },
          },
        ],
      },
    });
    yield sdk({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_create', content: opts.createResult }],
      },
    });
    yield sdk({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_update',
            name: 'TaskUpdate',
            input: { taskId: opts.updateTaskId, status: 'completed' },
          },
        ],
      },
    });
    yield sdk({
      type: 'result',
      subtype: 'success',
      result: 'ok',
      usage: { input_tokens: 1, output_tokens: 1 },
      session_id: 'sess-1',
    });
  };

  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return collectEvents(new ClaudeCodeAdapter().execute(createTestParams({})), 10_000);
}

function finalSnapshot(events: UnifiedEvent[]): TodoItem[] | undefined {
  const result = events.find((e) => e.type === 'result');
  return result && 'todoListSnapshot' in result ? result.todoListSnapshot : undefined;
}

describe('claude-code — TaskCreate/TaskUpdate id reconciliation (M16)', () => {
  it('reconciles through the announced id', () => {
    return runCreateThenUpdate({
      createResult: 'Task #1 created successfully: probe task',
      updateTaskId: '1',
    }).then((events) => {
      expect(finalSnapshot(events)).toEqual([
        { id: 'toolu_create', content: 'Extract the avatar upload component', status: 'completed' },
      ]);
    });
  });

  it('reconciles positionally when the tool_result names no id at all', async () => {
    // The reworded-CLI scenario. One create is outstanding and the update names an id
    // we have never seen, so they can only be the same task — recovering the alias
    // without the engine having spelled it out.
    const events = await runCreateThenUpdate({
      createResult: 'Done.',
      updateTaskId: '1',
    });

    expect(
      finalSnapshot(events),
      'a reworded tool_result must not split one task into two items',
    ).toEqual([{ id: 'toolu_create', content: 'Extract the avatar upload component', status: 'completed' }]);
  });

  it('leaves an unknown id alone when two creates are outstanding', async () => {
    // Ambiguous: guessing here would corrupt a real item, whereas not guessing merely
    // appends a stray one. Two unnamed creates, then an update for an id neither
    // announced — the fallback must decline.
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();

      for (const n of ['a', 'b']) {
        yield sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: `toolu_${n}`, name: 'TaskCreate', input: { subject: `task ${n}`, description: `do ${n}` } },
            ],
          },
        });
        yield sdk({
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'Done.' }] },
        });
      }
      yield sdk({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_up', name: 'TaskUpdate', input: { taskId: '9', status: 'completed' } }],
        },
      });
      yield sdk({ type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, session_id: 's' });
    };

    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events = await collectEvents(new ClaudeCodeAdapter().execute(createTestParams({})), 10_000);

    expect(finalSnapshot(events)).toEqual([
      { id: 'toolu_a', content: 'do a', status: 'pending' },
      { id: 'toolu_b', content: 'do b', status: 'pending' },
      { id: '9', content: '', status: 'completed' },
    ]);
  });

  it('does not hijack an update that names an item already in the snapshot', async () => {
    // The update keys on the create's own toolUseId, which already resolves. The
    // fallback must not fire and re-point it at something else.
    const events = await runCreateThenUpdate({
      createResult: 'Done.',
      updateTaskId: 'toolu_create',
    });

    expect(finalSnapshot(events)).toEqual([
      { id: 'toolu_create', content: 'Extract the avatar upload component', status: 'completed' },
    ]);
  });
});
