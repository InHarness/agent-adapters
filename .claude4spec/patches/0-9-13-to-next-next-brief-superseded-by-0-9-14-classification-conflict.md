---
type: patch
brief: 0-9-13-to-next.md
patch_kind: clarification
created_at: '2026-09-23T15:44:39.801Z'
created_by: unknown
applied: false
---
# Patch — next-brief superseded by 0.9.14; classification conflict

## What I found
Two briefs cover the same change: 0-9-13-to-next.md (to_release null) and 0-9-13-to-0-9-14.md. They disagree on two points:
- CHANGELOG classification: the next-brief says patch-level, 0.9.14 says minor.
- Error wording: the next-brief suggests "no tracked background task or subagent reported"; 0.9.14 says "tracked work".
Also: the 0.9.13 CHANGELOG told consumers the opposite ("a parked stretch whose only unsettled work is a background subagent is cut at the cap however busy"), and neither brief mentions that the new note has to reverse it.

## Suggestion
Treat 0-9-13-to-next.md as superseded by 0.9.14. Implementation (PR #39) followed 0.9.14: a minor-classified entry that explicitly reverses the 0.9.13 note. The error message uses the next-brief wording ("no tracked background task or subagent reported … any remaining tracked work is abandoned"), which satisfies both.

