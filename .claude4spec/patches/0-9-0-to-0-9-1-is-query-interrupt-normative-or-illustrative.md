---
type: patch
brief: 0-9-0-to-0-9-1.md
patch_kind: clarification
created_at: '2026-07-27T22:47:54.692Z'
created_by: unknown
status: completed
---
# Patch — is Query.interrupt() normative or illustrative

## What I found

Brief §2d states, as a consequence of driving every run through an input channel, that "`Query.interrupt()` is now available on **every** run (previously only on streaming runs), so `abort()` teardown works universally". The implementer section turns that into an imperative: "Use `Query.interrupt()` for teardown on all runs."

Those two readings differ, and the code had taken the first. Before this PR there was no reference to `interrupt` anywhere in `src/` — teardown was `abortController.abort()` plus closing the input channel, with outstanding user-input requests settled `cancel`. That already satisfied the normative M13 guarantee (the run terminates, `AdapterAbortError` / `AdapterTimeoutError` is yielded, nothing leaks), and the unit and live e2e abort/timeout scenarios proved it.

I implemented `interrupt()` anyway, since the brief names it — but deliberately as **fire-and-forget**, not awaited. Awaiting it would be unsafe in the one place it is called: it is a control-protocol round-trip over the same stdin that the next teardown line closes, so it can outlive its own transport and never settle. Awaiting would hand a potential hang to the path whose entire job is to end one. I pinned that a rejecting, synchronously-throwing, or entirely absent `interrupt()` still terminates the run.

## Suggestion

Say in A01 (or M13) which of these the spec means:

- **Illustrative** — `interrupt()` is one way to reach the guarantee, and an adapter that terminates by other means is conformant. Then the implementer sentence should read "may use", and the acceptance criterion stays behavioural.
- **Normative** — the engine must be asked to stop cooperatively before the transport dies. Then it is worth saying *why* (the CLI unwinds its turn instead of dying mid-write) and, importantly, that the call must not be awaited on the teardown path, with the reason above. Otherwise the natural implementation — `await query.interrupt()` inside `abort()` — reintroduces exactly the parked-run failure M13 was written to prevent.

The second reading is the more useful one, but only if it carries the fire-and-forget constraint with it.

