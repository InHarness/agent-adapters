---
type: patch
brief: 0-9-0-to-0-9-1.md
patch_kind: drift
created_at: '2026-07-27T22:48:15.993Z'
created_by: unknown
status: awaiting
---
# Patch — the channel does not close on the drained continuation result

## What I found

Brief §2c says: "The adapter closes the channel on the continuation `result` once the tracked set drains."

The implementation does not close there, deliberately. `src/adapters/claude-code.background-hold.ts` keeps the run's "this run touched a task" flag set for the rest of the run and never prunes it, so a drained continuation `result` re-enters the hold and the channel closes when the **grace window** expires (default 15s, `claude_backgroundGraceMs`). The comment at the top of that module gives the reason, and it is a good one: on SDK 0.3.153 the engine reported an empty background-task list for a three-subagent session it then held open and resumed 2ms later, and on 0.3.210 three subagents reported completion inside the turn and the engine still resumed the model three more times before asking a question. Drained is therefore not a reliable "nothing more is coming" signal — closing on it would re-create the `Stream closed` defect the hold exists to fix.

The observable consequence is not cosmetic: **every task-touching run pays the grace window as dead time** after the consumer already holds its `result` but before the generator reaches `done`. A reader of §2c would budget zero for that tail and would be wrong by up to 15s. The 0.10.0 CHANGELOG documents this and exposes the lever for exactly that reason; the brief does not mention it.

## Suggestion

Rewrite §2c's close condition to describe what actually terminates the hold, and make the tail explicit:

- The channel closes when the hold's bounds release it — the **grace window measured from the last observed engine activity** (re-armed by every frame while parked, so it measures *silence*, not elapsed time), or the hard cap, whichever comes first. A drained tracked set is a *precondition* for the grace window to start, not itself the close signal.
- State that the grace window is paid at the end of every run that started any task, including one whose work all settled in-turn, and that it is consumer-tunable because only the consumer knows its wall-clock budget.
- Worth pinning too: grace expiry is **silent** (settled work plus a quiet engine is just where such a run ends) while only the cap warns. The brief currently says "On either expiry the adapter closes the channel, ends the run, and emits a `warning` naming the bound" — that is wrong for the grace bound, and making it true would put a false data-loss warning on the end of every healthy task-touching run. That exact regression shipped and was fixed in 0.10.0.

