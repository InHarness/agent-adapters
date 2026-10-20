---
type: patch
brief: 0-9-9-to-0-9-10.md
patch_kind: clarification
created_at: '2026-09-07T16:28:04.142Z'
created_by: unknown
applied: false
---
# Patch — opencode deliberately not routed through mapSubagentStatus — branch-derived status

## What I found

Item 3 says "every adapter". I did not change opencode, and want that recorded rather than left as an apparent omission.

`src/adapters/opencode.ts` emits `subagent_completed` from two sites (`:713-718`, `:742-747`) with hardcoded `'completed'` / `'failed'`. But each sits inside a branch already discriminated by the SSE part's own status:

```ts
if (status === 'completed') { ... status: 'completed' ... }
else if (status === 'error') { ... status: 'failed' ... }
```

No wire value flows INTO the emitted status — the literal is the branch's meaning, not an SDK spelling passed through. `mapSubagentStatus` exists to stop an unrecognized reason resolving to `'completed'`; where the SDK vocabulary never reaches the status field, there is nothing for it to guard, and routing it through would add indirection without removing a failure mode.

I left the code as-is and added a comment stating this reasoning, so the next reader does not "fix" it.

Note the residual: an opencode subagent that ends for any reason OTHER than those two SSE statuses produces no `subagent_completed` from these sites at all. It is then closed by `flushOpenSubagent()` (`:498-503`) at run end as `'aborted'`. That is a coverage question (are there other terminal SSE statuses?), not a mapping one, and I did not probe it — opencode e2e was out of scope for this brief.

## Suggestion

Confirm that "route every adapter through \`mapSubagentStatus\`" is satisfied by construction where the status is branch-derived rather than payload-derived, and say so in M06 — otherwise this reads as an unimplemented item every time someone audits it. If you would rather have uniformity for its own sake, that is a legitimate call too, but it should be stated as such.

Worth a separate look: whether opencode's SSE tool-part status has terminal values beyond `completed` / `error`, since those would currently reach the consumer only as a run-end `'aborted'`.

