// M01 `idleTimeoutMs` and `timeoutMs` on claude-code — the two adapter-side clocks
// a consumer sets.
//
//   - The idle clock advances ONLY while nothing is outstanding. A run parked on an
//     unanswered user_input_request, on a slow tool, on an open subagent or on an
//     unsettled background task must outlive a short `idleTimeoutMs` — and a run that
//     is silent with nothing outstanding must end with AdapterIdleTimeoutError.
//   - `timeoutMs` is the absolute backstop from run start: events never re-arm it,
//     and when it is absent no wall-clock bound exists at all.
//
// Real (short) timers: the adapter's own loop races SDK messages against its abort
// promise, and fake timers would have to be threaded through every macrotask hop.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { AdapterAbortError, AdapterIdleTimeoutError, AdapterTimeoutError } from '../types.js';
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

const IDLE_MS = 150;
/** Long enough that an idle clock which DID advance would have expired several times. */
const WAIT_MS = 5 * IDLE_MS;

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
    session_id: 'sess-idle',
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

describe('claude-code — idleTimeoutMs does not advance while work is outstanding', () => {
  it('a run parked on an unanswered user_input_request does not expire on the idle clock', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      // Deferred a macrotask so the adapter's loop has armed its user-input waker.
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
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({
      idleTimeoutMs: IDLE_MS,
      // A human being slow: the answer arrives long after the idle budget.
      onUserInput: async () => {
        await sleep(WAIT_MS);
        return { action: 'accept', answers: [['A']] };
      },
    });

    expect(elapsedMs).toBeGreaterThanOrEqual(WAIT_MS - 10);
    expect(events.some((e) => e.type === 'user_input_request')).toBe(true);
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('a run whose only activity is a single tool_use awaiting its tool_result does not expire', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield sdk({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_slow', name: 'Bash', input: { command: 'sleep' } }] },
      });
      await sleep(WAIT_MS, options);
      yield sdk({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_slow', content: 'done' }] },
      });
      yield resultMessage();
    };

    const { events } = await run({ idleTimeoutMs: IDLE_MS });

    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('an open subagent is outstanding work — the idle clock cannot cut it short', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 's-1', task_type: 'agent', description: 'd', tool_use_id: 'toolu_s' });
      await sleep(WAIT_MS, options);
      yield sdk({ type: 'system', subtype: 'task_notification', task_id: 's-1', status: 'completed', summary: 'done' });
      yield resultMessage();
    };

    const { events } = await run({ idleTimeoutMs: IDLE_MS });

    expect(errors(events)).toEqual([]);
    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([{ taskId: 's-1', status: 'completed' }]);
  });

  it('an unsettled background task is outstanding work — the run survives the idle budget', async () => {
    script = async function* ({ prompt, options }) {
      const input = await openInput(prompt);
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 'bg-1', task_type: 'shell', description: 'sleep 12' });
      yield resultMessage();
      // Held open for the background task; it settles long after the idle budget.
      await sleep(WAIT_MS, options);
      yield sdk({ type: 'system', subtype: 'task_notification', task_id: 'bg-1', status: 'completed' });
      yield resultMessage({ result: 'woke' });
      await input.next();
    };

    const { events } = await run({
      idleTimeoutMs: IDLE_MS,
      streamingInput: true,
      architectureConfig: { claude_backgroundGraceMs: 20 },
    });

    expect(errors(events).filter((e) => e instanceof AdapterIdleTimeoutError)).toEqual([]);
    expect(events.some((e) => e.type === 'background_task_completed')).toBe(true);
  });
});

describe('claude-code — idleTimeoutMs expires a run that is silent with nothing outstanding', () => {
  it('ends with AdapterIdleTimeoutError in the runtime phase', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield sdk({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'thinking about it' }] } });
      await sleep(60_000, options); // the engine gone quiet
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({ idleTimeoutMs: IDLE_MS });

    const terminal = events.filter((e) => e.type === 'error');
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ phase: 'runtime' });
    const err = (terminal[0] as { error: Error }).error;
    expect(err).toBeInstanceOf(AdapterIdleTimeoutError);
    expect(err).not.toBeInstanceOf(AdapterTimeoutError);
    expect((err as AdapterIdleTimeoutError).idleTimeoutMs).toBe(IDLE_MS);
    expect(elapsedMs).toBeLessThan(WAIT_MS);
  });

  it('closes an open subagent only via the other terminations — abort still reports AdapterAbortError', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 's-1', task_type: 'agent', description: 'd', tool_use_id: 'toolu_s' });
      await sleep(60_000, options);
    };
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();
    setTimeout(() => adapter.abort(), WAIT_MS);
    const events = await collectEvents(adapter.execute(createTestParams({ idleTimeoutMs: IDLE_MS })), 10_000);

    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([{ taskId: 's-1', status: 'aborted' }]);
    const errs = errors(events);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toBeInstanceOf(AdapterAbortError);
  });
});

describe('claude-code — the idle clock never turns a delivered result into a failure', () => {
  it('a slow consumer is not an idle engine', async () => {
    script = async function* ({ prompt }) {
      await openInput(prompt);
      yield sdk({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } });
      yield resultMessage();
    };
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events: UnifiedEvent[] = [];
    for await (const e of new ClaudeCodeAdapter().execute(createTestParams({ idleTimeoutMs: IDLE_MS }))) {
      events.push(e);
      // A DB write, a UI round trip — the consumer's time, not the engine's.
      await sleep(WAIT_MS);
    }

    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('the M17 grace window after the result does not advance the idle clock', async () => {
    script = async function* ({ prompt }) {
      const input = await openInput(prompt);
      // A subagent that settles inside the turn arms the short grace hold at `result`.
      yield sdk({ type: 'system', subtype: 'task_started', task_id: 's-1', task_type: 'agent', description: 'd', tool_use_id: 'toolu_s' });
      yield sdk({ type: 'system', subtype: 'task_notification', task_id: 's-1', status: 'completed', summary: 'done' });
      yield resultMessage();
      // The engine never wakes: the CLI exits once the grace window closes the channel.
      await input.next();
    };

    const { events, elapsedMs } = await run({
      idleTimeoutMs: IDLE_MS,
      architectureConfig: { claude_backgroundGraceMs: WAIT_MS },
    });

    expect(elapsedMs).toBeGreaterThanOrEqual(WAIT_MS - 10);
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('a slow SDK shutdown after the final result does not advance the idle clock', async () => {
    script = async function* ({ prompt }) {
      await openInput(prompt);
      yield resultMessage();
      await sleep(WAIT_MS); // the CLI taking its time to exit
    };

    const { events, elapsedMs } = await run({ idleTimeoutMs: IDLE_MS });

    expect(elapsedMs).toBeGreaterThanOrEqual(WAIT_MS - 10);
    expect(errors(events)).toEqual([]);
  });
});

describe('claude-code — timeoutMs is the absolute backstop', () => {
  it('a run that keeps emitting events still terminates at timeoutMs measured from run start', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      const signal = (options.abortController as AbortController).signal;
      while (!signal.aborted) {
        yield sdk({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'tick' }] } });
        await sleep(20, options);
      }
    };

    const { events, elapsedMs } = await run({ timeoutMs: 200 });

    const errs = errors(events);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toBeInstanceOf(AdapterTimeoutError);
    expect(events.filter((e) => e.type === 'text_delta' || e.type === 'assistant_message').length).toBeGreaterThan(3);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('with timeoutMs (and idleTimeoutMs) absent, elapsed time alone never ends a run', async () => {
    script = async function* ({ prompt, options }) {
      await openInput(prompt);
      await sleep(WAIT_MS, options);
      yield resultMessage();
    };

    const { events, elapsedMs } = await run({});

    expect(elapsedMs).toBeGreaterThanOrEqual(WAIT_MS - 10);
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });
});
