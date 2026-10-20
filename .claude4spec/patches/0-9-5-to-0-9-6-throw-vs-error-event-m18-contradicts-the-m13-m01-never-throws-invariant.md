---
type: patch
brief: 0-9-5-to-0-9-6.md
patch_kind: clarification
created_at: '2026-08-25T13:32:11.674Z'
created_by: unknown
applied: false
---
# Patch — throw vs error event: M18 contradicts the M13/M01 never-throws invariant

## What I found

The brief says the fail-closed path is a **throw**:

- Section 4: "**Unenforceable -> throw before dispatch.**"
- Section 3 matrix, codex row: "**none -> throws**"
- Implementer item 5: "throw `AdapterToolPolicyError` if any requested group is `none`"

But M13 and M01 hold the opposite invariant, and say so explicitly:

- M13 header: errors are "all surfaced as `error` events, **never thrown out of the stream**".
- The `AdapterToolPolicyError` section itself ends with: "Delivery — emitted via
  `{ type:"'error', error }`; the iterator never throws" — in the *same paragraph* that
  introduces the class.
- M01 edge case: "Adapter throws synchronously inside `execute` -> must be surfaced as an
  `error` event, never propagated out of the async iterator."

So the brief contradicts the canon it is derived from, and contradicts itself within one
section. No AC tagged `m18` mentions `throw`, `catch` or `rejects`; they all say only
"refuses the run before dispatch ... and nothing runs", which both readings satisfy.

I consulted the spec agent (`c4s ask`, thread `pH_3arjUouPA`), which ruled unambiguously
for the event form, and I implemented that:
`{ type: "'error', error: AdapterToolPolicyError, phase: "'init' }` at the first `next()`,
with no `adapter_ready`, no `result`, and zero SDK contact. The reasoning that convinced
me, beyond the invariant itself:

1. The L1 contract already admits a stream made only of an error ("a `result` then return,
   or an `error`"), so "nothing ran" needs no new shape.
2. A throw buys nothing operationally. `execute()` returns an async iterable either way, so
   a throw would surface at the same moment the event does — while breaking the invariant.
3. `AdapterInitError` is the exact precedent: "before any event stream work", yet delivered
   as an event with `phase: "'init'` in all four adapters.
4. The "know before you dispatch" guarantee has a different owner: the synchronous
   `probeToolGating()`, which is the whole reason M18 rejected a hook.

## Suggestion

Two edits so the next implementer does not have to redo this analysis:

1. In the `AdapterToolPolicyError` section, make delivery explicit — something like:
   *"Like the rest of the hierarchy, delivered as `{ type: "'error', error }` with phase
   `init`. **Pre-dispatch describes the moment of decision, not the channel**: nothing
   reaches the SDK. A consumer that must decline before calling `execute()` uses
   `probeToolGating()`."*
2. Reword "throw before dispatch" -> "**refuse** before dispatch" in the degradation
   section, and "none -> throws" -> "none -> refuses" in the support matrix. The intended
   contrast there is *refusal vs. warning* (M18 vs. M15), not *exception vs. event* — the
   word "throw" is carrying a distinction it was never meant to carry.

Worth adding an AC to close the gap outright, e.g.: *"An unenforceable group produces a
stream consisting of exactly one `error` event at phase `init`, with no `result`, and the
iterator never throws."* Nothing currently pins the delivery channel, so either
implementation would pass today's ACs.

