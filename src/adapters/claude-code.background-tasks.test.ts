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
// The adapter used to close the channel on the first `result` unless a
// `pushMessage()` was pending (src/adapters/claude-code.ts, `case 'result'`). It now
// also holds it while it tracks unsettled `task_*` ids — bounded by a post-settlement
// grace window and a hard cap, both pinned below.
//
// Scope note — read before trusting this file. A mocked `query()` has no real stdin, so
// nothing here can reproduce a closed transport: `canUseTool` is invoked directly and
// always resolves. What this file pins is the adapter's channel LIFECYCLE. The
// user-visible symptom (`Tool permission request failed: … Stream closed`, reproduced
// on every work shape and both prompt paths) is owned by the live e2e scenario in
// src/testing/e2e/claude-code.e2e.test.ts.
//
// See spec/modules/M17-background-tasks.md (the invariants) and spec/adapters/A01-claude-code.md
// (the measurements the bounds are sized from).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { BACKGROUND_WAKEUP_GRACE_MS, MAX_BACKGROUND_HOLD_MS } from './claude-code.js';
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
  /**
   * Emit the `task_started` that registers `bg-1` as in flight. This — not the
   * `background_tasks` list on `result`, which the pinned SDK does not send — is
   * what the adapter tracks; the list is carried alongside so a future SDK that
   * does send it stays covered.
   */
  startTask?: boolean;
}): Promise<ScenarioResult> {
  let inputDoneAfterResult: boolean | null = null;
  let pendingPull: Promise<IteratorResult<unknown>> | null = null;
  const askRequests: UserInputRequest[] = [];

  script = async function* ({ prompt, options }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next(); // the seeded prompt message

    if (opts.startTask) {
      yield {
        type: 'system',
        subtype: 'task_started',
        task_id: 'bg-1',
        task_type: 'shell',
        description: 'sleep 12',
      } as unknown as SDKMessage;
    }

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
  // THE invariant (M17). In production this pull is the SDK's own read of our
  // iterable and `done` means `stdin.end()` on the CLI process — which also ends
  // the control protocol multiplexed onto that stdin, so the woken model's
  // AskUserQuestion is denied inside the CLI with nothing but a `Stream closed`
  // tool result to show for it. Live evidence recorded in spec/adapters/A01-claude-code.md.
  it('keeps the input channel open at `result` while background work is in flight', async () => {
    const { inputDoneAfterResult } = await runScenario({
      backgroundTasks: BACKGROUND_TASK_RUNNING,
      wakeAndAsk: true,
      startTask: true,
    });

    expect(
      inputDoneAfterResult,
      'the channel must outlive a `result` that still has background work in flight — ' +
        'closing it kills the engine\'s control transport while the session is alive',
    ).toBe(false);
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
      startTask: true,
    });

    const requests = events.filter((e) => e.type === 'user_input_request');
    expect(requests).toHaveLength(1);
    expect(askRequests).toHaveLength(1);
    expect(askRequests[0].source).toBe('model-tool');
    expect(askRequests[0].questions[0].question).toBe('A or B?');

    // The wake-up is surfaced on the background-task family, not as a subagent
    // (routed by `task_type` — M17).
    expect(events.some((e) => e.type === 'background_task_completed')).toBe(true);
    expect(events.some((e) => e.type === 'subagent_completed')).toBe(false);
  });
});

// --- Subagents settle on their tool_result, background work on its notification ---

/**
 * A Task subagent, optionally reporting back inside the turn. Both shapes are real:
 * a subagent that finishes in-turn returns through its `tool_result` and never emits
 * `task_notification`, while one that outlives the turn settles the other way. The
 * adapter has to hold for the second without holding forever on the first.
 */
function subagentScript(opts: { finishBeforeResult: boolean }): Script {
  return async function* ({ prompt }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();

    yield {
      type: 'system',
      subtype: 'task_started',
      task_id: 'sub-1',
      task_type: 'local_agent',
      tool_use_id: 'toolu_task',
      description: 'review the diff',
    } as unknown as SDKMessage;

    // The Agent tool's own tool_result lands at DISPATCH, not at completion — the
    // subagent runs on afterwards. Included because it must NOT be read as a settle.
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'launched' }],
      },
    } as unknown as SDKMessage;

    if (opts.finishBeforeResult) {
      yield {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'sub-1',
        patch: { status: 'completed', end_time: 1 },
      } as unknown as SDKMessage;
    }

    yield resultMessage();

    const pull = input.next();
    if (!opts.finishBeforeResult) {
      // Settles late, then wakes the model — the shape the bug report showed.
      yield {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'sub-1',
        status: 'completed',
      } as unknown as SDKMessage;
      yield resultMessage();
    }
    await pull;
  };
}

describe('claude-code — subagent tasks and the hold', () => {
  // Fake timers: the run ends on the wake-up grace, and burning that in real time
  // would put BACKGROUND_WAKEUP_GRACE_MS of dead wall-clock into every CI run.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a subagent still outstanding at `result` holds the channel until it settles', async () => {
    script = subagentScript({ finishBeforeResult: false });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events = await drainWithClock(
      new ClaudeCodeAdapter().execute(createTestParams({ streamingInput: true })),
    );

    // A subagent is not background work: it holds the session (that is the hold's
    // job) but never appears on this signal, whose documented meaning is
    // "engine-backgrounded side work, never a subagent" (M17, types.ts).
    const first = events.find((e) => e.type === 'result');
    expect(first && 'backgroundTasks' in first ? first.backgroundTasks : undefined).toBeUndefined();
    // The continuation turn ran, which is only possible if the channel stayed open.
    expect(events.filter((e) => e.type === 'result')).toHaveLength(2);
    expect(events.some((e) => e.type === 'subagent_completed')).toBe(true);
  });
});

// --- The hold is bounded ---

/**
 * Hold the channel for one backgrounded task, then go quiet: either the task
 * settles and the engine never wakes the model (`settle: true` → the grace
 * window decides), or it never settles at all (`settle: false` → the hard cap
 * decides). Both are the shapes that would otherwise turn the hold into a hang.
 */
function holdThenGoQuietScript(opts: { settle: boolean }): Script {
  return async function* ({ prompt }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();

    yield {
      type: 'system',
      subtype: 'task_started',
      task_id: 'bg-1',
      task_type: 'shell',
      description: 'sleep 3600',
    } as unknown as SDKMessage;
    yield resultMessage();

    // The SDK's read of our iterable. Stays pending while the adapter holds the
    // channel; resolves `done` the moment a bound expires and it closes — which
    // is `stdin.end()` in production, and ends this generator exactly as the real
    // SDK's `for await` would.
    const pull = input.next();

    if (opts.settle) {
      yield {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'bg-1',
        status: 'completed',
      } as unknown as SDKMessage;
    }

    await pull;
  };
}

/**
 * Drain under fake timers. Two reasons this is hand-rolled: `collectEvents` arms
 * its own `setTimeout`, which the fake clock would trip; and the clock may only
 * be advanced once the run is actually parked on a hold timer — advancing it up
 * front (before `execute()` has even imported the SDK) fires nothing and the run
 * then waits forever on a timer armed after the advance. So: pull, let the run
 * progress on its own, and only push the clock while the pull is still pending.
 */
async function drainWithClock(
  stream: AsyncIterable<UnifiedEvent>,
  ceilingMs = MAX_BACKGROUND_HOLD_MS + BACKGROUND_WAKEUP_GRACE_MS + 5_000,
): Promise<UnifiedEvent[]> {
  const STEP_MS = 1_000;
  const CEILING_MS = ceilingMs;
  const iterator = stream[Symbol.asyncIterator]();
  const events: UnifiedEvent[] = [];

  for (;;) {
    let settled = false;
    const pull = iterator.next().then((r) => {
      settled = true;
      return r;
    });
    for (let waited = 0; !settled && waited <= CEILING_MS; waited += STEP_MS) {
      await vi.advanceTimersByTimeAsync(STEP_MS);
    }
    const next = await pull;
    if (next.done) return events;
    events.push(next.value);
  }
}

/**
 * `drainWithClock` plus the one thing the bound-configuration tests need: HOW MUCH
 * virtual time the run actually consumed. Without it "the tail got shorter" can only
 * be tested by letting the run hang past a tight ceiling, which fails as a timeout
 * rather than as an assertion.
 */
async function drainMeasuringClock(
  stream: AsyncIterable<UnifiedEvent>,
): Promise<{ events: UnifiedEvent[]; advancedMs: number }> {
  const STEP_MS = 500;
  const CEILING_MS = MAX_BACKGROUND_HOLD_MS + BACKGROUND_WAKEUP_GRACE_MS + 5_000;
  const iterator = stream[Symbol.asyncIterator]();
  const events: UnifiedEvent[] = [];
  let advancedMs = 0;

  for (;;) {
    let settled = false;
    const pull = iterator.next().then((r) => {
      settled = true;
      return r;
    });
    for (let waited = 0; !settled && waited <= CEILING_MS; waited += STEP_MS) {
      await vi.advanceTimersByTimeAsync(STEP_MS);
      if (!settled) advancedMs += STEP_MS;
    }
    const next = await pull;
    if (next.done) return { events, advancedMs };
    events.push(next.value);
  }
}

describe('claude-code — the background-task hold is bounded', () => {
  beforeEach(() => {
    // Only timers: the harness leans on real setImmediate for its macrotask
    // deferrals, and faking those would deadlock the mock rather than test it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // THE F1 REGRESSION. Settled work plus a quiet engine is how a healthy
  // task-touching run ENDS — it is where the pre-hold code closed the channel, at
  // `result`. Warning there told every such run that its work "did not run", which
  // is both false and alarming: a data-loss banner on the happy path.
  it('ends silently when the settled task never wakes the model', async () => {
    script = holdThenGoQuietScript({ settle: true });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const events = await drainWithClock(adapter.execute(createTestParams({ streamingInput: true })));

    expect(
      events.filter((e) => e.type === 'warning'),
      'settled work + a quiet engine is the normal end of the run, not a truncation',
    ).toEqual([]);
    expect(events.some((e) => e.type === 'background_task_completed')).toBe(true);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('closes the hold at the hard cap when the task never settles', async () => {
    script = holdThenGoQuietScript({ settle: false });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    // Nothing settles, so the grace window never arms — only the cap can end this.
    const events = await drainWithClock(adapter.execute(createTestParams({ streamingInput: true })));

    expect(
      events.find((e) => e.type === 'warning' && /still in flight after/.test(e.message)),
      'a task that never settles must hit the cap and say so',
    ).toBeDefined();
  });

  it('reports in-flight work on the held result so consumers know it is not terminal', async () => {
    script = holdThenGoQuietScript({ settle: false });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const events = await drainWithClock(adapter.execute(createTestParams({ streamingInput: true })));

    const result = events.find((e) => e.type === 'result');
    expect(result && 'backgroundTasks' in result ? result.backgroundTasks : undefined).toEqual([
      { taskId: 'bg-1', taskType: 'shell', description: 'sleep 3600' },
    ]);
  });

  it('a subagent that finished before the result ends on the short window, silently', async () => {
    // The common subagent shape: the helpers report themselves done (`task_updated`)
    // before the turn's result, and the engine then either wakes the model at once or
    // never. Waiting out the two-minute cap for that is dead time on every such run —
    // which is exactly what a first cut of this fix did. Ending on the short window is
    // the whole point, and no warning belongs on a run where nothing went wrong.
    script = subagentScript({ finishBeforeResult: true });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const events = await drainWithClock(adapter.execute(createTestParams({ streamingInput: true })));

    // The cap is the only bound that speaks; silence therefore proves the short one won.
    expect(events.filter((e) => e.type === 'warning')).toEqual([]);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  // THE F2 REGRESSION. The cap used to be armed once at the first held `result` and
  // never released, so an engine that DID take the wake-up got cut off two minutes
  // later mid-turn — closing the CLI's stdin, and with it the control protocol
  // multiplexed onto it. That is the `Stream closed` defect this release exists to
  // fix, re-created by its own safety net.
  it('never truncates a resumed run that stays busy past the hard cap', async () => {
    const BEAT_MS = 20_000;
    const BEATS = 8; // 160s of continuation turn — well past MAX_BACKGROUND_HOLD_MS
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();

      yield {
        type: 'system',
        subtype: 'task_started',
        task_id: 'bg-1',
        task_type: 'shell',
        description: 'sleep 200',
      } as unknown as SDKMessage;
      yield resultMessage();

      const pull = input.next();
      // The engine takes the wake-up and works, unhurriedly. Each beat is a real
      // `setTimeout` under the fake clock, so this is 160 simulated seconds of a
      // live turn — the exact stretch the old cap fired in the middle of.
      for (let i = 0; i < BEATS; i += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, BEAT_MS));
        yield {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: `beat ${i}` }] },
        } as unknown as SDKMessage;
      }

      yield {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'bg-1',
        patch: { status: 'completed', end_time: 1 },
      } as unknown as SDKMessage;
      yield resultMessage({ result: 'done' });
      await pull;
    };

    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events = await drainWithClock(
      new ClaudeCodeAdapter().execute(createTestParams({ streamingInput: true })),
      BEAT_MS * BEATS + MAX_BACKGROUND_HOLD_MS + BACKGROUND_WAKEUP_GRACE_MS + 5_000,
    );

    expect(
      events.filter((e) => e.type === 'assistant_message'),
      'every beat of the continuation turn must survive — a bound firing mid-turn ' +
        'closes the control transport, which is the defect this release fixes',
    ).toHaveLength(BEATS);
    expect(events.filter((e) => e.type === 'result')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'warning')).toEqual([]);
  });

  // F4. Every SDK message used to DISARM the grace while only `task_*` events re-armed
  // it, so a single unrelated frame left the short bound gone and the run waiting out
  // the two-minute cap instead. Both frames below are real: the engine emits
  // `system/status` and `system/background_tasks_changed` while it babysits work.
  it('a stray non-task frame during a settled hold still ends on the short window', async () => {
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();

      yield {
        type: 'system',
        subtype: 'task_started',
        task_id: 'bg-1',
        task_type: 'shell',
        description: 'sleep 3',
      } as unknown as SDKMessage;
      yield {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'bg-1',
        status: 'completed',
      } as unknown as SDKMessage;
      yield resultMessage();

      const pull = input.next();
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      yield { type: 'system', subtype: 'background_tasks_changed' } as unknown as SDKMessage;
      await pull;
    };

    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events = await drainWithClock(
      new ClaudeCodeAdapter().execute(createTestParams({ streamingInput: true })),
    );

    // Silence proves it: the cap is the only bound that emits a warning.
    expect(
      events.filter((e) => e.type === 'warning'),
      'a stray frame must RE-ARM the short bound, not disarm it and fall through to the cap',
    ).toEqual([]);
  });

  it('abort() releases a held run without waiting for the bounds', async () => {
    script = holdThenGoQuietScript({ settle: false });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const stream = adapter.execute(createTestParams({ streamingInput: true }));
    const events: UnifiedEvent[] = [];
    for await (const e of stream) {
      events.push(e);
      if (e.type === 'result') adapter.abort();
    }

    expect(events.some((e) => e.type === 'error' && e.error instanceof AdapterAbortError)).toBe(true);
    expect(events.some((e) => e.type === 'warning' && /in flight after/.test(e.message))).toBe(false);
  });

  // The bounds are sized off measurements of ONE engine (see A01), and the grace is
  // paid as dead time at the end of EVERY task-touching run — including one whose
  // subagents all finished in-turn. A consumer on a tighter wall-clock budget has to
  // be able to buy that tail back, so both bounds are `architectureConfig` levers.
  it('claude_backgroundGraceMs shortens the tail a task-touching run pays', async () => {
    script = holdThenGoQuietScript({ settle: true });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const { events, advancedMs } = await drainMeasuringClock(
      adapter.execute(
        createTestParams({ streamingInput: true, architectureConfig: { claude_backgroundGraceMs: 1_000 } }),
      ),
    );

    expect(events.some((e) => e.type === 'result')).toBe(true);
    expect(advancedMs, 'the run must end on the configured window, not the 15s default').toBeLessThan(
      BACKGROUND_WAKEUP_GRACE_MS,
    );
  });

  it('falls back to the measured default when the lever is given a nonsense value', async () => {
    // A `0` or a negative would disarm a bound whose whole job is keeping the control
    // channel open, so a bad value must degrade to the default, never to "no bound".
    script = holdThenGoQuietScript({ settle: true });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const { events, advancedMs } = await drainMeasuringClock(
      adapter.execute(
        createTestParams({ streamingInput: true, architectureConfig: { claude_backgroundGraceMs: 0 } }),
      ),
    );

    expect(events.some((e) => e.type === 'result')).toBe(true);
    expect(advancedMs).toBeGreaterThanOrEqual(BACKGROUND_WAKEUP_GRACE_MS);
  });

  it('claude_backgroundHoldCapMs bounds work that never settles', async () => {
    script = holdThenGoQuietScript({ settle: false });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();

    const { events, advancedMs } = await drainMeasuringClock(
      adapter.execute(
        createTestParams({ streamingInput: true, architectureConfig: { claude_backgroundHoldCapMs: 6_000 } }),
      ),
    );

    expect(events.find((e) => e.type === 'warning' && /still in flight after 6000ms/.test(e.message))).toBeDefined();
    expect(advancedMs).toBeLessThan(MAX_BACKGROUND_HOLD_MS);
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
  // Was `it.fails` while the loop awaited the consumer's handler bare: nothing in
  // that await watched `abortController.signal`, and `abort()` only aborts the
  // controller and closes the input channel — neither settles the host's promise.
  // A host whose handler resolves on a human reply (the normal shape) had no way
  // to reclaim the session; it stayed parked forever, holding its adapter and its
  // SDK subprocess. That is also the one hypothesis that explains a symptom
  // healing on app restart. The handler is now raced against the abort signal
  // (M13), so this is a plain assertion.
  it('abort() terminates a run parked on an unanswered question', async () => {
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
