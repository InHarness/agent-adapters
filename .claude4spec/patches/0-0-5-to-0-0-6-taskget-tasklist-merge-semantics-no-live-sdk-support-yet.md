---
type: patch
brief: 0-0-5-to-0-0-6.md
patch_kind: clarification
created_at: '2026-07-14T11:31:35.148Z'
created_by: unknown
status: awaiting
---
# Patch — TaskGet/TaskList merge semantics + no live SDK support yet

## What I found

The brief says the whole task-tracking family (`TodoWrite` plus `TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`) should be projected into `todo_list_updated`, with each CRUD call merging "one entry" into the running snapshot. That maps cleanly onto `TaskCreate`/`TaskUpdate` (an id plus fields to upsert), but `TaskGet`/`TaskList` are read verbs whose `tool_use.input` may carry no per-item payload at all (e.g. a bare query/filter, or no input) — there's no single entry to merge for those two.

Separately: the installed SDK (`@anthropic-ai/claude-agent-sdk@0.3.153`) does not emit `TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`/`ToolSearch` as literal tool names anywhere in its type defs or bundled JS (confirmed via grep across both). This is forward-hardening ahead of an SDK version that isn't installed yet, so there is no way to add a genuine e2e test exercising these tool names against a real Claude Code session right now — coverage for the CRUD family is unit/pure-function level only (a new `mergeTaskToolInputIntoSnapshot` helper), not an end-to-end run. The existing `TodoWrite` e2e test is unchanged and still covers that path live.

## Suggestion

Implemented `TaskGet`/`TaskList` as a no-op merge: when the tool's `input` carries no resolvable `id`, the snapshot is returned unchanged (still triggering a `todo_list_updated` event from current state, per "projects any of them", without fabricating a bogus entry). A future brief revision could make this explicit — e.g. spell out that only tool calls carrying an `id` (implicitly `TaskCreate`/`TaskUpdate`, and possibly a single-result `TaskGet`) participate in the merge, while list/query-shaped calls with no per-item payload are pass-through. Also worth noting in the brief (or a follow-up) that this whole family is speculative relative to the currently pinned SDK version, so acceptance criteria involving these tool names should expect unit-level verification until the SDK actually ships them.

