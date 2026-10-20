---
type: patch
brief: 0-9-10-to-0-9-11.md
patch_kind: clarification
created_at: '2026-09-22T14:15:31.968Z'
created_by: unknown
applied: false
---
# Patch — idleTimeoutMs budget is cumulative (paused, not reset)

## What I found
M01 says the idle clock "advances only while nothing is outstanding and stops whenever work is in flight". It never says whether the budget carries over across outstanding periods. The spec agent (thread NfuWb-ft6MaK) confirmed it can only be inferred, from the rejection of "re-arm on last sign of life".

I implemented it as **cumulative** (`src/idle-clock.ts`): idle stretches before and after an outstanding period add up to the same `idleTimeoutMs` budget.

## Suggestion
Add one explicit sentence to M01: "the idle budget is cumulative across the run — a period of outstanding work pauses the clock and does not restore the budget". Also state explicitly that under `streamingInput: true` the clock advances while parked between pushes, so `idleTimeoutMs` also bounds the consumer's own silence.

