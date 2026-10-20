---
type: patch
brief: 0-9-11-to-0-9-12.md
patch_kind: incorrect
created_at: '2026-09-22T16:38:38.967Z'
created_by: unknown
applied: false
---
# Patch — splitBySubagent does not key buckets on subagentTaskId

## What I found
The brief says "`splitBySubagent` keys buckets on `subagentTaskId`" and says consumers "close the bucket" on completion. The actual function (`src/utils.ts`) is a two-way split into `{ main, subagent }` arrays by attribution. There is no per-task bucket. `tool_result` is not in the subagent predicate at all, so subagent tool results land in `main`.

## What I shipped
No behaviour change. The doc says both cycles of a re-entered agent land in `subagent` in stream order, that per-agent grouping means keying on `taskId`/`subagentTaskId`, and that the terminator is the last `subagent_completed`.

## Suggestion
Correct M09's description. Separately, decide whether subagent `tool_result` should be routed to `subagent`.

