// Unit tests for the extracted background-task machinery (M17): the task registry,
// the `result.backgroundTasks` projection, and the bounded control-channel hold.
//
// These drive the state machine DIRECTLY — no fake `query()`, no adapter. The
// through-the-adapter behaviour those same rules produce is pinned by
// claude-code.background-tasks.test.ts and claude-code.background-routing.test.ts;
// what this file buys is the ability to state a bound's rule as one assertion
// instead of a scripted run.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  createTaskRegistry,
  createBackgroundHold,
  projectBackgroundTasks,
  classifyTaskType,
  isMainModelActivity,
  isBackgroundProgress,
  BACKGROUND_WAKEUP_GRACE_MS,
  MAX_BACKGROUND_HOLD_MS,
} from './claude-code.background-hold.js';
import type { HoldExpiry } from './claude-code.background-hold.js';

function sdk(msg: Record<string, unknown>): SDKMessage {
  return msg as unknown as SDKMessage;
}

describe('classifyTaskType', () => {
  it('maps the SDK\'s locally-prefixed spellings onto the unified kind', () => {
    expect(classifyTaskType('local_bash')).toEqual({ taskType: 'shell', isBackground: true });
    expect(classifyTaskType('bash')).toEqual({ taskType: 'shell', isBackground: true });
    expect(classifyTaskType('local_workflow')).toEqual({ taskType: 'workflow', isBackground: true });
  });

  it('keeps anything it does not recognize on the subagent path', () => {
    // The degradation rule: an SDK that stops sending the discriminator, or starts
    // sending a kind we have never seen, must not have real subagents misrouted.
    expect(classifyTaskType(undefined)).toEqual({ taskType: 'subagent', isBackground: false });
    expect(classifyTaskType('quantum_task')).toEqual({ taskType: 'quantum_task', isBackground: false });
  });
});

describe('isMainModelActivity', () => {
  it('counts only the main model, never subagent chatter', () => {
    expect(isMainModelActivity(sdk({ type: 'assistant', parent_tool_use_id: null }))).toBe(true);
    // A helper agent talking after its parent's turn ended IS the held state.
    expect(isMainModelActivity(sdk({ type: 'assistant', parent_tool_use_id: 'toolu_1' }))).toBe(false);
  });

  it('excludes `result` — it ends a turn rather than showing one in progress', () => {
    expect(isMainModelActivity(sdk({ type: 'result', parent_tool_use_id: null }))).toBe(false);
    expect(isMainModelActivity(sdk({ type: 'system', subtype: 'task_progress' }))).toBe(false);
  });
});

describe('createTaskRegistry', () => {
  it('settles on the NOTIFICATION, and remembers the kind after settlement', () => {
    // The invariant the whole hold rests on: a task's tool_result lands at dispatch,
    // so only its notification may shrink the in-flight set.
    const r = createTaskRegistry();
    r.start('t1', 'local_bash', 'sleep 12');
    expect([...r.inFlight]).toEqual(['t1']);

    r.settle('t1');
    expect([...r.inFlight]).toEqual([]);
    // Still routable: a late message about a settled task must reach the right family.
    expect(r.kind('t1')?.taskType).toBe('shell');
    expect(r.touchedATask()).toBe(true);
  });

  it('stops claiming the engine will come back once a turn has passed on it', () => {
    // The latch this replaces was `kindById.size > 0`, and kindById is never pruned:
    // one subagent early in a run armed the hold at EVERY later `result` for the rest
    // of the run, which is what made the cap reachable in ordinary turns. The signal
    // has to survive the result that follows the settlement (that result is where the
    // engine's wake-up would be decided) and then decay.
    const r = createTaskRegistry();
    r.start('t1', 'subagent', 'research');
    r.settle('t1');

    expect(r.touchedATask(), 'the result right after a settlement still holds').toBe(true);
    r.markTurnBoundary();
    expect(r.touchedATask(), 'a later result must not inherit it').toBe(false);
    // The kind is still routable — pruning the latch must not prune the routing table.
    expect(r.kind('t1')?.taskType).toBe('subagent');
  });

  it('keeps claiming it while work is genuinely in flight, boundary or not', () => {
    const r = createTaskRegistry();
    r.start('t1', 'shell', 'sleep 3600');
    r.markTurnBoundary();
    expect(r.touchedATask()).toBe(true);
  });

  it('separates "still working" from "done, wake-up pending"', () => {
    const r = createTaskRegistry();
    r.start('t1', 'shell', 'x');
    expect(r.noWorkLeftRunning()).toBe(false);
    r.markFinished('t1');
    expect(r.noWorkLeftRunning()).toBe(true);
  });

  it('a run that started nothing has no work left running and touched no task', () => {
    const r = createTaskRegistry();
    expect(r.noWorkLeftRunning()).toBe(true);
    expect(r.touchedATask()).toBe(false);
  });
});

describe('projectBackgroundTasks', () => {
  it('reports in-flight background work and omits in-flight subagents', () => {
    const r = createTaskRegistry();
    r.start('bg-1', 'local_bash', 'sleep 12');
    r.start('sub-1', 'subagent', 'research');

    expect(projectBackgroundTasks(r, [])).toEqual([
      { taskId: 'bg-1', taskType: 'shell', description: 'sleep 12' },
    ]);
  });

  it("classifies the engine's friendly label rather than trusting it", () => {
    // BackgroundTaskSummary.type is a display string — literally 'subagent' for helper
    // agents on 0.3.210 — so it must go through the same mapping as the event families.
    const r = createTaskRegistry();
    expect(
      projectBackgroundTasks(r, [
        { id: 'e-1', type: 'local_bash', description: 'sleep 3600' },
        { id: 'e-2', type: 'subagent', description: 'research' },
      ]),
    ).toEqual([{ taskId: 'e-1', taskType: 'shell', description: 'sleep 3600' }]);
  });

  it('does not report the same task twice when both sources name it', () => {
    const r = createTaskRegistry();
    r.start('bg-1', 'shell', 'tracked');
    expect(projectBackgroundTasks(r, [{ id: 'bg-1', type: 'local_bash', description: 'reported' }])).toEqual([
      { taskId: 'bg-1', taskType: 'shell', description: 'tracked' },
    ]);
  });

  it('skips an engine entry with no usable id rather than shipping it malformed', () => {
    const r = createTaskRegistry();
    expect(projectBackgroundTasks(r, [{ type: 'shell', description: 'nameless' }])).toEqual([]);
  });
});

describe('isBackgroundProgress', () => {
  it('counts subagent output and task lifecycle frames', () => {
    expect(isBackgroundProgress(sdk({ type: 'assistant', parent_tool_use_id: 'toolu_1' }))).toBe(true);
    expect(isBackgroundProgress(sdk({ type: 'stream_event', parent_tool_use_id: 'toolu_1' }))).toBe(true);
    expect(isBackgroundProgress(sdk({ type: 'system', subtype: 'task_updated' }))).toBe(true);
    expect(isBackgroundProgress(sdk({ type: 'system', subtype: 'task_notification' }))).toBe(true);
  });

  it('does NOT count heartbeats — bounding a stalled run depends on it', () => {
    // `system/status` and `system/background_tasks_changed` are what the engine emits
    // while it babysits a backgrounded `sleep 3600`. If they extended the cap, the one
    // case the cap exists for would never end.
    expect(isBackgroundProgress(sdk({ type: 'system', subtype: 'status' }))).toBe(false);
    expect(isBackgroundProgress(sdk({ type: 'system', subtype: 'background_tasks_changed' }))).toBe(false);
    expect(isBackgroundProgress(sdk({ type: 'result', subtype: 'success' }))).toBe(false);
    // Main-model output is a RELEASE, handled by isMainModelActivity — not progress
    // on the held work.
    expect(isBackgroundProgress(sdk({ type: 'assistant', parent_tool_use_id: null }))).toBe(false);
  });
});

describe('createBackgroundHold', () => {
  let expiries: HoldExpiry[];
  let woken: number;

  function makeHold(overrides: { graceMs?: number | null; capMs?: number | null } = {}) {
    const registry = createTaskRegistry();
    const hold = createBackgroundHold({
      registry,
      onExpire: (reason) => void expiries.push(reason),
      wake: () => void woken++,
      ...overrides,
    });
    return { registry, hold };
  }

  beforeEach(() => {
    expiries = [];
    woken = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes silently on the grace window once everything has settled', () => {
    const { registry, hold } = makeHold();
    registry.start('t1', 'shell', 'x');
    registry.markFinished('t1');
    hold.begin();

    vi.advanceTimersByTime(BACKGROUND_WAKEUP_GRACE_MS + 1);
    // 'grace' is the caller's cue to close the channel — a healthy run's end, not a
    // truncation. The hold itself closes nothing either way.
    expect(expiries).toEqual(['grace']);
    expect(woken).toBe(1);
  });

  it('work still running is bounded by the cap, not the grace window', () => {
    const { registry, hold } = makeHold();
    registry.start('t1', 'shell', 'sleep 3600'); // never finishes
    hold.begin();

    vi.advanceTimersByTime(BACKGROUND_WAKEUP_GRACE_MS + 1);
    expect(expiries, 'the short window must not arm while work is genuinely running').toEqual([]);

    vi.advanceTimersByTime(MAX_BACKGROUND_HOLD_MS);
    // 'cap' is a different outcome from 'grace', not a louder one: the caller ends the
    // run, because the CLI is still alive and closing its stdin would leave a session
    // whose control channel is dead but whose model keeps talking.
    expect(expiries).toEqual(['cap']);
  });

  it('a heartbeat does not extend the cap', () => {
    // The bound must still catch a backgrounded `sleep 3600`, and the engine chatters
    // the whole time it babysits one.
    const { registry, hold } = makeHold();
    registry.start('t1', 'shell', 'sleep 3600');
    hold.begin();

    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(MAX_BACKGROUND_HOLD_MS / 4);
      hold.touch(sdk({ type: 'system', subtype: 'status' }));
    }
    vi.advanceTimersByTime(1);
    expect(expiries).toEqual(['cap']);
  });

  it('subagent output extends the cap for as long as the work keeps moving', () => {
    // THE REGRESSION THIS RELEASE EXISTS FOR. The cap used to be absolute, armed once
    // at the held `result`. A long subagent-driven stretch is precisely the shape that
    // reached it — and precisely the shape the release path cannot recognise either,
    // because subagent frames carry `parent_tool_use_id`. Healthy runs were cut off at
    // 90s for using a subagent.
    const { registry, hold } = makeHold();
    registry.start('t1', 'subagent', 'research'); // never settles: it is still working
    hold.begin();

    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(MAX_BACKGROUND_HOLD_MS - 1_000);
      hold.touch(sdk({ type: 'stream_event', parent_tool_use_id: 'toolu_1' }));
    }
    expect(expiries, 'work that is visibly moving must not be called stalled').toEqual([]);

    // ...and the moment it does stop moving, the bound still applies.
    vi.advanceTimersByTime(MAX_BACKGROUND_HOLD_MS + 1);
    expect(expiries).toEqual(['cap']);
  });

  it('a null bound is disarmed rather than reset to the default', () => {
    // The escape hatch consumers had no way to ask for: every non-positive value used
    // to be read as a typo and silently replaced by the default, so a bound that could
    // end their run could only ever be raised, never switched off.
    const { registry, hold } = makeHold({ capMs: null, graceMs: null });
    registry.start('t1', 'shell', 'sleep 3600');
    hold.begin();

    vi.advanceTimersByTime(MAX_BACKGROUND_HOLD_MS * 10);
    expect(expiries, 'timeoutMs/abort() are then the only bounds — by request').toEqual([]);
  });

  it('re-arms the grace window from every frame, so it measures silence', () => {
    const { registry, hold } = makeHold();
    registry.start('t1', 'shell', 'x');
    registry.markFinished('t1');
    hold.begin();

    // Two stray non-main-model frames — both real (`system/status`,
    // `system/background_tasks_changed`) — each pushing the deadline back.
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(BACKGROUND_WAKEUP_GRACE_MS - 1_000);
      hold.touch(sdk({ type: 'system', subtype: 'status' }));
    }
    expect(expiries, 'a talking engine is not a stuck one').toEqual([]);

    vi.advanceTimersByTime(BACKGROUND_WAKEUP_GRACE_MS + 1);
    expect(expiries).toEqual(['grace']);
  });

  it('releases BOTH bounds the moment the main model produces again', () => {
    // The regression this guards: an absolute cap armed at the held result and never
    // released killed a run the engine really did resume — closing the CLI's stdin
    // mid-turn and re-creating the very defect the hold exists to prevent.
    const { registry, hold } = makeHold();
    registry.start('t1', 'shell', 'x');
    hold.begin();

    hold.touch(sdk({ type: 'assistant', parent_tool_use_id: null }));
    vi.advanceTimersByTime(MAX_BACKGROUND_HOLD_MS * 3);

    expect(expiries, 'no bound may fire while a continuation turn is running').toEqual([]);
  });

  it('subagent chatter keeps the run parked instead of releasing it', () => {
    const { registry, hold } = makeHold();
    registry.start('t1', 'subagent', 'research');
    registry.markFinished('t1');
    hold.begin();

    hold.touch(sdk({ type: 'assistant', parent_tool_use_id: 'toolu_1' }));
    vi.advanceTimersByTime(BACKGROUND_WAKEUP_GRACE_MS + 1);

    expect(expiries, 'a helper talking after its parent turn ended is the held state').toEqual(['grace']);
  });

  it('end() and dispose() leave no timer able to close the channel later', () => {
    const { registry, hold } = makeHold();
    registry.start('t1', 'shell', 'x');
    hold.begin();
    hold.end();
    hold.dispose();

    vi.advanceTimersByTime(MAX_BACKGROUND_HOLD_MS * 2);
    expect(expiries).toEqual([]);
  });

  it('honours caller-supplied bounds', () => {
    const { registry, hold } = makeHold({ graceMs: 2_000, capMs: 8_000 });
    registry.start('t1', 'shell', 'x');
    registry.markFinished('t1');
    hold.begin();

    vi.advanceTimersByTime(2_001);
    expect(expiries).toEqual(['grace']);
  });
});

describe('the hold cap and the collectEvents default timeout', () => {
  it('leaves room for the terminal error to reach the consumer', async () => {
    // Both clocks race, and collectEvents' starts EARLIER (when the run starts, not
    // when the hold arms at a held result). An equal cap means the helper rejects the
    // run before the cap's AdapterBackgroundHoldExpiredError can be yielded — losing
    // the only signal there is. This is a coupling, so it is asserted rather than
    // commented.
    const { COLLECT_EVENTS_DEFAULT_TIMEOUT_MS } = await import('../utils.js');
    expect(MAX_BACKGROUND_HOLD_MS).toBeLessThan(COLLECT_EVENTS_DEFAULT_TIMEOUT_MS);
  });
});
