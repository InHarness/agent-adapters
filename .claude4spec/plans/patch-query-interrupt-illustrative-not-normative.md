---
type: plan
title: 'Patch — Query.interrupt() illustrative, not normative'
created_at: '2026-07-28T08:53:45.321Z'
created_by: agent
---
# Patch — `Query.interrupt()` is illustrative, not the teardown mechanism

<!-- anchor: qd6d2kcu -->
## Decision (grounded in the shipped code)

The user asked to let the **code** answer. It does, unambiguously:

- `src/adapters/claude-code.ts` `abort()` (l.523–525) does **only** `abortController.abort()` + `closeInputChannel()`; the outstanding `user_input_request` is settled `cancel` via the abort race (l.817–828). **`interrupt()` is never called** — grep of `src/` = 0 hits.
- The code skill `claude-code-sdk` (l.44) states the adapter "does not call those control methods" (streamInput/interrupt/setModel).
- M13 + every abort/timeout AC are **purely behavioural** and never mention `interrupt()`.

→ The spec means the **illustrative** reading. The M13 guarantee is behavioural; `interrupt()` is *not* required and is *not* the teardown mechanism. The current A01 wording over-claims it as such — exactly the ambiguity the patch flags. Fix the wording; keep AC behavioural.

<!-- anchor: sxs4bstd -->
## Edits

1. **A01 — Abort/timeout (M13) bullet (anchor `sw3cwrsm`, l.58).** Rewrite so it describes the *actual* teardown: fire the abort signal (breaks every await, incl. the raced `onUserInput`), answer the outstanding request `cancel` (settles the SDK-side promise), close the input channel → run yields `AdapterAbortError`/`AdapterTimeoutError`, no dangling subprocess. Add the constraint the patch asks to preserve: the guarantee does **not** depend on cooperatively interrupting the engine; `Query.interrupt()` is a control round-trip over the same stdin that teardown then closes, so **it must not be awaited on the teardown path** (awaiting it can outlive its transport and never settle — reintroducing exactly the parked-run failure M13 prevents). If used at all it is **fire-and-forget**; a rejecting, throwing, or absent `interrupt()` still terminates the run.

2. **A01 — background-tasks bullet (anchor `sw3cwrsm`, l.72).** The sentence "This also restores the streaming-only control surface (`Query.interrupt()`) on ordinary runs." is factually about *availability* (channel path makes it callable everywhere) — keep it, but adjust so it no longer implies teardown *uses* it: note availability ≠ requirement, adapter teardown does not depend on it (see the Abort/timeout bullet).

<!-- anchor: 8oceluz7 -->
## Non-changes (deliberate)

- **M13 stays the behavioural home.** Edge case `y6g4wtb0`/`1vd9sye5` (l.39) and the ACs already describe abort/timeout purely by outcome — correct, leave untouched.
- **No AC mutation.** `ac-abort-terminates-a-run-whose-onuserinput`, `ac-after-abort-the-run-ends-with-adaptera`, `ac-for-claude-code-timeoutms-yields-adapte` remain behavioural.
- **No entity mutations** → no rename/delete impact sweep needed. Scope is two prose edits in `spec/adapters/A01-claude-code.md`.

<!-- anchor: znxnghuc -->
## After execution

Report the two edits; patch is ready for the user to mark `completed` in the C4S UI.
