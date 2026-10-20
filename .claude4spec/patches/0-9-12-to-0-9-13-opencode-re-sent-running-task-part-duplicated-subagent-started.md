---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: drift
created_at: '2026-09-23T08:02:37.207Z'
created_by: unknown
applied: false
---
# Patch — opencode re-sent running task part duplicated subagent_started

## What I found
opencode re-sends a `task` tool part as `running` on every title or metadata update. The adapter emitted `tool_use` + `subagent_started` for each resend, which caused two problems:
- duplicate start events that break start/complete pairing (M06).
- the subagent cap re-armed on each resend, as if it were a heartbeat. A stalled child whose part kept getting updated was never cut.
The adapter now reports only the first `running` per callId.
## Suggestion
M06 could state that a synthesized `subagent_started` is emitted once per lifecycle, and that a re-sent engine state is not a re-entry.

