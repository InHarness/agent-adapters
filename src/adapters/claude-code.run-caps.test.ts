// M01 `toolCallTimeoutMs` and M06 `subagentTimeoutMs` on claude-code — the per-unit
// caps. Each bounds ONE unit of work, is moved only by that unit's own events, and on
// expiry ends the whole run with a typed error naming the unit. Absent → no timer.
//
// Real (short) timers, for the same reason as claude-code.idle-timeout.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { AdapterSubagentTimeoutError, AdapterToolCallTimeoutError } from '../types.js';
import type { RuntimeExecuteParams, UnifiedEvent } from '../types.js';

type QueryArgs = { prompt: AsyncIterable<unknown> | string; options: Record<string, unknown> };
type Script = (args: QueryArgs) => AsyncGenerator<unknown>;

let script: Script | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return { ...actual, query: (args: QueryArgs) => script!(args) };
});

beforeEach(() => {
  script = null;
});

const CAP_MS = 150;
/** Long enough that an idle clock which DID advance would have expired several times. */
const WAIT_MS = 5 * CAP_MS;

function sdk(msg: Record<string, unknown>): SDKMessage {
  return msg as unknown as SDKMessage;
}

/** Resolves after `ms`, or as soon as the run is aborted. */
function sleep(ms: number, options?: Record<string, unknown>): Promise<void> {
  const signal = (options?.abortController as AbortController | undefined)?.signal;
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function resultMessage(extra: Record<string, unknown> = {}): SDKMessage {
  return sdk({
    type: 'result',
    subtype: 'success',
    result: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    session_id: 'sess-caps',
    ...extra,
  });
}

async function openInput(prompt: QueryArgs['prompt']): Promise<AsyncIterator<unknown>> {
  const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
  await input.next();
  return input;
}

async function run(params: Partial<RuntimeExecuteParams>): Promise<{ events: UnifiedEvent[]; elapsedMs: number }> {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  const started = Date.now();
  const events = await collectEvents(new ClaudeCodeAdapter().execute(createTestParams(params)), 10_000);
  return { events, elapsedMs: Date.now() - started };
}

function errors(events: UnifiedEvent[]): Error[] {
  return events.flatMap((e) => (e.type === 'error' ? [e.error] : []));
}


function toolUse(id: string, name = 'Bash', input: Record<string, unknown> = { command: 'x' }): SDKMessage {
  return sdk({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
}
function toolResult(id: string): SDKMessage {
  return sdk({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] } });
}

describe('claude-code — toolCallTimeoutMs', () => {
  it('ends the run with AdapterToolCallTimeoutError naming the call that stood still', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield toolUse('toolu_hang', 'mcp__srv__slow');
      await sleep(60_000, options); // the tool never returns
      yield toolResult('toolu_hang');
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({ toolCallTimeoutMs: CAP_MS });

    expect(elapsedMs).toBeLessThan(WAIT_MS);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ type: 'error', phase: 'runtime' });
    const err = (last as { error: Error }).error;
    expect(err).toBeInstanceOf(AdapterToolCallTimeoutError);
    expect(err).toMatchObject({ toolName: 'mcp__srv__slow', toolUseId: 'toolu_hang', toolCallTimeoutMs: CAP_MS });
    expect(JSON.parse(JSON.stringify(err))).toMatchObject({
      name: 'AdapterToolCallTimeoutError',
      toolName: 'mcp__srv__slow',
      toolUseId: 'toolu_hang',
    });
  });

  it('is armed per call — sequential calls that each stay under the cap accumulate nothing', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      for (const id of ['t1', 't2', 't3', 't4']) {
        yield toolUse(id);
        await sleep(CAP_MS * 0.6, options);
        yield toolResult(id);
      }
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({ toolCallTimeoutMs: CAP_MS });

    expect(elapsedMs).toBeGreaterThan(2 * CAP_MS);
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('absent — a long tool call is not cut', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield toolUse('toolu_long');
      await sleep(WAIT_MS, options);
      yield toolResult('toolu_long');
      yield resultMessage();
    };

    const { events } = await run({});

    expect(errors(events)).toEqual([]);
  });

  it('does not cut a call with an unanswered user_input_request under it', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield toolUse('toolu_ask', 'AskUserQuestion', { questions: [] });
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          const canUseTool = options.canUseTool as (
            t: string,
            i: Record<string, unknown>,
            c: { toolUseID: string },
          ) => Promise<unknown>;
          void canUseTool(
            'AskUserQuestion',
            { questions: [{ question: 'A or B?', header: 'Pick', options: [{ label: 'A' }] }] },
            { toolUseID: 'toolu_ask' },
          ).then(
            () => resolve(),
            () => resolve(),
          );
        });
      });
      yield toolResult('toolu_ask');
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({
      toolCallTimeoutMs: CAP_MS,
      onUserInput: async () => {
        await sleep(WAIT_MS); // a slow human
        return { action: 'accept', answers: [['A']] };
      },
    });

    expect(elapsedMs).toBeGreaterThanOrEqual(WAIT_MS - 10);
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('never arms for the tool_use that opens a subagent', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield toolUse('toolu_agent', 'Agent', { description: 'd', prompt: 'p' });
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 's-1', task_type: 'agent', description: 'd', tool_use_id: 'toolu_agent' });
      await sleep(WAIT_MS, options);
      yield sdk({ type: 'system', subtype: 'task_notification', task_id: 's-1', status: 'completed', summary: 'done' });
      yield toolResult('toolu_agent');
      yield resultMessage();
    };

    const { events } = await run({ toolCallTimeoutMs: CAP_MS });

    expect(errors(events)).toEqual([]);
  });
});

describe('claude-code — subagentTimeoutMs', () => {
  it('closes the open subagent once, then ends with AdapterSubagentTimeoutError', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield toolUse('toolu_agent', 'Agent', { description: 'd', prompt: 'p' });
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 's-1', task_type: 'agent', description: 'd', tool_use_id: 'toolu_agent' });
      await sleep(60_000, options); // the subagent never comes back
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({ subagentTimeoutMs: CAP_MS, toolCallTimeoutMs: CAP_MS });

    expect(elapsedMs).toBeLessThan(WAIT_MS);
    expect(events.filter((e) => e.type === 'subagent_completed')).toEqual([
      { type: 'subagent_completed', taskId: 's-1', status: 'aborted' },
    ]);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ type: 'error', phase: 'runtime' });
    const err = (last as { error: Error }).error;
    expect(err).toBeInstanceOf(AdapterSubagentTimeoutError);
    expect(err).toMatchObject({ taskId: 's-1', subagentTimeoutMs: CAP_MS });
    // The synthesized closure precedes the error.
    expect(events.findIndex((e) => e.type === 'subagent_completed')).toBeLessThan(events.length - 1);
  });

  it('a subagent visibly working (task_progress) is not cut', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 's-1', task_type: 'agent', description: 'd', tool_use_id: 'toolu_agent' });
      for (let i = 0; i < 5; i++) {
        await sleep(CAP_MS * 0.6, options);
        yield sdk({ type: 'system', subtype: 'task_progress', task_id: 's-1', description: `step ${i}`, last_tool_name: 'Read' });
      }
      yield sdk({ type: 'system', subtype: 'task_notification', task_id: 's-1', status: 'completed', summary: 'done' });
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({ subagentTimeoutMs: CAP_MS });

    expect(elapsedMs).toBeGreaterThan(2 * CAP_MS);
    expect(errors(events)).toEqual([]);
    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([{ taskId: 's-1', status: 'completed' }]);
  });

  it('is not re-armed by other stream traffic', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 's-1', task_type: 'agent', description: 'd', tool_use_id: 'toolu_agent' });
      for (let i = 0; i < 20; i++) {
        await sleep(CAP_MS * 0.3, options);
        yield sdk({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `main ${i}` }] } });
      }
      yield resultMessage();
    };

    const { events } = await run({ subagentTimeoutMs: CAP_MS });

    expect(errors(events).at(-1)).toBeInstanceOf(AdapterSubagentTimeoutError);
  });
});

describe('claude-code — a cap never rewrites the reason a run is ending for', () => {
  it('abort() with two open subagents and a slow consumer ends with AdapterAbortError', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      for (const n of [1, 2]) {
        yield toolUse(`toolu_a${n}`, 'Agent', { description: 'd', prompt: 'p' });
        yield sdk({ type: 'system', subtype: 'task_started', task_id: `s-${n}`, task_type: 'agent', description: 'd', tool_use_id: `toolu_a${n}` });
      }
      await sleep(60_000, options);
    };
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const { AdapterAbortError } = await import('../types.js');
    const adapter = new ClaudeCodeAdapter();
    const events: UnifiedEvent[] = [];
    let opened = 0;
    for await (const e of adapter.execute(createTestParams({ subagentTimeoutMs: CAP_MS }))) {
      events.push(e);
      if (e.type === 'subagent_started' && ++opened === 2) adapter.abort();
      // Hold each synthesized close past the subagent cap: the other subagent's cap
      // must not fire while the run is already ending for abort().
      if (e.type === 'subagent_completed') await sleep(WAIT_MS);
    }

    expect(events.filter((e) => e.type === 'subagent_completed')).toHaveLength(2);
    const errs = errors(events);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toBeInstanceOf(AdapterAbortError);
  });
});
