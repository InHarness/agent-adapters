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

/**
 * Drive an arbitrary sequence of task-tracking calls through the adapter. Each
 * step is one assistant message carrying one `tool_use`, optionally followed by
 * the user message carrying its `tool_result` — the shape the SDK really
 * delivers, and the only shape in which the suppression and aliasing logic runs.
 */
async function runTaskCalls(
  steps: Array<{ id: string; name: string; input: Record<string, unknown>; result?: string }>,
): Promise<UnifiedEvent[]> {
  script = async function* ({ prompt }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();

    for (const step of steps) {
      yield sdk({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: step.id, name: step.name, input: step.input }],
        },
      });
      if (step.result !== undefined) {
        yield sdk({
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: step.id, content: step.result }] },
        });
      }
    }
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

const todoEvents = (events: UnifiedEvent[]) => events.filter((e) => e.type === 'todo_list_updated');
const warnings = (events: UnifiedEvent[]) =>
  events.filter((e): e is Extract<UnifiedEvent, { type: 'warning' }> => e.type === 'warning');
const taskToolEvents = (events: UnifiedEvent[]) =>
  events.filter((e) => e.type === 'tool_use' && e.toolName.startsWith('Task'));

// The consumer-visible half of the regression. Merging is not enough: an
// unmerged call ALSO leaks its raw tool_use/tool_result pair, so the user sees
// internal task plumbing rendered as ordinary tool rows instead of a todo list.
describe('claude-code — raw-stream task shapes reach the todo list (M16)', () => {
  it("advances the snapshot for a TaskUpdate whose status arrives under 'state'", async () => {
    const events = await runTaskCalls([
      { id: 'toolu_create', name: 'TaskCreate', input: { subject: 'p', description: 'Wire the adapter' }, result: 'Task #4 created successfully: p' },
      { id: 'toolu_update', name: 'TaskUpdate', input: { taskId: '4', state: 'in_progress' } },
    ]);

    expect(finalSnapshot(events)).toEqual([
      { id: 'toolu_create', content: 'Wire the adapter', status: 'in_progress' },
    ]);
    expect(todoEvents(events)).toHaveLength(2);
    expect(taskToolEvents(events), 'a merged task call must not leak as a plain tool row').toEqual([]);
    expect(warnings(events)).toEqual([]);
  });

  it('projects a batch TaskCreate as one todo_list_updated covering every item', async () => {
    const events = await runTaskCalls([
      {
        id: 'toolu_batch',
        name: 'TaskCreate',
        input: { tasks: '[{"content":"a","status":"pending"},{"content":"b","status":"in_progress"}]' },
        result: 'Task #1 created successfully: a\nTask #2 created successfully: b',
      },
    ]);

    expect(todoEvents(events)).toHaveLength(1);
    expect(finalSnapshot(events)?.map((i) => [i.content, i.status])).toEqual([
      ['a', 'pending'],
      ['b', 'in_progress'],
    ]);
    expect(taskToolEvents(events)).toEqual([]);
  });

  // The batch flavour of the M16 bug: without positional aliasing the update
  // appends a blank stub and the real item never leaves `pending`.
  it('aliases a batch result positionally so a later TaskUpdate hits the right item', async () => {
    const events = await runTaskCalls([
      {
        id: 'toolu_batch',
        name: 'TaskCreate',
        input: { tasks: '[{"content":"a"},{"content":"b"}]' },
        result: 'Task #1 created successfully: a\nTask #2 created successfully: b',
      },
      { id: 'toolu_update', name: 'TaskUpdate', input: { taskId: '2', status: 'completed' } },
    ]);

    const snapshot = finalSnapshot(events);
    expect(snapshot, 'the update must land on item b, not append a third item').toHaveLength(2);
    expect(snapshot?.map((i) => [i.content, i.status])).toEqual([
      ['a', 'pending'],
      ['b', 'completed'],
    ]);
  });

  it('declines to alias a batch whose result names the wrong number of ids', async () => {
    // Two items, one announced id: which one does it name? Guessing corrupts a
    // real item, so the update is allowed to append its stray stub instead.
    const events = await runTaskCalls([
      {
        id: 'toolu_batch',
        name: 'TaskCreate',
        input: { tasks: '[{"content":"a"},{"content":"b"}]' },
        result: 'Task #1 created successfully: a',
      },
      { id: 'toolu_update', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
    ]);

    expect(finalSnapshot(events)?.map((i) => [i.content, i.status])).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
      ['', 'completed'],
    ]);
  });
});

// Before this, a dropped write was invisible: no event, no log, just a list that
// silently stopped advancing. The warning is the only way a consumer can notice.
describe('claude-code — an unmergeable task WRITE is reported (M16)', () => {
  it('warns, naming the tool and the offending input keys, and keeps the raw pair visible', async () => {
    const events = await runTaskCalls([
      { id: 'toolu_bad', name: 'TaskCreate', input: { tasks: '[{' }, result: 'oops' },
    ]);

    const messages = warnings(events).map((w) => w.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('TaskCreate');
    expect(messages[0]).toContain('tasks');
    expect(todoEvents(events)).toEqual([]);
    expect(taskToolEvents(events), 'nothing merged, so the raw pair must stay visible').toHaveLength(1);
  });

  it('does not crash the stream on a malformed batch — the run still completes', async () => {
    const events = await runTaskCalls([
      { id: 'toolu_bad', name: 'TaskCreate', input: { tasks: '[{' }, result: 'oops' },
    ]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('warns once per distinct shape, not once per call', async () => {
    const events = await runTaskCalls([
      { id: 'toolu_1', name: 'TaskUpdate', input: { taskId: '1', bogus: 'x' } },
      { id: 'toolu_2', name: 'TaskUpdate', input: { taskId: '2', bogus: 'y' } },
      { id: 'toolu_3', name: 'TaskUpdate', input: { taskId: '3', other: 'z' } },
    ]);

    const messages = warnings(events).map((m) => m.message);
    expect(messages, 'two repeats of one shape plus one new shape → two warnings').toHaveLength(2);
    expect(messages[0]).toContain('bogus');
    expect(messages[1]).toContain('other');
  });

  it('stays silent for the READ verbs — TaskGet and TaskList merge nothing by design', async () => {
    const events = await runTaskCalls([
      { id: 'toolu_get', name: 'TaskGet', input: { taskId: '1' }, result: 'task 1: pending' },
      { id: 'toolu_list', name: 'TaskList', input: {}, result: 'no tasks' },
    ]);

    expect(warnings(events), 'a read that merges nothing is correct, not a loss').toEqual([]);
    expect(todoEvents(events)).toEqual([]);
    expect(taskToolEvents(events), 'their answer lives in the tool_result, so it must survive').toHaveLength(2);
  });
});
