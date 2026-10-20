---
type: patch
brief: 0-9-11-to-0-9-12.md
patch_kind: missing
created_at: '2026-09-22T16:38:39.162Z'
created_by: unknown
applied: false
---
# Patch — re-entry before notification, and re-entry of a running cycle

## What I found
The spec guarantees that pairs sequence and never nest. It also names the edge case where the finished mark is set but the task has not been notified. Taken literally, those two rules conflict: a second `task_started` arrives while cycle 1 has no `subagent_completed` yet, so emitting the resumed start would nest. The spec is also silent on a second `task_started` while the cycle is still running with no finished patch.

## What I shipped
- **Patched finished, not notified.** At re-entry, cycle 1 is closed with a `subagent_completed` carrying the status from the `task_updated` patch, and then the resumed start is emitted. If cycle 1's notification arrives late, it is swallowed only while cycle 2 has not been patched finished yet. The engine patches before it notifies, so this never eats cycle 2's own notification. This is unit-tested for both a late notification and one that never arrives.
- **Still running, no patch.** No new pair is opened. The new `tool_use_id` is mapped and the open cycle continues.
- **Teammates.** They are discriminated on the task channel by `task_type: 'in_process_teammate'`, confirmed in the bundled CLI. The spec's discriminator, a sender task id on the message origin, applies to user-turn origins, not to `task_started`.

## Suggestion
Put all three rules into M06/A01.

