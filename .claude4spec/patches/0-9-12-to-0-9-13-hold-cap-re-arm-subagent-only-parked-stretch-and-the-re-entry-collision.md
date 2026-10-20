---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: clarification
created_at: '2026-09-22T22:29:37.064Z'
created_by: unknown
applied: false
---
# Patch — hold-cap re-arm: subagent-only parked stretch and the re-entry collision

## What I found
The hold-cap re-arm rule was implemented exactly as M17/A01 word it, confirmed via `c4s ask`, thread `B6R1UZF3yH09`:
- Only the `task_started`/`task_progress`/`task_notification` frames the adapter routes into a tracked task's `background_task_*` family re-arm the cap, "and by nothing else".
- Plus the re-entry rule: a finished `taskId` that sees a second `task_started` re-arms both bounds.

Two consequences the spec does not state explicitly:
1. **A parked stretch whose only unsettled work is a subagent is cut at the cap** (default 90s), even while the subagent visibly works. Neither subagent token content (`parent_tool_use_id`) nor subagent `task_progress` routes into `background_task_*`. Before 0.9.13 the code deliberately re-armed the cap from subagent output; that fixed a production defect where healthy subagent-driven runs were cut at 90s. The unit test for that fix was inverted to assert the spec-literal behaviour.
2. **Collision:** "re-entry re-arms both bounds" applies to any task kind, and in practice to subagents (`SendMessage`). That is the one place a subagent frame re-arms the cap, and it sits next to A01's "and by nothing else". It was implemented as written: a re-entry `task_started` of a previously finished task re-arms the cap.

## Suggestion
Settle the intent explicitly in M17's hold-bounds section:
- Either subagent lifecycle frames (`subagent_started`/`subagent_progress` of a tracked subagent) also re-arm the hold cap, which is consistent with "both kinds are tracked" and "silence from a tracked task".
- Or state plainly that a subagent-only parked stretch is bounded by the hold cap regardless of its progress, and that `subagentTimeoutMs` is the lever for subagents.

Then reconcile A01's "and by nothing else" with the re-entry rule, and add an AC for the subagent-only parked stretch.

