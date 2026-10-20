---
type: patch
brief: 0-9-8-to-next.md
patch_kind: missing
created_at: '2026-09-03T10:18:41.099Z'
created_by: unknown
applied: false
---
# Patch — batch TaskCreate keying, fallback gap, unobserved tool_result shape

## What I found

Implemented `0-9-8-to-next.md` in full (draft PR #31). Two things the brief could not settle, plus one measurement that closes an open question.

**1. M16 says nothing about batch `TaskCreate`.** The brief tells me to merge `{ tasks: '[…]' }` and to emit one `todo_list_updated`, but not how to KEY the resulting items — and a batch item has no identifier of its own. A `c4s ask` consult (thread `ywRvdT2nJl_3`) confirmed the spec is silent, while ruling out two of the three candidates:

- full-list-replace contradicts the family rule in <section_ref anchor="3dln3isl"/> ("CRUD family: per-item merge; legacy `TodoWrite`: wholesale replace") — batch `TaskCreate` is CRUD family;
- bare-index keying (`"0"`, `"1"`, as `todoItemsFromTodoWriteInput` does) reproduces the very overwrite defect <section_ref anchor="ncle4lvp"/> exists to prevent: a second batch would clobber the first batch's items.

I implemented `<toolUseId>#<idx>`, which is consistent with both rules but written nowhere.

**2. The positional fallback cannot cover a batch, and the brief does not say so.** <section_ref anchor="ncle4lvp"/> defines the last-resort reconciliation as "exactly ONE create unreconciled and an update naming an id never seen assigned". A batch leaves **N** creates unreconciled in a single call, so read literally that fallback can never fire for it — every later `TaskUpdate` would append a blank stub and the real items would never leave `pending`. That is the batch flavour of the exact bug M16 was written to prevent.

I closed it by recovering the N ids from the batch's `tool_result` and mapping them positionally onto the N items (`extractAssignedTaskIds`), declining to alias at all when the counts disagree.

**3. The batch `tool_result` shape is still unknown — and I could not observe it.** I ran a live raw-SDK probe on **0.3.220** against both `claude-opus-5` and `claude-sonnet-5`, explicitly prompting for all four tasks to be created up front. Both models emitted **per-item** creates every time; I never provoked a batch. What the probe DID pin verbatim on 0.3.220:

```
USE TaskCreate {"subject":"…","description":"…","activeForm":"…"}
RES TaskCreate "Task #1 created successfully: Extract file-validation logic from AvatarUpload"
USE TaskUpdate {"taskId":"1","status":"in_progress"}
RES TaskUpdate "Updated task #1 status"
```

So the single-create prose contract already recorded in M16 holds unchanged on 0.3.220, and `"Updated task #<n> status"` is the update result phrasing (not previously recorded, as far as the brief shows). But my batch id-extraction is extrapolated from that phrasing, not measured — it accepts both a JSON id list and repeated prose. It degrades safely, but it has never met a real batch payload.

## Suggestion

1. <section_ref anchor="ncle4lvp"/> — add a "batch create keys N items at once" paragraph: state explicitly that a batch is a merge of N items (not a replace, per <section_ref anchor="3dln3isl"/>), record the temporary-key scheme, and generalize the positional fallback to say what a batch does — either "map by order when the result names exactly N ids" (what I implemented) or "batch forgoes the fallback entirely".
2. <section_ref anchor="1kbztqb4"/> — add the edge case where only SOME batch items can be aliased (count mismatch), alongside the existing `status: "deleted"` debt.
3. <section_ref anchor="8awtmgyk"/> and `adapters/A01-claude-code.md` <section_ref anchor="49zu34oc"/> — record that the batch input shape is attested from production traffic (5 calls, 2026-07-11..28) while the batch `tool_result` shape is NOT attested, and that per-item creates are what 0.3.220 emits for opus-5/sonnet-5. Worth stating which model/version the batch was observed on, if the traffic data still carries it — that is the missing half of the contract.
4. Consider an `ac` for the observable consequence I could test: *two consecutive batch creates accumulate their items rather than the second overwriting the first.*
5. Separately: the brief's §3 asks for a `warning` on an unmergeable write but does not bound its frequency. A model that consistently emits an unhandled spelling would warn on every call, so I latched it once per distinct `tool + sorted input keys` shape, mirroring the existing `unknownSubagentStatusWarned` behaviour. Worth stating either way, since it is consumer-observable.

