---
type: patch
brief: 0-9-7-to-0-9-8.md
patch_kind: clarification
created_at: '2026-08-27T14:34:10.783Z'
created_by: unknown
applied: false
---
# Patch — rule 2 cancellation-shaped default conflicts with the run-level meaning of aborted

## What I found

The brief's ordered mapping rules put rule 2 as: an unrecognized but *cancellation-shaped* status (`cancelled`, `canceled`, `interrupted`) maps to `'aborted'`. That is what shipped in `mapSubagentStatus`.

A code review of the implementation raised a tension the brief does not address. The vocabulary itself defines `'aborted'` as **run-level**: "a run-level termination ended the run — a terminal `error` follows immediately". But the SDK channel that today shows the `cancelled`/`canceled` spelling (`task_updated.patch.status`) is a **per-task** channel. So if a future claude-code SDK reports a *single* stopped delegation as `cancelled` on `task_notification`, rule 2 makes the adapter emit `status: 'aborted'` **mid-run, with no terminal error following** — which contradicts the vocabulary's own definition, and misleads exactly the consumer the `aborted`/`stopped` split exists to serve (one that tears down its whole session view on `'aborted'`).

`'stopped'` is the semantically safe default for an *undeclared* cancellation-shaped value: it claims less (one delegation ended), it is never wrong about the run still being alive, and the genuine run-level case is already covered by the flush, which does not go through the mapper at all.

I did **not** change this — the brief is explicit and canon. Filing it so the ruling is made deliberately rather than inherited.

## Suggestion

Decide, in M06, which of the two rule 2 should be, and state the reasoning either way:

- keep `'aborted'`, and add a sentence saying the run-level meaning is relaxed for unrecognized spellings (a consumer must not assume a terminal error follows an `'aborted'` it did not see the flush produce); **or**
- change rule 2 to `'stopped'`, noting that the mapper only ever sees per-task notifications — the run-level case reaches the stream through the termination flush, which synthesizes `'aborted'` directly.

The second reads more consistent with the vocabulary as written. Either way the AC that pins rule 2 should name the channel the value arrives on, since that is what makes the per-task/run-level distinction decidable.

