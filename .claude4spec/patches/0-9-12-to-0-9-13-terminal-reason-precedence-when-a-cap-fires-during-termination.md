---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: clarification
created_at: '2026-09-23T08:02:37.395Z'
created_by: unknown
applied: false
---
# Patch — terminal-reason precedence when a cap fires during termination

## What I found
The spec gives no precedence when two terminal reasons coincide. On every adapter, the terminal error was evaluated AFTER the synthesized `subagent_completed{aborted}` flush yielded. A per-unit cap firing during that flush (the consumer holding the event) or between `abort()` and the flush replaced `AdapterAbortError` / `AdapterBackgroundHoldExpiredError` with a cap error. On claude-code's abort-under-user-input path, answering the request also re-armed suspended tool calls just before the run ended.
Implemented "first reason wins":
- a cap does not fire on a run that is already stopping.
- the flush disposes the caps.
- claude-code latches the terminal error before the flush.
## Suggestion
M13: state that the terminal error reports the FIRST reason the run started ending for, and that no clock may fire once termination begins.

