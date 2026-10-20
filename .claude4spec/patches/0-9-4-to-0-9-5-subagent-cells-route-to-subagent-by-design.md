---
type: patch
brief: 0-9-4-to-0-9-5.md
patch_kind: clarification
created_at: '2026-08-25T10:06:27.304Z'
created_by: unknown
applied: false
---
# Patch — subagent cells route to subagent_* by design

## What I found

The AC says, of every cell in the matrix: "task frames route to the right event family —
`background_task_*`, derived from the SDK's `task_*` channel". The implementer note
repeats it: "task frames surface as the `background_task_*` event family … not as
generic tool events".

Read literally that is wrong for the two `subagents` cells, and following it would have
broken M17's own routing rule. The adapter classifies on the SDK's `task_type`
discriminator (`src/adapters/claude-code.background-hold.ts:30-56`): only
`bash`/`shell`/`monitor`/`workflow` (and their `local_*` forms) are background. Anything
else — including an absent discriminator — keeps the `subagent_*` family, and subagents
are deliberately excluded from `result.backgroundTasks` because that field's documented
meaning is "this result is not end-of-run", so listing a subagent would promise a
`background_task_completed` that never arrives.

So the SDK multiplexes both onto one `task_*` channel, and the adapter demultiplexes:
`background_task_*` for backgrounded shell work, `subagent_*` for real subagents. The
matrix asserts the family appropriate to each cell.

## Suggestion

The AC's own prose ("route to the **right** event family") is already correct — it is
the parenthetical `background_task_*` that over-specifies. Consider dropping the
parenthetical, or spelling out the split: *`background_task_*` for backgrounded shell
work, `subagent_*` for subagent dispatch — and never the reverse, which is the
mislabelling M17 exists to remove.*

