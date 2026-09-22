// M13 on opencode: abort() / timeoutMs while the consumer's onUserInput handler is
// still pending must terminate the run, answer the question `cancel`, and shut the
// spawned OpenCode server down. Mirrors the claude-code regression test in
// claude-code.background-tasks.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterAbortError, AdapterTimeoutError } from '../types.js';
import type { UnifiedEvent } from '../types.js';
import { createTestParams } from '../testing/helpers.js';

const SESSION_ID = 'ses-1';
const QUESTION_ID = 'que-1';

/** Whether the v2 question stream emits a `question.asked` for this test. */
let askQuestion = true;
const serverClose = vi.fn();
const questionReply = vi.fn(async () => ({}));
const questionReject = vi.fn(async () => ({}));

/** A stream that never yields and never ends — and ignores abort, like a wedged SSE. */
function silentStream(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<unknown>>(() => {}) }),
  };
}

vi.mock('@opencode-ai/sdk', () => ({
  createOpencode: async () => ({
    client: {
      session: {
        create: async () => ({ data: { id: SESSION_ID } }),
        promptAsync: async () => ({}),
      },
      event: { subscribe: async () => ({ stream: silentStream() }) },
    },
    server: { close: serverClose },
  }),
}));

vi.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: () => ({
    event: {
      subscribe: async () => ({
        stream: (async function* () {
          if (!askQuestion) return yield* silentStream();
          // Let the main loop create the session first, so the id filter passes.
          await new Promise((r) => setTimeout(r, 20));
          yield {
            type: 'question.asked',
            properties: {
              id: QUESTION_ID,
              sessionID: SESSION_ID,
              questions: [{ question: 'Proceed?', options: [{ label: 'Yes', description: '' }] }],
            },
          };
          yield* silentStream();
        })(),
      }),
    },
    question: { reply: questionReply, reject: questionReject },
  }),
}));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY ??= 'test-key';
  askQuestion = true;
  serverClose.mockClear();
  questionReply.mockClear();
  questionReject.mockClear();
});

const PULL_TIMEOUT_MS = 2_000;
const HUNG = Symbol('hung');

/**
 * Pump the stream by hand rather than with `for await`, so a stall is a failed
 * assertion instead of a hung suite. `onEvent` is where the test injects `abort()`.
 */
async function pumpUntilDone(
  stream: AsyncIterable<UnifiedEvent>,
  onEvent: (e: UnifiedEvent) => void = () => {},
): Promise<{ events: UnifiedEvent[]; terminated: boolean }> {
  const iterator = stream[Symbol.asyncIterator]();
  const events: UnifiedEvent[] = [];
  for (;;) {
    const winner = await Promise.race([
      iterator.next(),
      new Promise<typeof HUNG>((r) => setTimeout(() => r(HUNG), PULL_TIMEOUT_MS)),
    ]);
    if (winner === HUNG) {
      // Not awaited: the generator is parked on an await, so return() would hang too.
      void iterator.return?.();
      return { events, terminated: false };
    }
    if (winner.done) return { events, terminated: true };
    events.push(winner.value);
    onEvent(winner.value);
  }
}

async function newAdapter() {
  const { OpencodeAdapter } = await import('./opencode.js');
  return new OpencodeAdapter();
}

const neverAnswers = () => new Promise<never>(() => {});
const params = (extra: Record<string, unknown> = {}) =>
  createTestParams({ model: 'openrouter/test/model', onUserInput: neverAnswers, ...extra });

function terminalError(events: UnifiedEvent[]) {
  const errs = events.filter((e) => e.type === 'error');
  expect(errs).toHaveLength(1);
  expect(errs[0]).toMatchObject({ phase: 'runtime' });
  return (errs[0] as { error: Error }).error;
}

describe('opencode — abort while a user-input request is outstanding', () => {
  it('abort() terminates a run parked on an unanswered question and answers it cancel', async () => {
    const adapter = await newAdapter();
    let sawRequest = false;
    const { events, terminated } = await pumpUntilDone(adapter.execute(params()), (e) => {
      if (e.type === 'user_input_request') {
        sawRequest = true;
        adapter.abort();
      }
    });

    expect(sawRequest, 'the question should have surfaced before aborting').toBe(true);
    expect(terminated, 'abort() must end a run parked on an unanswered user-input request').toBe(true);
    expect(terminalError(events)).toBeInstanceOf(AdapterAbortError);
    await vi.waitFor(() => expect(questionReject).toHaveBeenCalledWith(expect.objectContaining({ requestID: QUESTION_ID })));
    expect(questionReply).not.toHaveBeenCalled();
  });

  it('timeoutMs expiring while the question is pending ends the run with AdapterTimeoutError', async () => {
    const adapter = await newAdapter();
    const { events, terminated } = await pumpUntilDone(adapter.execute(params({ timeoutMs: 300 })));

    expect(events.some((e) => e.type === 'user_input_request')).toBe(true);
    expect(terminated).toBe(true);
    expect(terminalError(events)).toBeInstanceOf(AdapterTimeoutError);
    await vi.waitFor(() => expect(questionReject).toHaveBeenCalled());
    expect(serverClose).toHaveBeenCalledTimes(1);
  });

  it('abort() alone shuts the spawned server down — no leaked OpenCode process', async () => {
    const adapter = await newAdapter();
    const iterator = adapter.execute(params())[Symbol.asyncIterator]();
    for (;;) {
      const r = await iterator.next();
      if (r.done) throw new Error('stream ended before the question surfaced');
      if (r.value.type === 'user_input_request') break;
    }

    // The consumer aborts and never pulls again: the finally is unreachable, so the
    // server must die from abort() itself.
    adapter.abort();
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect((adapter as unknown as { serverClose: unknown }).serverClose).toBeNull();

    // Draining afterwards reaches the finally, which must not close a second time.
    const { terminated } = await pumpUntilDone({ [Symbol.asyncIterator]: () => iterator });
    expect(terminated).toBe(true);
    expect(serverClose).toHaveBeenCalledTimes(1);
  });

  it('abort() terminates a run parked on a silent SSE stream', async () => {
    askQuestion = false;
    const adapter = await newAdapter();
    const { events, terminated } = await pumpUntilDone(adapter.execute(params()), (e) => {
      if (e.type === 'adapter_ready') setTimeout(() => adapter.abort(), 50);
    });

    expect(terminated).toBe(true);
    expect(terminalError(events)).toBeInstanceOf(AdapterAbortError);
    expect(serverClose).toHaveBeenCalledTimes(1);
  });
});
