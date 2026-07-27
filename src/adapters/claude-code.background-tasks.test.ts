// Regression tests: in streaming-input mode the claude-code input channel must stay
// OPEN while a run still holds in-flight background work.
//
// Why this is load-bearing. Our prompt is an AsyncIterable; when it ends, the SDK's
// `Query.streamInput()` calls `transport.endInput()` → `processStdin.end()`, closing
// the CLI's stdin. The control protocol (`can_use_tool`, hooks, elicitation) is
// multiplexed over that SAME stdin, so once it is closed any control request the CLI
// issues afterwards can never be answered and dies with:
//
//   Tool permission request failed: AbortError: Stream closed
//
// And `result` is NOT the end of the session: while `SDKResultMessage.background_tasks`
// is non-empty the CLI holds the session open, pauses, and wakes the model on
// `task_notification` — which then goes on to call tools, `AskUserQuestion` included.
//
// The adapter closes the channel on the first `result` unless a `pushMessage()` is
// pending (src/adapters/claude-code.ts, `case 'result'`), and never looks at
// `background_tasks` at all — so the wake-up runs against a dead control channel.
//
// Scope note — read before trusting this file. A mocked `query()` has no real stdin, so
// nothing here can reproduce a closed transport: `canUseTool` is invoked directly and
// always resolves. What this file pins is the adapter's channel LIFECYCLE. The
// user-visible symptom is owned by the live e2e scenario in
// src/testing/e2e/claude-code.e2e.test.ts, and live evidence there narrowed the actual
// regression to the SDK's own `isSingleUserTurn` stdin close on the string-prompt path
// (0.3.210 loses the post-`result` wake-up; 0.3.153 does not) — NOT to the early close
// characterized below, which the streaming path survives on both versions.
//
// See PLAN-tests-stream-e2e.md (these tests) and PLAN-streamingn-input-fix.md (the fix).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { AdapterAbortError } from '../types.js';
import type { UnifiedEvent, UserInputRequest } from '../types.js';

type QueryArgs = { prompt: AsyncIterable<unknown> | string; options: Record<string, unknown> };
type Script = (args: QueryArgs) => AsyncGenerator<unknown>;

let script: Script | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: (args: QueryArgs) => script!(args),
  };
});

beforeEach(() => {
  script = null;
});

function resultMessage(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: 'ok',
    usage: { input_tokens: 10, output_tokens: 5 },
    session_id: 'sess-1',
    ...overrides,
  } as unknown as SDKMessage;
}

/** One in-flight backgrounded shell task, as the SDK reports it (sdk.d.ts BackgroundTaskSummary). */
const BACKGROUND_TASK_RUNNING = [
  { id: 'bg-1', type: 'shell', status: 'running', description: 'sleep 12' },
];

const TICK = Symbol('tick');

/**
 * Did the adapter already close the channel? Race the pull against one macrotask
 * tick: a closed channel resolves `{done: true}` immediately, an open one stays
 * pending and the tick wins.
 */
async function pullIsDone(pull: Promise<IteratorResult<unknown>>): Promise<boolean> {
  const winner = await Promise.race([
    pull,
    new Promise<typeof TICK>((resolve) => setImmediate(() => resolve(TICK))),
  ]);
  return winner !== TICK && (winner as IteratorResult<unknown>).done === true;
}

interface ScenarioResult {
  events: UnifiedEvent[];
  /** Was the input channel already closed right after the first `result`? */
  inputDoneAfterResult: boolean | null;
  /** The pull retained across the measurement — must resolve `done` at teardown. */
  pendingPull: Promise<IteratorResult<unknown>> | null;
  askRequests: UserInputRequest[];
}

/**
 * Drive the adapter through: seed → `result` (optionally carrying in-flight
 * background work) → measure the channel → optionally the CLI's wake-up plus an
 * `AskUserQuestion` control request → final `result`.
 */
async function runScenario(opts: {
  backgroundTasks: unknown[];
  wakeAndAsk: boolean;
}): Promise<ScenarioResult> {
  let inputDoneAfterResult: boolean | null = null;
  let pendingPull: Promise<IteratorResult<unknown>> | null = null;
  const askRequests: UserInputRequest[] = [];

  script = async function* ({ prompt, options }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next(); // the seeded prompt message

    yield resultMessage({ background_tasks: opts.backgroundTasks });

    // The measurement. In production this pull is the SDK's own read of our
    // iterable, and `done` here means `stdin.end()` on the CLI process.
    //
    // Only ONE pull may be outstanding at a time: createInputChannel keeps a single
    // `resolveNext`, so a second concurrent next() would orphan this promise. We
    // retain it and never pull again.
    pendingPull = input.next();
    inputDoneAfterResult = await pullIsDone(pendingPull);

    if (!opts.wakeAndAsk) return;

    // The CLI's wake-up once the backgrounded task settles.
    yield {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'bg-1',
      status: 'completed',
    } as unknown as SDKMessage;

    // Stand-in for the control request that dies in production. Deferred by a
    // macrotask deliberately: the real SDK issues can_use_tool from its own reader
    // task, never synchronously inside `sdkIterator.next()`. Calling it inline here
    // would fire the adapter's user-input waker before its loop has armed it for
    // this iteration, and the run would hang — an artifact of the mock, not a bug.
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        const canUseTool = options.canUseTool as (
          toolName: string,
          input: Record<string, unknown>,
          ctx: { toolUseID: string },
        ) => Promise<unknown>;
        void canUseTool(
          'AskUserQuestion',
          {
            questions: [
              {
                question: 'A or B?',
                header: 'Pick',
                options: [{ label: 'A' }, { label: 'B' }],
              },
            ],
          },
          { toolUseID: 'toolu_test' },
        ).then(
          () => resolve(),
          () => resolve(),
        );
      });
    });

    yield resultMessage({ result: 'done', background_tasks: [] });
  };

  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  const adapter = new ClaudeCodeAdapter();
  const events = await collectEvents(
    adapter.execute(
      createTestParams({
        streamingInput: true,
        onUserInput: async (req) => {
          askRequests.push(req);
          return { action: 'accept', answers: [['A']] };
        },
      }),
    ),
    // Short: a channel-lifecycle deadlock should fail fast, not stall CI.
    15_000,
  );

  return { events, inputDoneAfterResult, pendingPull, askRequests };
}

describe('claude-code streaming input — background-task session hold', () => {
  // CHARACTERIZATION, not a defect assertion. This documents what the adapter does
  // today: it closes the channel at `result` even when the engine reports work still
  // in flight, and never reads `background_tasks`.
  //
  // Deliberately NOT written as "must stay open". Live e2e evidence (see the scenario
  // in src/testing/e2e/claude-code.e2e.test.ts) shows the streaming path survives this
  // early close on both @anthropic-ai/claude-agent-sdk 0.3.153 and 0.3.210 — the model
  // is still woken and can still ask. So the early close is a latent hazard, not a
  // proven cause of the reported `AbortError: Stream closed`, and asserting an
  // invariant the evidence does not support would be dishonest.
  //
  // If the fix in PLAN-streamingn-input-fix.md makes the keep-open condition read
  // `background_tasks`, this expectation flips to `false` and the comment goes with it.
  it('currently closes the input channel at `result` even with background work in flight', async () => {
    const { inputDoneAfterResult } = await runScenario({
      backgroundTasks: BACKGROUND_TASK_RUNNING,
      wakeAndAsk: true,
    });

    expect(
      inputDoneAfterResult,
      'adapter behaviour changed: the channel is no longer closed at `result` while ' +
        '`background_tasks` is non-empty — update this characterization test',
    ).toBe(true);
  });

  it('closes the input channel when no background work is in flight and no push is pending', async () => {
    const { inputDoneAfterResult, pendingPull, events } = await runScenario({
      backgroundTasks: [],
      wakeAndAsk: false,
    });

    // The one-shot contract: an empty channel is closed synchronously at `result`,
    // which is what makes a late pushMessage() return false. The fix must not widen
    // the keep-open condition beyond in-flight background work.
    expect(inputDoneAfterResult).toBe(true);
    await expect(pendingPull!).resolves.toMatchObject({ done: true });
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('services a post-wake-up AskUserQuestion through the user-input waker', async () => {
    // Green in both worlds — the mock calls canUseTool directly, bypassing the real
    // (closed) transport. This guards the loop's waker race: a control request that
    // arrives after a `task_notification` must still reach onUserInput.
    const { events, askRequests } = await runScenario({
      backgroundTasks: BACKGROUND_TASK_RUNNING,
      wakeAndAsk: true,
    });

    const requests = events.filter((e) => e.type === 'user_input_request');
    expect(requests).toHaveLength(1);
    expect(askRequests).toHaveLength(1);
    expect(askRequests[0].source).toBe('model-tool');
    expect(askRequests[0].questions[0].question).toBe('A or B?');

    // The wake-up itself is surfaced (today as subagent_completed — task_type is
    // dropped, tracked separately as a known gap in spec/adapters/A01-claude-code.md).
    expect(events.some((e) => e.type === 'subagent_completed')).toBe(true);
  });
});

// --- Abort / cut-off contract while a user-input request is outstanding ---

/**
 * A control request the host has not answered yet. Nothing about the run advances
 * until `onUserInput` resolves — which, for a real host, means a human replying over
 * an HTTP round-trip. So this is the state a session sits in whenever a question is
 * on screen, and `abort()` is the only lever the host has left.
 */
function askOnceScript(): Script {
  return async function* ({ prompt, options }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();

    // Deferred a macrotask so the adapter's loop has armed its waker (see the note
    // in runScenario).
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
          { toolUseID: 'toolu_abort' },
        ).then(
          () => resolve(),
          () => resolve(),
        );
      });
    });

    yield resultMessage();
  };
}

const PULL_TIMEOUT_MS = 2_000;
const HUNG = Symbol('hung');

/**
 * Pump the stream by hand rather than with `for await`, so a stall is a failed
 * assertion instead of a hung suite: `for await` owns the iterator and gives us no
 * way to walk away from a pull that never settles.
 *
 * `onEvent` runs for each event — that is where the test injects `abort()`.
 */
async function pumpUntilDone(
  stream: AsyncIterable<UnifiedEvent>,
  onEvent: (e: UnifiedEvent) => void,
): Promise<{ events: UnifiedEvent[]; terminated: boolean }> {
  const iterator = stream[Symbol.asyncIterator]();
  const events: UnifiedEvent[] = [];

  for (;;) {
    const pull = iterator.next();
    const winner = await Promise.race([
      pull,
      new Promise<typeof HUNG>((r) => setTimeout(() => r(HUNG), PULL_TIMEOUT_MS)),
    ]);

    if (winner === HUNG) {
      // Deliberately NOT awaited: the generator is parked on an `await`, not a
      // `yield`, so `return()` cannot run its `finally` until that await settles —
      // awaiting it here would reproduce the very hang we are reporting.
      void iterator.return?.();
      return { events, terminated: false };
    }
    if (winner.done) return { events, terminated: true };

    events.push(winner.value);
    onEvent(winner.value);
  }
}

describe('claude-code — abort while a user-input request is outstanding', () => {
  // KNOWN FAILING (`it.fails`) if the adapter cannot break out of a pending handler.
  //
  // The loop yields `user_input_request` and then does
  // `await effectiveUserInputHandler(pending.req)`. Nothing in that await watches
  // `abortController.signal`, and `abort()` only aborts the controller and closes the
  // input channel — neither settles the host's promise. A host whose handler resolves
  // on a human reply (the normal shape) therefore has no way to reclaim the session:
  // it stays parked forever, holding its adapter and its SDK subprocess.
  //
  // This is also the only hypothesis so far that explains "restarting the app fixed
  // it" — library logic does not heal on restart, but an in-memory session parked on
  // an unresolved promise does.
  it.fails('abort() terminates a run parked on an unanswered question', async () => {
    script = askOnceScript();
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const stream = adapter.execute(
      createTestParams({
        streamingInput: true,
        // Never resolves — a question put on screen that the user never answers.
        onUserInput: () => new Promise<never>(() => {}),
      }),
    );

    let sawRequest = false;
    const { events, terminated } = await pumpUntilDone(stream, (e) => {
      if (e.type === 'user_input_request') {
        sawRequest = true;
        adapter.abort();
      }
    });

    expect(sawRequest, 'the question should have surfaced before aborting').toBe(true);
    expect(
      terminated,
      'abort() must end a run parked on an unanswered user-input request — otherwise the ' +
        'host can never reclaim the session and both the adapter and its SDK subprocess leak',
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'error' && e.error instanceof AdapterAbortError),
      'aborting should surface AdapterAbortError',
    ).toBe(true);
  });

  it('a throwing onUserInput surfaces an error and the run still completes', async () => {
    script = askOnceScript();
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const events = await collectEvents(
      adapter.execute(
        createTestParams({
          streamingInput: true,
          onUserInput: async () => {
            throw new Error('handler exploded');
          },
        }),
      ),
      10_000,
    );

    // The adapter resolves the SDK-side promise with `cancel` so the engine is never
    // left waiting on a decision, reports the throw, and still reaches the result.
    expect(
      events.some((e) => e.type === 'error' && /handler exploded/.test(e.error.message)),
      'the handler throw should surface as an error event',
    ).toBe(true);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });
});
