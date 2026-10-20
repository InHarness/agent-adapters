---
type: patch
brief: 0-9-4-to-0-9-5.md
patch_kind: incorrect
created_at: '2026-08-25T10:06:15.397Z'
created_by: unknown
applied: true
---
# Patch — hold-bound warning no longer exists

## What I found

The new AC's fourth per-cell clause — "a healthy run emits **no** hold-bound `warning`
(the bounded-hold warning is a failure signal, not routine noise)" — describes a
mechanism the code no longer has.

Commit `614b0e4` ("a cap expiry must never leave a half-dead session (M17)", PR #24)
replaced the hold-bound warning with a typed terminal error. The adapter now emits no
`warning` on this path at all: on cap expiry it aborts the run and yields
`AdapterBackgroundHoldExpiredError` (`src/types.ts:997-1010`), selected through
`terminalRuntimeError()` (`src/adapters/claude-code.ts:1143-1148`). The grace-window
expiry closes the input channel silently (`claude-code.ts:1275-1291`). The only
`warning` events anywhere near this code are the OS-sandbox degradation and the
SDK-version check, both unrelated.

The consequence: the assertion the AC asks for passes **vacuously**. A cell can hit the
cap, be truncated with work unsettled, and still satisfy "no hold-bound warning".

## Suggestion

Restate the clause against the mechanism that exists: *a healthy run must not hit the
hold cap — no `AdapterBackgroundHoldExpiredError`, and the run ends on `result`, not on
a terminal `error`*. Keeping the warning-absence as a secondary regression guard is
reasonable (that is what the implementation does — both checks now sit side by side),
but it should not be the clause the AC leans on.

Worth checking whether other M17 criteria still speak of a warning where the typed
error now applies.

