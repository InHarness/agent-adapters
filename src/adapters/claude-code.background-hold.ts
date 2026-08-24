// Claude Code adapter — background-task tracking and the control-channel hold (M17).
//
// Extracted from `claude-code.ts` because it is a self-contained state machine, not
// a step of the run: the adapter's main loop only feeds it SDK messages and reads
// two decisions back ("is the channel still held?", "what should be reported on this
// `result`?"). Keeping it here means the bounds can be tested by driving the machine
// directly instead of scripting a whole fake `query()`.
//
// WHY A HOLD EXISTS AT ALL. The CLI is spawned with `--permission-prompt-tool stdio`,
// so its permission/control protocol is multiplexed onto the SAME stdin the prompt
// channel feeds. The engine keeps the session alive past a turn's `result` while
// background work is in flight and then wakes the model — if the adapter has already
// ended its input iterable, the SDK has called `transport.endInput()` and the woken
// model's `AskUserQuestion` is denied inside the CLI in ~4ms, with no host round-trip
// ("Tool permission request failed: AbortError: Stream closed"). See
// spec/modules/M17-background-tasks.md and spec/adapters/A01-claude-code.md.

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BackgroundTaskType, BackgroundTaskRef } from '../types.js';

// --- Task kinds ---

/**
 * SDK `task_type` values that mean *engine-backgrounded side work* rather than a
 * spawned helper agent, mapped onto the unified {@link BackgroundTaskType}.
 * Anything absent from this table — including an absent `task_type` — keeps the
 * `subagent_*` path, so an SDK that stops sending the discriminator degrades to
 * the pre-M17 shape instead of misrouting real subagents.
 */
const BACKGROUND_TASK_TYPES: Record<string, BackgroundTaskType> = {
  bash: 'shell',
  shell: 'shell',
  monitor: 'monitor',
  workflow: 'workflow',
};

/** What `task_started` told us about a task, kept for every later message about it. */
export interface TaskKind {
  taskType: BackgroundTaskType;
  isBackground: boolean;
  description: string;
}

/**
 * Observed live on 0.3.153: a `run_in_background` Bash command reports
 * `task_type: 'local_bash'` — the SDK prefixes locally-executed kinds with
 * `local_` (`local_workflow` is documented alongside `workflow_name`). The
 * prefix is stripped before lookup so both spellings land on the same unified
 * kind.
 */
export function classifyTaskType(raw: unknown): { taskType: BackgroundTaskType; isBackground: boolean } {
  const key = typeof raw === 'string' ? raw : '';
  const mapped = BACKGROUND_TASK_TYPES[key] ?? BACKGROUND_TASK_TYPES[key.replace(/^local_/, '')];
  if (mapped) return { taskType: mapped, isBackground: true };
  return { taskType: key || 'subagent', isBackground: false };
}

/**
 * Is this message the MAIN model producing again? Used while the session is held
 * open: it is the difference between "the engine took the wake-up and a turn is
 * running" and "still parked". Subagent traffic (`parent_tool_use_id` set) does not
 * count — a helper agent talking after its parent's turn has ended is what the held
 * state looks like, not a resumption of it. `result` is excluded deliberately: it
 * ends a turn rather than showing one in progress, and has its own handling.
 */
export function isMainModelActivity(event: SDKMessage): boolean {
  if (
    event.type !== 'assistant' &&
    event.type !== 'stream_event' &&
    event.type !== 'user' &&
    event.type !== 'tool_use_summary'
  ) {
    return false;
  }
  return ((event as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null) === null;
}

/**
 * `system` subtypes that carry a task's own lifecycle. Anything else the engine
 * publishes on that channel (`status`, `background_tasks_changed`, …) is a
 * heartbeat: it says the engine is alive, not that the work is moving.
 */
const TASK_LIFECYCLE_SUBTYPES = new Set(['task_started', 'task_updated', 'task_notification']);

/**
 * Is this message evidence that the HELD work is still moving? The cap is re-armed
 * from it, so the question is deliberately narrower than "did a frame arrive".
 *
 * Two shapes qualify, and only two:
 *
 *  - subagent content (`parent_tool_use_id` set) — a helper agent producing tokens
 *    is the single commonest reason a run legitimately stays parked for minutes.
 *    Before this, such a stretch was exactly what reached the cap, because the
 *    release path ({@link isMainModelActivity}) cannot recognise it either.
 *  - a task's own lifecycle frame (`task_started` / `task_updated` /
 *    `task_notification`).
 *
 * Everything else is false ON PURPOSE — above all `system/status` and
 * `system/background_tasks_changed`. The engine emits those while it babysits a
 * backgrounded `sleep 3600`, and bounding that case is the cap's whole job: if
 * heartbeats re-armed it, nothing would.
 */
export function isBackgroundProgress(event: SDKMessage): boolean {
  if (event.type === 'system') {
    return TASK_LIFECYCLE_SUBTYPES.has((event as { subtype?: string }).subtype ?? '');
  }
  if (
    event.type !== 'assistant' &&
    event.type !== 'stream_event' &&
    event.type !== 'user' &&
    event.type !== 'tool_use_summary'
  ) {
    return false;
  }
  return ((event as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null) !== null;
}

// --- Task registry ---

/**
 * The three collections that always move together, behind the one invariant that
 * is easy to get wrong: SETTLEMENT IS THE NOTIFICATION, NEVER THE `tool_result`.
 * The Agent tool and a `run_in_background` Bash call both return their tool_result
 * at *dispatch* while the work runs on — observed live, three Agent tool_results
 * landing within one second and their notifications 7–19 seconds later, each one
 * waking the model for another turn.
 */
export interface TaskRegistry {
  /** Register a `task_started`; returns the kind captured for it. */
  start(taskId: string, rawTaskType: unknown, description: string): TaskKind;
  /**
   * The kind captured at `task_started`, or `undefined` for an id we never saw
   * start. Entries are never removed: a notification arriving after settlement
   * must still route to the right event family.
   */
  kind(taskId: string): TaskKind | undefined;
  /**
   * The engine's own "this task finished" patch (`task_updated`), which arrives
   * BEFORE the corresponding notification. Distinguishes "still working" from
   * "done, wake-up pending", and so which hold bound applies.
   */
  markFinished(taskId: string): void;
  /** The task's `task_notification` landed — it is fully settled. */
  settle(taskId: string): void;
  /** Ids started but not yet settled by their `task_notification`. */
  readonly inFlight: ReadonlySet<string>;
  /**
   * True when nothing tracked is still executing: every in-flight task has already
   * reported itself finished, so the only thing that can still arrive is a wake-up.
   */
  noWorkLeftRunning(): boolean;
  /**
   * Is there a reason to expect the engine to come back? Deliberately coarse:
   * nothing-in-flight is not the same as nothing-coming (observed on 0.3.210 —
   * three subagents all reported completion INSIDE the turn and the engine still
   * resumed the model for three further turns). So it answers YES for work still
   * in flight AND for work that settled since the last turn boundary.
   *
   * What it deliberately does NOT do any more is latch for the whole run. It used
   * to be `kindById.size > 0`, and `kindById` is never pruned — one subagent early
   * in a run therefore armed the hold at EVERY subsequent `result`, long after that
   * subagent was done. That is what made the cap reachable in otherwise ordinary
   * turns, so the signal decays instead (see {@link markTurnBoundary}).
   */
  touchedATask(): boolean;
  /**
   * A turn ended and the hold has already decided on it: forget settlements that
   * belong to it, so the next `result` is answered by what happened since, not by
   * the whole run's history.
   */
  markTurnBoundary(): void;
}

export function createTaskRegistry(): TaskRegistry {
  const kindById = new Map<string, TaskKind>();
  const inFlight = new Set<string>();
  const finished = new Set<string>();
  /**
   * Ids settled since the last turn boundary. The decaying half of
   * {@link TaskRegistry.touchedATask} — `kindById` cannot serve that purpose
   * because entries there must survive forever to route late notifications.
   */
  const settledSinceBoundary = new Set<string>();

  return {
    start(taskId, rawTaskType, description) {
      const kind: TaskKind = { ...classifyTaskType(rawTaskType), description };
      kindById.set(taskId, kind);
      // Both kinds can hold the session past the turn's `result` — three subagents
      // settling one by one, each waking the model, is exactly the shape the
      // consumer reported — so both are tracked.
      inFlight.add(taskId);
      return kind;
    },
    kind: (taskId) => kindById.get(taskId),
    markFinished: (taskId) => void finished.add(taskId),
    settle(taskId) {
      inFlight.delete(taskId);
      finished.delete(taskId);
      // A settlement is the engine's own wake-up trigger, so it is precisely the
      // thing that makes "the engine may come back" true for the NEXT result.
      settledSinceBoundary.add(taskId);
    },
    inFlight,
    noWorkLeftRunning: () => [...inFlight].every((id) => finished.has(id)),
    touchedATask: () => inFlight.size > 0 || settledSinceBoundary.size > 0,
    markTurnBoundary: () => settledSinceBoundary.clear(),
  };
}

// --- The `result.backgroundTasks` projection ---

/**
 * What a `result` reports as still in flight. BACKGROUND WORK ONLY — never a
 * subagent: `types.ts` and M17 are explicit about it, and the field's documented
 * meaning is "this result is not end-of-run", so listing a subagent would promise a
 * `background_task_completed` that never arrives. Subagents still hold the session
 * open — holding and reporting are separate decisions.
 *
 * `engineReported` is the engine's own list, from whichever place the SDK publishes
 * it: the Stop hook today, `result.background_tasks` if a future SDK adds it there.
 * Its `type` is a FRIENDLY LABEL, not the `task_type` discriminant — it is literally
 * `'subagent'` for helper agents (sdk.d.ts `BackgroundTaskSummary`, measured on
 * 0.3.210) — so it goes through the same classifier rather than being trusted.
 */
export function projectBackgroundTasks(
  registry: TaskRegistry,
  engineReported: Record<string, unknown>[],
): BackgroundTaskRef[] {
  const tracked: BackgroundTaskRef[] = [];
  const seenIds = new Set<string>();
  for (const id of registry.inFlight) {
    const kind = registry.kind(id);
    if (kind?.isBackground !== true) continue;
    seenIds.add(id);
    tracked.push({
      taskId: id,
      taskType: kind.taskType,
      ...(kind.description ? { description: kind.description } : {}),
    });
  }

  const fromEngine: BackgroundTaskRef[] = [];
  for (const t of engineReported) {
    if (typeof t?.id !== 'string' || seenIds.has(t.id)) continue;
    const kind = classifyTaskType(
      // Prefer the tracked discriminant when we have one; the label is a fallback
      // for work that never produced a `task_started` we saw.
      registry.kind(t.id)?.taskType ?? (typeof t.type === 'string' ? t.type : undefined),
    );
    if (!kind.isBackground) continue;
    seenIds.add(t.id);
    fromEngine.push({
      taskId: t.id,
      taskType: kind.taskType,
      ...(typeof t.description === 'string' ? { description: t.description } : {}),
    });
  }

  return [...tracked, ...fromEngine];
}

// --- The hold ---

/**
 * How long the adapter keeps the input/control channel open once everything it
 * tracks has settled, waiting for the engine to resume the model.
 *
 * SIZED FROM MEASUREMENT, not from taste. What it has to cover is the wall-clock
 * gap between the last task settling and the first frame of the continuation turn —
 * the engine has to post the whole conversation and wait for the model's first
 * token. Measured (A01): 3.5s and 3.7s on 0.3.210 with `includePartialMessages`,
 * 5.0s on 0.3.153 without. A 5s window therefore had no margin at all: expiry
 * mid-wake-up closes the control transport, which is the exact defect this module
 * exists to prevent. 15s is ~4× the worst observed.
 *
 * The cost is bounded dead time at the END of a run that touched a task — paid
 * after the consumer already has its `result`, and only until the generator
 * reaches `done`. Expiry is silent: it is where a run whose work is finished ends,
 * not a truncation. Consumers who cannot afford the tail lower it with
 * `claude_backgroundGraceMs`.
 */
export const BACKGROUND_WAKEUP_GRACE_MS = 15_000;

/**
 * Cap on the hold, measured from the last sign that the HELD WORK IS MOVING — not
 * from the start of the parked stretch, and not from the engine's last frame of any
 * kind. Bounds the case the grace window cannot see: work that never settles at all
 * (a backgrounded `sleep 3600`). Without it, holding the channel would hand this
 * run's lifetime to the engine indefinitely.
 *
 * WHY PROGRESS AND NOT WALL-CLOCK. It used to be absolute, armed once at `begin()`.
 * A long subagent-driven stretch is exactly the shape that then reached it — and
 * exactly the shape the release path cannot recognise either, because subagent
 * traffic carries `parent_tool_use_id` and so fails {@link isMainModelActivity}. A
 * healthy run was therefore cut off for the crime of using a subagent for more than
 * 90 seconds. Re-arming from {@link isBackgroundProgress} keeps such a run alive
 * while still ending a stalled one, because heartbeats deliberately do not count.
 *
 * WHAT EXPIRY MEANS. It ends the run, through the same path `abort()` uses, with a
 * typed `AdapterBackgroundHoldExpiredError`. It must NEVER be "close the input
 * channel and carry on": that channel is the only host→CLI control transport (MCP,
 * `canUseTool`, hooks, elicitation all ride it), so closing it under a live CLI
 * leaves a half-dead session that keeps producing plausible output with four
 * capabilities silently gone. See the M17 notes and A01.
 *
 * DELIBERATELY BELOW `collectEvents()`'s 120s default (src/utils.ts). The two clocks
 * race: `collectEvents` starts its timer when the run starts, the cap only arms at
 * the first held `result`, so an equal cap could never surface its terminal error
 * before the helper rejected the whole run — losing the only signal a consumer can
 * act on. Raise it with `claude_backgroundHoldCapMs` (and the helper's own
 * `timeoutMs` alongside) when a consumer genuinely waits longer, or disarm it with
 * `null` and let `timeoutMs` be the only bound.
 */
export const MAX_BACKGROUND_HOLD_MS = 90_000;

/**
 * Which bound ran out — the ONLY thing the hold decides. What that should do to the
 * session is the adapter's call, deliberately: the two outcomes are not variations
 * of one action, they are opposites.
 *
 *  - `'grace'` — settled work, quiet engine. The ordinary end of a task-touching
 *    run; the channel closes exactly where the pre-hold code closed it, at `result`.
 *  - `'cap'` — work that is not moving. The session is still LIVE, so the channel
 *    must not simply be closed under it; the run has to end.
 */
export type HoldExpiry = 'grace' | 'cap';

export interface BackgroundHold {
  /** Enter the hold at a `result` the engine is expected to resume from. */
  begin(): void;
  /** Leave the hold without closing anything (a continuation turn owns the channel now). */
  end(): void;
  /** An SDK message arrived: re-decide which bound applies, if any. */
  touch(event: SDKMessage): void;
  /** Stop every timer (teardown). Does not close the channel. */
  dispose(): void;
}

/**
 * The bounded control-channel hold.
 *
 * HOW LONG to hold is the adapter's to bound, because neither the engine's report
 * nor its own tracking says whether the engine will ever come back. Two bounds, and
 * NEITHER MAY FIRE WHILE THE MODEL IS PRODUCING — a timer expiring mid-turn would
 * close that same stdin and re-create the very defect this exists to prevent:
 *
 *  - a short grace once everything has settled (only a wake-up can still be owed),
 *    re-armed by every frame that arrives while parked, so it measures SILENCE
 *    rather than elapsed time;
 *  - an absolute cap on the parked stretch while work is genuinely still running,
 *    released the instant a continuation turn starts.
 */
export function createBackgroundHold(deps: {
  registry: TaskRegistry;
  /**
   * A bound ran out. The hold has already stopped waiting; what that means for the
   * session is the caller's decision — see {@link HoldExpiry}. Deliberately NOT a
   * `closeChannel()` the hold calls itself: that hard-wiring is what let a cap
   * expiry sever the control transport of a session that was still alive.
   */
  onExpire: (reason: HoldExpiry) => void;
  /** Wakes the adapter's main loop so an expiry is acted on promptly. */
  wake: () => void;
  /** `null` disarms the bound entirely; omitted takes the measured default. */
  graceMs?: number | null;
  /** `null` disarms the bound entirely; omitted takes the measured default. */
  capMs?: number | null;
}): BackgroundHold {
  const { registry, onExpire, wake } = deps;
  const graceMs = deps.graceMs === undefined ? BACKGROUND_WAKEUP_GRACE_MS : deps.graceMs;
  const capMs = deps.capMs === undefined ? MAX_BACKGROUND_HOLD_MS : deps.capMs;

  let holding = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (graceTimer) clearTimeout(graceTimer);
    if (capTimer) clearTimeout(capTimer);
    graceTimer = undefined;
    capTimer = undefined;
  };

  /**
   * A bound ran out: stop waiting, hand the outcome to the caller, wake the loop.
   *
   * The hold does no more than that ON PURPOSE. It used to call `closeChannel()`
   * for both bounds, which is right for `'grace'` (settled work, quiet engine — the
   * ordinary end of the run) and catastrophic for `'cap'` (a live CLI whose only
   * host control transport then disappears from under it). Splitting the decision
   * out is what makes "stop waiting" and "close the channel" stop being one
   * operation.
   */
  const expire = (reason: HoldExpiry) => {
    clearTimers();
    if (!holding) return;
    holding = false;
    onExpire(reason);
    wake();
  };

  /**
   * Re-decide the SHORT bound for the parked state. Armed only once everything has
   * settled, because then the sole outstanding thing is a wake-up; while work is
   * still running the wake-up may be minutes away and the cap alone bounds it.
   *
   * Re-armed from every frame that arrives while parked, so it measures SILENCE
   * rather than elapsed time — an earlier version disarmed on any SDK message and
   * let only `task_*` events re-arm, so one stray frame (`system/status`,
   * `system/background_tasks_changed` — both real) killed the short bound outright.
   */
  const park = () => {
    if (!holding) return;
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer =
      graceMs !== null && registry.noWorkLeftRunning() ? setTimeout(() => expire('grace'), graceMs) : undefined;
  };

  /**
   * (Re-)arm the outer bound. Called at `begin()` and again from every frame that
   * shows the held work MOVING ({@link isBackgroundProgress}) — so it measures a
   * stall, not elapsed time. `null` disarms it: the run is then bounded only by the
   * consumer's `timeoutMs`/`abort()`, which is the point of the escape hatch.
   */
  const armCap = () => {
    if (capTimer) clearTimeout(capTimer);
    capTimer = capMs === null ? undefined : setTimeout(() => expire('cap'), capMs);
  };

  return {
    begin() {
      holding = true;
      // The outer bound on this parked stretch. Re-armed from progress rather than
      // running absolute: the engine emits periodic frames while it babysits a long
      // task, so a plain inactivity cap would let a backgrounded `sleep 3600` hand
      // this run's whole lifetime to the engine — but an absolute one cut off live
      // subagent-driven runs, which is the defect this release fixes. The middle
      // ground is to re-arm only on evidence that the WORK is moving (see touch).
      armCap();
      park();
    },

    end() {
      clearTimers();
      holding = false;
    },

    /**
     * Which of the two cases this message is decides whether a bound may run at all:
     *
     *  - the MAIN model is producing again → the engine took the wake-up and a
     *    continuation turn now owns the channel. Drop the hold and let that turn's
     *    `result` decide afresh. No bound may tick here: a turn is legitimately
     *    silent for as long as its slowest tool call, and a timer firing mid-turn
     *    would close the control transport — the original defect, re-created.
     *    (An engine that then never finishes the turn hangs the run, exactly as it
     *    would for any ordinary turn; `timeoutMs`/`abort()` are the lever — M13.)
     *  - anything else — task lifecycle frames, subagent chatter (`parent_tool_use_id`
     *    set: a helper talking after its parent turn ended is the held state, not a
     *    resumption of it) → still parked, so re-arm.
     *
     * Which bound gets re-armed differs. The short one re-arms from ANY frame,
     * because it measures silence. The cap re-arms only from
     * {@link isBackgroundProgress} — a heartbeat must not extend it, or a
     * backgrounded `sleep 3600` would never end.
     */
    touch(event) {
      if (!holding) return;
      if (isMainModelActivity(event)) {
        clearTimers();
        holding = false;
        return;
      }
      // Still parked. Re-arm the short bound from any frame (it measures silence),
      // and the outer one only from evidence that the held work itself is moving.
      park();
      if (isBackgroundProgress(event)) armCap();
    },

    dispose: clearTimers,
  };
}
