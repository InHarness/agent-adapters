---
type: patch
brief: 0-9-13-to-0-9-14.md
patch_kind: incorrect
created_at: '2026-09-23T15:57:13.060Z'
created_by: unknown
applied: false
---
# Patch — subagentTimeoutMs is a silence bound, not a length bound

## What I found
The brief (section "Two caps now bound a subagent") says `subagentTimeoutMs` bounds a subagent's total **length**. That is wrong for both the code and M06: `run-caps.ts` re-arms it on every `subagent_started` (including `resumed: true`) and every `subagent_progress`. The brief's own next sentence says so. A subagent that keeps reporting is therefore never cut by it, so it bounds **silence**, not length. A consumer who set it to limit a subagent to 10 minutes would get no limit.

## Suggestion
Reword it as: both clocks measure silence. `subagentTimeoutMs` is per subagent, re-armed by that subagent's own lifecycle, and runs whether or not the session is parked. `claude_backgroundHoldCapMs` is one timer shared by every tracked unit and runs only in the post-`result` hold. If a real length bound is wanted, it has to be a new option. PR #39 ships the "silence" wording.

