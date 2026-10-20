---
type: patch
brief: 0-9-8-to-next.md
patch_kind: clarification
created_at: '2026-09-03T12:19:00.712Z'
created_by: unknown
applied: false
---
# Patch — live evidence: addBlockedBy updates are routine; the CRUD family, not TodoWrite, answers a planning prompt

## What I found

Live probing on 0.3.220 (sonnet-4.6, four runs of the M16 todo scenario) turned the earlier d.ts-based argument into an observation.

1. **The graph-rewiring update is REAL, not hypothetical.** The model emitted, verbatim:

   ```
   TaskUpdate {"taskId":"2","addBlockedBy":["1"]}
   TaskUpdate {"taskId":"3","addBlockedBy":["2"]}
   ```

   after creating the three tasks — it encodes the sequential dependency of the plan. These merge nothing (correctly: no item's text or status changed) and surface as ordinary tool rows. Under the brief's warning contract as written ("gate on the write verbs") each would emit a consumer-visible `warning` announcing lost state and drift. This is a routine shape, not an edge case: it appeared in 2 of 4 runs of an ordinary 3-step planning prompt.

2. **The family this scenario exercises is the CRUD one, not TodoWrite.** Across all four runs the model discovered the tools via `ToolSearch(select:TaskCreate / select:TaskUpdate)` and answered with **TaskCreate x3 + TaskUpdate** — never `TodoWrite`, despite a prompt and system prompt that both name TodoWrite explicitly.

3. **Consequence for acceptance criteria.** Our pre-existing e2e assertions (a non-empty `todo_list_updated`, no leaked `TodoWrite` tool_use, a defined `todoListSnapshot`) all stayed GREEN throughout the regression, because the regression's signature is a snapshot of 0-1 items rather than an absent one, and the leaking tool was `Task*`, not `TodoWrite`.

## Suggestion

- Record the `addBlockedBy` observation in M16 as the motivating example for excluding declared-but-todo-irrelevant fields from the warning (see the companion patch on that gate). It is the shape a planning model naturally produces.
- State in `adapters/A01-claude-code.md` that on 0.3.220 the CRUD family, not `TodoWrite`, is what a planning prompt actually elicits — so any acceptance criterion phrased in terms of `TodoWrite` does not test what it appears to test.
- Strengthen the M16 acceptance criteria for a live 3-step planning scenario to assert what the regression actually broke: the snapshot **accumulates to N items** (per-item creates do not overwrite), **a status transition survives** the merge, and **no task call carrying todo content leaks as a plain tool row**. Note explicitly that 'no `Task*` row at all' is the WRONG criterion — the read verbs and graph-only updates legitimately surface as rows.

