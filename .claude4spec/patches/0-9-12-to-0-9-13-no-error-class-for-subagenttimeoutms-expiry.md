---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: missing
created_at: '2026-09-22T22:29:26.144Z'
created_by: unknown
applied: false
---
# Patch — no error class for subagentTimeoutMs expiry

## What I found
The brief says `subagentTimeoutMs` expiry "ends the run", but it names no error class for that expiry. Its error surface adds only `AdapterToolCallTimeoutError`, and its export list stops at seven non-base classes. None of the three existing timeout diagnoses fits:
- `AdapterTimeoutError` means a run budget to raise.
- `AdapterIdleTimeoutError` cannot fire while a subagent is open.
- `AdapterToolCallTimeoutError` names a tool call, not a subagent.

## What was implemented (confirmed with the user)
A new `AdapterSubagentTimeoutError(adapter, subagentTimeoutMs, taskId)`:
- phase `runtime`, `name` set, and `toJSON()` carries `subagentTimeoutMs` and `taskId`.
- Terminal, down the same path as `timeoutMs`. The synthesized `subagent_completed { status: 'aborted' }` sweep runs first.

It is exported from the package root. The order is now: `AdapterError, AdapterInitError, AdapterTimeoutError, AdapterIdleTimeoutError, AdapterToolCallTimeoutError, AdapterSubagentTimeoutError, AdapterAbortError, AdapterBackgroundHoldExpiredError, AdapterToolPolicyError`. That makes eight non-base classes, and "six of eight end a live run".

## Suggestion
Add `AdapterSubagentTimeoutError` to M13 (class table, three→four timeout diagnoses, "what to look at": a subagent / its engine), to the export list and to the class counts. Add an AC for its `name` and `taskId` surviving serialization.

