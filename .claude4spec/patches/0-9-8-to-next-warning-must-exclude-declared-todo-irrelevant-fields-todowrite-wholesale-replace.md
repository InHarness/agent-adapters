---
type: patch
brief: 0-9-8-to-next.md
patch_kind: missing
created_at: '2026-09-03T11:50:03.342Z'
created_by: unknown
applied: false
---
# Patch — warning must exclude declared todo-irrelevant fields; TodoWrite wholesale-replace loss

## What I found

The brief specifies the unmergeable-write `warning` as "gate on the write verbs, not on 'the merge returned undefined'". Implementing it that way produces a FALSE drift signal for a shape the adapter handles perfectly.

`TaskUpdateInput` (sdk-tools.d.ts on 0.3.220) declares four fields that carry no todo-list content: `addBlocks`, `addBlockedBy`, `owner`, `metadata` (plus `taskId` itself). A call like `TaskUpdate({ taskId: '2', addBlockedBy: ['1'] })` rewires the task dependency graph without touching any item's text or status. The merge correctly returns `undefined` — nothing about the todo list changed — but the write-verb gate then tells the consumer "that task-list update is lost" and "this is a drift signal". Nothing was lost and there is no drift, and a warning that fires on correct behaviour trains consumers to ignore it.

The write-verb gate is necessary but not sufficient: the real condition is "a write merged nothing AND its input carries at least one key we do not recognize". A write built only from declared-but-todo-irrelevant keys is silent.

A second, adjacent gap: `TodoWrite` is a write verb, but it REPLACES the snapshot wholesale rather than merging, so its failure mode is not 'the list stops advancing' — it is 'the list is blanked'. A `todos` the adapter cannot read (e.g. the model stringifies it, exactly as it does with `TaskCreate({ tasks })`) silently clears the consumer's list. The brief's warning contract does not reach that path at all.

## Suggestion

- In M16, state the warning's precondition as two parts, not one: an unmergeable WRITE **whose input carries an unrecognized key**. Name the declared-but-todo-irrelevant set explicitly (`taskId`, `addBlocks`, `addBlockedBy`, `owner`, `metadata`) so the exclusion is specified rather than rediscovered per adapter.
- Add an acceptance criterion: a `TaskUpdate` carrying only `taskId` + graph/ownership/metadata fields merges nothing AND emits no warning.
- Record that the stringified-list raw-stream failure mode is not specific to `TaskCreate({ tasks })`: `TodoWrite({ todos })` is the same shape, and because TodoWrite replaces wholesale, an unreadable list must NOT be applied — the previous snapshot is kept and the loss reported. Worth an `ac` of its own, since 'empty list the model actually sent' (a legitimate clear) and 'list the adapter could not read' must not be conflated.
- Related, on id reconciliation: the positional-fallback queue must hold the id the MERGE keyed the item by (`taskId ?? id ?? toolUseId`), not the `tool_use` id. A create that spells its own `id` is not filed under its tool_use id, and queueing the wrong one aliases a later update onto an item that does not exist — reproducing the very stub-append defect the alias exists to prevent.

