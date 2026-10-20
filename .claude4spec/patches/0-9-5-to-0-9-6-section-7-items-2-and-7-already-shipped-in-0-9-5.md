---
type: patch
brief: 0-9-5-to-0-9-6.md
patch_kind: drift
created_at: '2026-08-25T13:31:49.983Z'
created_by: unknown
applied: false
---
# Patch — section 7 / items 2 and 7 already shipped in 0.9.5

## What I found

Brief `0-9-5-to-0-9-6.md` section 7 ("Background-task hold cap is now terminal") and
implementer items 2 and 7 describe work that **already shipped in 0.9.5**, before this
brief was generated. Implementing them was a no-op.

Specifically, at `main` (728ba37) the code already had:

- `AdapterBackgroundHoldExpiredError` — `src/types.ts:997`, with the literal `.name`, the
  `capMs` field and the `override toJSON()` the brief asks for.
- Its export from the package root — `src/index.ts:46`.
- Terminal hard-cap expiry — `src/adapters/claude-code.ts:1266-1290`: `onExpire` returns
  early and closes the channel for `reason === "grace"`, and for the cap calls
  `this.interruptRun(run)` + `run.abortController.abort()`, with the typed error chosen by
  `terminalRuntimeError()` (`:1142-1148`) and yielded at `:1918` / `:1926`.
- The strengthened e2e silence assertions — `src/testing/e2e/claude-code.e2e.test.ts:769-793`
  already asserts BOTH that a healthy run emits no hold-bound `warning` AND that no
  `AdapterBackgroundHoldExpiredError` appears.
- The conformance terminality exemption — `src/testing/contract.ts:61-74` already reads the
  last non-`flush`, non-`warning` event.

Git history confirms it: 614b0e4 "fix(claude-code): a cap expiry must never leave a
half-dead session (M17)", 65191d2, 728ba37 — all tagged 0.9.5.

The only genuinely new item in that part of the brief was the "export ALL SIX error
classes" instruction, which reduced to adding `AdapterToolPolicyError` (the other five
were already exported).

## Suggestion

The release-diff generator appears to have folded M13/M17 entity edits made *during* the
0.9.5 window into the 0.9.5 -> 0.9.6 brief. Worth checking whether the diff window is
keyed on entity `updatedAt` rather than on which release actually shipped the change.

For the brief itself: a section describing already-shipped work costs an implementer a
full verification pass to discover it is a no-op, and — more dangerously — invites a
re-implementation that regresses working code. If a release-diff brief must mention prior
work for narrative continuity, marking it explicitly as "already shipped in <release>,
listed for context" would remove the ambiguity.

One genuinely useful thing did come out of section 7: the M13 contract clarification that
"a `warning`'s position on the stream carries no meaning at all" is already honoured by
`contract.ts`, so that part of the spec and the code agree.

