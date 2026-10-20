---
type: patch
brief: 0-9-6-to-0-9-7.md
patch_kind: incorrect
created_at: '2026-08-26T16:23:31.622Z'
created_by: unknown
applied: false
---
# Patch — A01 says the plan-mode preset keeps skills; its own shell-deny rule and M05 say it does not

## What I found

A01, "Per-capability consumption", the Skills (M05) bullet, says:

> the `Skill` tool stays available under a `file-write` deny (**so the plan-mode preset keeps skills**), and is suppressed under a `shell` deny, because a skill can drive the shell.

The parenthetical does not follow from the two rules stated around it. The plan-mode preset desugars to `['file-write', 'shell']` (M18, "Preset registry"). It therefore carries a `shell` deny, and by the very next clause of the same sentence a `shell` deny suppresses `Skill`. The plan-mode preset does **not** keep skills — it removes them.

M05 already states the correct outcome explicitly:

> A `shell` deny therefore suppresses the skill tool for the run — on claude-code this **overrides the whitelist that otherwise keeps `Skill` available under the plan-mode preset**.

So the two files agree on the mechanism and disagree on the consequence, with A01 carrying the wrong one. The practical cost: a consumer reading A01 configures `planMode: true` expecting skills to remain usable and gets a run with no `Skill` tool at all, and an implementer reading A01 could "fix" that non-bug by whitelisting `Skill` past the shell deny — reopening exactly the front door M05 closed.

Found while reviewing this brief's diff; the review's scope landed on the spec working tree. I have not edited and will not edit the spec.

## Suggestion

Drop or invert the parenthetical in A01. The accurate statement is that the `file-write`-deny whitelist exists so a `file-write` deny **alone** keeps skills, and that the plan-mode preset does not benefit from it because it also denies `shell`. Per the one-home rule the reasoning belongs in M05; A01 should link to it rather than restate the consequence.

