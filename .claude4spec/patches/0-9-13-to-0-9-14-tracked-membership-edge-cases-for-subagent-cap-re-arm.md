---
type: patch
brief: 0-9-13-to-0-9-14.md
patch_kind: missing
created_at: '2026-09-23T15:44:40.104Z'
created_by: unknown
applied: false
---
# Patch — tracked-membership edge cases for subagent cap re-arm

## What I found
Neither brief defines "tracked" for these edge cases, so I decided them:
1. A `task_progress` / `task_notification` for a subagent id never seen in `task_started`. It is not in the registry. I made it NOT re-arm the cap (membership = `tasks.inFlight.has(id)`).
2. A re-entry `task_started` into a still-running cycle (no finished patch). The adapter emits no `subagent_started` for it, because pairs never nest. Under the closed-vocabulary rule ("every subagent_* event") I made it NOT re-arm the cap. The pre-existing re-entry rule ("a finished task re-entering re-arms both bounds") already excludes a still-running cycle.

## Suggestion
State in M17 that cap re-arm membership means "started and not yet settled (in flight)". Also state that the re-arm follows the emitted `subagent_*` event, not the raw SDK frame, so a still-running re-entry does not re-arm.

