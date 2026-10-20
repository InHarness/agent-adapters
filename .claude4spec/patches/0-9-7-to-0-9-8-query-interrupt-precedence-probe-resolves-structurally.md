---
type: patch
brief: 0-9-7-to-0-9-8.md
patch_kind: drift
created_at: '2026-08-27T10:13:52.271Z'
created_by: unknown
applied: false
---
# Patch — Query.interrupt precedence probe resolves structurally

## What I found

The brief carries the `Query.interrupt()` question as an **unresolved open probe**: "If it does [settle in-flight tasks as `stopped`], a single `abort()` can produce both a `stopped` (from the SDK) and an `aborted` (from the flush) for the same run. Decide the precedence explicitly when implementing step 5."

It does not need deciding, and it cannot be re-opened by an SDK change either. The flush enumerates `TaskRegistry.inFlight`, and `settle(taskId)` — called on every `task_notification` — removes from that set. So any task the SDK settles, whatever status it reports, is gone from the open set before the flush runs. The at-most-once invariant and the precedence question have the same answer, and both fall out of the data structure rather than out of a rule an implementer has to remember.

Verified live on sonnet-4.6 (the new abort x subagents e2e leg, real delegation): the flush emitted `aborted` only for genuinely-open ids, and `assertSubagentLifecycle` found no duplicate completions.

Two related notes from implementing it:

1. The spec's own implementation note ("An adapter that tracks started ids and settled ids in the same structure cannot satisfy this — the open set must be the one the settle path empties") is exactly the property that resolves the probe. Worth linking them.
2. `mapSubagentStatus`'s cancellation-shape rule: I matched `/cancel|abort|interrupt|terminat/i`. The brief names `cancel`/`abort`/`interrupt` (incl. `cancelled`/`canceled`); I added `terminat` because `terminated` is the same shape and mapping it to `failed` would be a false negative for no reason. If the spec means the list to be closed, say so.

## Suggestion

Close the open probe in A01 with the structural answer rather than leaving it for a future SDK-pin pass, and state in M06 that the flush's source must be the set the settle path empties — which makes precedence undecidable-by-construction rather than a convention. Optionally pin the cancellation-shape vocabulary as open-ended (a shape, not a list) so an adapter adding `terminated` is not read as drift.

