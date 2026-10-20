---
type: brief
from_release: 0.9.13
to_release: null
generated_at: '2026-09-23T13:57:05.157Z'
implemented: true
---
# Brief: 0.9.13 → (unreleased)

This release closes a gap between what the background hold *tracks* and what is allowed to
*re-arm* it in the `claude-code` adapter. A consumer running with
`claude_backgroundHoldCapMs: 300000` saw a subagent that was visibly alive — emitting
progress the whole time — killed with `AdapterBackgroundHoldExpiredError` five minutes in.
The hold counted that subagent as in-flight work (so the short grace timer never armed and
the long cap took over at the held result), but only `background_task_*` frames reset the
cap, so a held subagent could never keep itself alive. After this change the cap is re-armed
by the lifecycle of **any** unit the hold tracks — background tasks *and* tracked subagents.

## What the system does now

The background hold has two timers: a short grace window, armed when no work is in flight,
and a long cap (`claude_backgroundHoldCapMs`) armed when work *is* in flight. The cap is a
liveness deadline, not a total budget: each lifecycle signal from tracked work pushes it out
by another full `capMs`. The set of signals that push it out now matches the set of units the
hold tracks:

- **Background tasks** — `background_task_started`, `background_task_progress`,
  `background_task_completed` (unchanged behaviour).
- **Tracked subagents** — every frame the adapter routes into the `subagent_*` family:
  `subagent_started` (both the first start and a re-entry), `subagent_progress`,
  `subagent_completed`.

Two exclusions carry over from how the hold already decides what it tracks, and they apply to
re-arming as well:

- **Teammate task ids are not tracked**, so a teammate frame does not re-arm the cap.
- **Stale notifications from a previous hold cycle** are swallowed by the adapter; a swallowed
  frame is not a liveness signal and does not re-arm the cap.

Consequences, stated as the two cases that matter:

- A held subagent emitting `subagent_progress` at intervals shorter than `capMs` runs
  indefinitely, even past a total elapsed time far greater than `capMs`. Previously it died at
  `capMs` from the held result.
- A held subagent that goes **silent** for longer than `capMs` still expires with
  `AdapterBackgroundHoldExpiredError`. The cap remains a real deadline against genuinely stuck
  work — this is a liveness fix, not a removal of the guard.

`subagentTimeoutMs` semantics are unchanged: it remains the per-subagent timeout and is
unrelated to the hold cap.

The hold-cap error text is widened accordingly, because a cap expiry can now mean either kind
of work went quiet — it reports that no tracked background task **or subagent** reported
within the cap window (e.g. `no tracked background task or subagent reported`).

This is a behavioural fix. No public API changes: no new option, no changed option type, no
new error class.

## For implementers

Edit targets in dependency order.

1. **`src/adapters/claude-code.ts` — the `task_*` handling.** The adapter routes
   `system/task_started`, `task_progress` and `task_notification` frames; the branches that
   dispatch them into the `subagent_*` family must call `hold.rearmCap()` on every tracked
   frame. Today `rearmCap()` is called only from the `background_task_*` branches, and
   `task_started` only on re-entry. Specifically:
   - `task_started` — re-arm on the **first** start as well as on re-entry.
   - `task_progress` — re-arm.
   - `task_notification` — re-arm, **except** for a notification identified as stale from a
     previous hold cycle (the path that currently swallows it must return before re-arming).
   - In all three: skip re-arming when the task id belongs to a teammate, i.e. reuse the same
     "is this a tracked, non-teammate subagent" predicate the hold already uses to decide
     in-flight membership, rather than writing a second test.

2. **`src/adapters/claude-code.background-hold.ts` — doc comments.** Three places still say
   only background tasks re-arm the cap and must be corrected:
   - the `MAX_BACKGROUND_HOLD_MS` comment block, section "WHAT RE-ARMS IT",
   - the `BackgroundHold.rearmCap` doc comment,
   - the `createBackgroundHold` doc comment.

3. **`src/types.ts` and `src/options.ts` — hold-cap docs and error text.** Update the
   `claude_backgroundHoldCapMs` option documentation and the `AdapterBackgroundHoldExpiredError`
   message so neither claims background tasks are the only thing that resets the cap. Suggested
   wording for the message: `no tracked background task or subagent reported`.

4. **Tests.**
   - New: a held subagent emitting `task_progress` at intervals below `capMs`, for a total
     elapsed time greater than `capMs`, does **not** expire.
   - New: a silent held subagent still expires with `AdapterBackgroundHoldExpiredError`.
   - Unchanged: the existing background-task cap tests must keep passing as-is — the
     `background_task_*` re-arm path is not being altered.

5. **`CHANGELOG.md`** — a patch-level note describing this as a behavioural fix to the
   `claude-code` background hold cap, with no API change.

## Spec status

The specification side of this is being reconciled separately: the intent above is the one
settled in ask thread `jPc3ZlhgwxMR` and the plan
`m17-hold-cap-re-arms-on-tracked-subagent-lifecycle.md`. The one-line rule to hold onto is:
*the hold cap is re-armed by the lifecycle events of any unit the hold tracks.*
