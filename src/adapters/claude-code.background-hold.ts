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
   * Did this run start ANY task? The coarse keep-open reason — deliberately coarse,
   * because nothing-in-flight is not the same as nothing-coming (observed on 0.3.210:
   * three subagents all reported completion INSIDE the turn and the engine still
   * resumed the model for three further turns).
   */
  touchedATask(): boolean;
}

export function createTaskRegistry(): TaskRegistry {
  const kindById = new Map<string, TaskKind>();
  const inFlight = new Set<string>();
  const finished = new Set<string>();

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
    },
    inFlight,
    noWorkLeftRunning: () => [...inFlight].every((id) => finished.has(id)),
    touchedATask: () => kindById.size > 0,
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
 * Hard cap on the hold, measured from the engine's last sign of life. Bounds the
 * case the grace window cannot see: work that never settles at all (a backgrounded
 * `sleep 3600`). Without it, holding the channel would hand this run's lifetime to
 * the engine indefinitely. Because it measures SILENCE it cannot fire under a live
 * engine; on expiry the run ends exactly as it did before the hold existed — plus a
 * `warning`, so a genuine truncation is visible rather than silent.
 *
 * DELIBERATELY BELOW `collectEvents()`'s 120s default (src/utils.ts). The two clocks
 * race: `collectEvents` starts its timer when the run starts, the cap only arms at
 * the first held `result`, so an equal cap could never emit its warning before the
 * helper rejected the whole run — losing the only signal that background work was
 * abandoned. Raise it with `claude_backgroundHoldCapMs` (and the helper's own
 * `timeoutMs` alongside) when a consumer genuinely waits longer.
 */
export const MAX_BACKGROUND_HOLD_MS = 90_000;

export interface BackgroundHold {
  /** Enter the hold at a `result` the engine is expected to resume from. */
  begin(): void;
  /** Leave the hold without closing anything (a continuation turn owns the channel now). */
  end(): void;
  /** An SDK message arrived: re-decide which bound applies, if any. */
  touch(event: SDKMessage): void;
  /** Take and clear warnings raised off-loop by an expiring bound. */
  drainWarnings(): string[];
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
  /** Ends the input iterable — the SDK then closes the CLI's stdin. */
  closeChannel: () => void;
  /** Wakes the adapter's main loop so an expiry is acted on promptly. */
  wake: () => void;
  graceMs?: number;
  capMs?: number;
}): BackgroundHold {
  const { registry, closeChannel, wake } = deps;
  const graceMs = deps.graceMs ?? BACKGROUND_WAKEUP_GRACE_MS;
  const capMs = deps.capMs ?? MAX_BACKGROUND_HOLD_MS;

  let holding = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  /** Raised off the loop (timer callbacks) — drained by the adapter. */
  const warnings: string[] = [];

  const clearTimers = () => {
    if (graceTimer) clearTimeout(graceTimer);
    if (capTimer) clearTimeout(capTimer);
    graceTimer = undefined;
    capTimer = undefined;
  };

  /**
   * A bound expired: close the channel and wake the loop. `message` is passed only
   * by the hard cap. Grace expiry is SILENT — settled work plus a quiet engine is
   * the normal end of a task-touching run, not a truncation; it closes the channel
   * exactly where the pre-hold code closed it, at `result`. Warning there told
   * every healthy run that its work "did not run".
   */
  const expire = (message?: string) => {
    clearTimers();
    if (!holding) return;
    holding = false;
    if (message) warnings.push(message);
    closeChannel();
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
    graceTimer = registry.noWorkLeftRunning() ? setTimeout(() => expire(), graceMs) : undefined;
  };

  return {
    begin() {
      holding = true;
      // The outer bound on this parked stretch. Absolute rather than inactivity-based,
      // because the engine does emit periodic frames while it babysits a long task, and
      // an inactivity cap would let a backgrounded `sleep 3600` hand this run's whole
      // lifetime to the engine. It is safe to make it absolute only because end()
      // releases it the moment the model is producing again (see touch) — an earlier
      // version never released it, and cut live resumed runs off mid-turn.
      if (capTimer) clearTimeout(capTimer);
      capTimer = setTimeout(
        () =>
          expire(
            `claude-code: background work still in flight after ${capMs}ms — ` +
              'closing the session. Any remaining background task is abandoned and its ' +
              'completion will not be reported.',
          ),
        capMs,
      );
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
     */
    touch(event) {
      if (!holding) return;
      if (isMainModelActivity(event)) {
        clearTimers();
        holding = false;
      } else {
        park();
      }
    },

    drainWarnings: () => warnings.splice(0),

    dispose: clearTimers,
  };
}
