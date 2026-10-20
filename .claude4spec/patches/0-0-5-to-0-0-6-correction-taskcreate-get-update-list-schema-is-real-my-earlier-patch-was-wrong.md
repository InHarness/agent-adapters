---
type: patch
brief: 0-0-5-to-0-0-6.md
patch_kind: incorrect
created_at: '2026-07-14T13:09:47.843Z'
created_by: unknown
status: awaiting
---
# Patch — correction: TaskCreate/Get/Update/List schema is real, my earlier patch was wrong

## What I found

A prior patch I filed against this brief ("TaskGet/TaskList merge semantics + no live SDK support yet") was itself factually wrong on one key point, caught by a subsequent code review: I had grepped the installed SDK (`@anthropic-ai/claude-agent-sdk@0.3.153`) for the literal quoted strings `"TaskCreate"` etc. and found nothing, and concluded these tools don't exist yet in the pinned SDK. That grep missed a separate file, `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts`, which ships fully-specified, real schemas:

- `TaskCreateInput { subject: string; description: string; activeForm?: string; metadata?: {...} }` — no `id` field; the server only assigns one in `TaskCreateOutput.task.id` (the tool_result)
- `TaskGetInput { taskId: string }`, `TaskUpdateInput { taskId: string; subject?; description?; activeForm?; status?: ("pending"|"in_progress"|"completed")|"deleted"; addBlocks?; addBlockedBy?; owner?; metadata? }` — the identifier field is `taskId`, never `id`
- `TaskListInput {}` — empty; the actual list is in `TaskListOutput.tasks[]`
- `ToolSearch` remains genuinely absent from the entire installed package (checked every `.d.ts` and bundled `.js`/`.mjs`) — so that part of my original patch still holds.

My first implementation had guessed `id`/`content` as the field names (mirroring TodoWrite), which is wrong for all four tools — it made the merge a permanent no-op against the real schema while still suppressing the real tool_use/tool_result, i.e. these tools would have been completely invisible if a model actually called them. I've since fixed the adapter to read the real field names.

## Suggestion

For a future brief revision on this topic: the brief's "for implementers" section could point at `sdk-tools.d.ts` directly (or embed the confirmed schema) rather than leaving field names to be reverse-engineered — that's what caused the original bug. Also worth noting explicitly: `TaskCreateInput` has no client-visible identifier, so any adapter design in this space needs an explicit call on how to key a freshly-created item before its server id is known (I keyed it by `toolUseId`, which does not reconcile with a later `TaskUpdate({taskId: <real id>})` for the same task — parsing the `tool_result` to learn the real id would fix this fully, but this adapter does not do that, since the tool_result wire shape for these built-ins hasn't been observed against a live model call).

