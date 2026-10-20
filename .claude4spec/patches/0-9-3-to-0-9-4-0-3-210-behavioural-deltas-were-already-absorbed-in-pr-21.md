---
type: patch
brief: 0-9-3-to-0-9-4.md
patch_kind: drift
created_at: '2026-07-28T15:51:01.530Z'
created_by: unknown
status: awaiting
---
# Patch — 0.3.210 behavioural deltas were already absorbed in PR 21

## What I found

"For implementers" item 3 lists three behavioural deltas vs `0.3.153` and asks that "any code that
special-cased the 0.3.153 behaviour should be revisited". All three were already handled before this
brief, by the M17 background-task work merged in PR #21 (commit `1df65aa`, spec release 0.9.1). There
was nothing to revisit:

1. **`StopHookInput.background_tasks` now lists subagents.** The injected `Stop` hook
   (`src/adapters/claude-code.ts:1152-1173`) already keeps only a **non-empty** array; an empty or
   absent list is never read as "no background work". The code comment there states the rule
   explicitly — positive signal only.
2. **`BackgroundTaskSummary.type` reads `'subagent'` as a display label.**
   `projectBackgroundTasks()` (`src/adapters/claude-code.background-hold.ts:150-198`) already treats
   `type` as a friendly label rather than the `task_type` discriminant, re-classifies it, and drops
   its `'subagent'` entries. `classifyTaskType()` (same file, :43-55) strips the `local_` prefix, so
   `local_bash` → shell / background and `local_agent` → subagent. Unit-pinned in
   `claude-code.background-routing.test.ts:241-262`.
3. **Post-settle wake-up gap 5.0s → 3.5-3.7s.** There is **no 5s settle constant** in the codebase to
   retune. The live constant is `BACKGROUND_WAKEUP_GRACE_MS = 15_000`
   (`claude-code.background-hold.ts:220`), chosen at ~4x the worst observed gap; 5.0s appears there
   only in the JSDoc as the *rejected* value ("a 5s window therefore had no margin at all"). The cap
   is `MAX_BACKGROUND_HOLD_MS = 90_000`, and both are consumer-overridable via
   `claude_backgroundGraceMs` / `claude_backgroundHoldCapMs` (`src/options.ts:175-185`).

So the only real work this brief produced in code was the `devDependencies` bump itself.

## Suggestion

The spec appears to be re-deriving, as forward-looking guidance, deltas that A01/M17 already record as
closed. Consider marking those three in A01 as *already absorbed* (with the release they were absorbed
in) so the next brief that carries a pin bump does not re-issue them as open implementer work. More
generally: when a Verified-pin-log row's findings have already been designed against, the log row is
the right home for that fact — the "For implementers" section should then say "no code change expected
from these" rather than "revisit".

