---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: clarification
created_at: '2026-09-23T08:02:36.832Z'
created_by: unknown
applied: false
---
# Patch — toolCallTimeoutMs across a turn result

## What I found
The spec gives no rule for whether a turn's `result` affects an armed `toolCallTimeoutMs`. The 0.9.13 first cut dropped every in-flight call at `result`, mirroring the idle clock. That left the inner calls of a background subagent that outlives the turn uncapped for the rest of the run.
Per `c4s ask` (thread lpcJQ80gHxCl), the literal reading is that the cap is disarmed only by the call's own `tool_result`. Implemented that: `result` no longer touches tool caps. Caps are disposed when the RUN ends: the one-shot adapters' `result`, claude-code's non-held final `result`, and every terminal path.
The idle clock (0.9.11) still drops dangling calls at `result`, so the two clocks now treat a turn boundary differently.
## Suggestion
In M01, add one sentence on the turn boundary covering both clocks. In M17, state what bounds a subagent that outlives the turn and its inner calls: the subagent cap, the hold cap, or both.

