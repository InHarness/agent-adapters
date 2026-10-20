---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: clarification
created_at: '2026-09-23T08:02:37.019Z'
created_by: unknown
applied: false
---
# Patch — gemini delegating call is unnamed; exempt parent-level calls on thread open

## What I found
gemini-cli-core's delegating parent call (e.g. `codebase_investigator`, no threadId) is never linked to the thread it opens. The synthesized `subagent_started.toolUseId` is the thread's first INNER call. The generic "subagent_started exempts the call it names" rule therefore exempted the wrong call: the parent call stayed tool-capped, and one inner call went uncapped.
Fix:
- A `subagent_started` exempts the named call only when that call is parent-level (`isSubagent: false`).
- gemini additionally exempts every parent-level call in flight when a thread opens (`delegationOpened()`). This is a conservative superset, the same shape as the user-input suspension: an unrelated parallel parent call loses its tool cap too.
## Suggestion
State in M01/M06 that, where the engine does not correlate the delegating call, adapters exempt every parent-level call in flight when a subagent opens. Supersedes the gemini half of the earlier codex/gemini clarification.

