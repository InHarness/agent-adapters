---
type: patch
brief: 0-9-4-to-0-9-5.md
patch_kind: drift
created_at: '2026-08-25T10:06:40.640Z'
created_by: unknown
applied: false
---
# Patch — background-tasks green needs a self-skip caveat

## What I found

The coverage table records `background-tasks` (wake-up matrix) as an unqualified
✅ covered. Measured live on sonnet-4.6, that over-claims for half the matrix.

Three live runs of the four cells:

| cell | run 1 | run 2 | run 3 |
|---|---|---|---|
| backgrounded bash / one-shot | green | green | green |
| backgrounded bash / streaming | green | green | green |
| subagents / one-shot | fail* | inconclusive (skip) | green |
| subagents / streaming | fail* | green | inconclusive (skip) |

(*run 1 predates the fix described below.)

The `subagents` cells are non-deterministic: the model dispatches three subagents, and
whether the engine holds the session past the turn's `result` for them varies run to
run. When it does not, every `subagent_completed` lands BEFORE the first `result` — the
work never outlived the turn, there is no post-`result` control request, and the run
proves nothing either way. Those runs self-skip as INCONCLUSIVE.

Related finding, and the reason run 1 failed: the pre-existing precondition tested only
whether a settlement was PRESENT, not where it sat. A settlement inside the turn is the
same non-event as no settlement at all, so the matrix could report a pass on a run where
nothing was ever held. The implementation now keys the precondition on the settlement's
position relative to the first `result`.

## Suggestion

Give the `background-tasks` row the same caveat the MCP-elicitation row got:
*✅ covered — the two `subagents` cells self-skip when the engine completes the dispatch
inside the turn.* Reading the row as unconditional proof of the wake-up shape for
subagent-sourced work would be wrong.

Separately: whether the engine SHOULD background a subagent dispatch, or whether
completing inside the turn is the correct behaviour and the subagent cells are testing a
shape that only occurs incidentally, looks like a question for M17/M06 rather than for
the suite.

