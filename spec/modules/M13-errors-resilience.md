<!-- anchor: y6g4wtb0 -->
# M13 — Errors, resilience & process hardening

> A structured error hierarchy that distinguishes "couldn't start" from "failed mid-run", survives timeout and abort cleanly, and hardens the process against hostile hosting environments — all surfaced as `error` events, never thrown out of the stream.

<!-- anchor: 1c0ve8zr -->
## Purpose

Developers can reason about failure precisely: was it initialization (bad credentials, unknown provider) or runtime (the model errored)? Did the run time out or was it aborted? M13 owns the `AdapterError` hierarchy (`AdapterInitError`, `AdapterTimeoutError`, `AdapterAbortError`, `AdapterBackgroundHoldExpiredError`), the init-vs-runtime phase distinction, OS-field hoisting and `toJSON` for safe serialization, and the operational hardening that keeps the library working under constrained hosts (Passenger/CageFS stdin guard). Errors are always yielded as `error` events.

<!-- anchor: br8rzz4u -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | Errors are the `error` event payload; never thrown out of the iterator. |
| L4 | Exports the `AdapterError` classes. |
| M03 | `AdapterInitError` is the failure mode for missing provider credentials. |
| every adapter | Maps SDK failures, timeout, and abort onto this hierarchy. |

<!-- anchor: 8q9q7ty7 -->
## Unified Contract (L1)

- **`AdapterError` hierarchy** — base `AdapterError` plus `AdapterInitError` (failed to start: credentials/config/provider), `AdapterTimeoutError` (`timeoutMs` exceeded), `AdapterAbortError` (`abort()` called), `AdapterBackgroundHoldExpiredError` (the control-channel hold's hard cap expired — M17, <section_ref anchor="q9u5sbot"/>), and `AdapterToolPolicyError` (a requested tool-gating policy cannot be enforced on this adapter — M18, <section_ref anchor="1yllld10"/>).
- **Every terminal condition gets its own class, and the classes must stay apart.** Three of the four above end a *live* run, and a consumer's correct reaction differs in each: a consumer `abort()` is expected and needs no reporting; a consumer `timeoutMs` says the budget was too small; a hold-cap expiry says the *engine's* background work stalled and some of it was abandoned unfinished. Collapsing any two of them into one class, or into an untyped `warning`, forces the consumer to parse a message string to tell them apart. So each is distinguishable **both** by class (`instanceof`) and by its `name` — which, unlike the class, survives serialization across a process or transport boundary — and each carries the datum a consumer needs to act: `AdapterBackgroundHoldExpiredError` carries the cap that was hit as a field, repeats it in the human-readable message, and names the `architectureConfig` key that moves it. `toJSON` carries the extra field through, so a logged error is as actionable as a caught one.
- **`AdapterToolPolicyError` is the one class raised *before* anything runs.** The other four end or fail a live run; this one refuses to start it, because a capability gate that cannot be honoured must be discovered while the consumer can still decline. It is a *refusal*, not a failure, and it carries what a consumer needs to decide what to do instead: the adapter id, the groups that are unenforceable, and the enforceable groups with their strength. Same rules as the rest of the hierarchy — distinguishable by `instanceof` and by `name`, with `toJSON` carrying the extra fields through. It is raised on an invalid request too (an unknown group string), for the same reason: silently dropping an unrecognized entry from a security policy would enforce less than was asked for.
- **Phase** — each error records whether it occurred in the *init* or *runtime* phase, so consumers can retry vs. fix-config appropriately.
- **Serialization** — OS error fields (`errno`/`code`/`syscall`) are hoisted onto the error, and `toJSON` produces a stable, loggable shape.
- **Delivery** — emitted via `{ type:'error', error }`; the iterator never throws.

<!-- anchor: 9dv305bn -->
## Public API & Packaging (L4)

Exports `AdapterError`, `AdapterInitError`, `AdapterTimeoutError`, `AdapterAbortError`, `AdapterBackgroundHoldExpiredError`, `AdapterToolPolicyError` from the package root. A typed error a consumer is expected to branch on is useless if it cannot be named in a `catch` or an `instanceof` — so every class in the hierarchy is exported, not only the base.

<!-- anchor: 1vd9sye5 -->
## Edge cases

- `timeoutMs` exceeded → `AdapterTimeoutError` (runtime phase); the SDK run is stopped.
- `abort()` mid-run → `AdapterAbortError` or natural iterator completion; no dangling SDK process.
- **`abort()` / `timeoutMs` while a `user_input_request` is unanswered** → still terminates. A consumer's `onUserInput` handler routinely resolves only when a human answers (an HTTP round-trip, a UI dialog), which may be never; an adapter that simply awaits it parks the run forever, holding its session *and* its SDK subprocess — the "no dangling SDK process" rule above, violated in the one case where the consumer cannot recover by itself. Adapters MUST race the abort signal against every consumer handler they await: on abort the outstanding request is answered `cancel` (so the SDK-side promise settles instead of leaking), the stream yields `AdapterAbortError` / `AdapterTimeoutError`, and teardown runs. A wedged session of this kind is invisible in logs and appears to "heal on restart", which is why it is specified rather than left to implementation care.
- **The control-channel hold's cap expires (M17)** → `AdapterBackgroundHoldExpiredError` (runtime phase), and it is **terminal**: the adapter interrupts and aborts the session down the same path `abort()` uses, and nothing follows the `error` event. Ending the run is the point — the alternative it replaced, closing the control channel and letting the live session carry on, produced a run that looked healthy while every host-side control path behind that channel was silently dead. A half-dead session is a worse failure than a failed one, so this bound fails loudly. Why an `error` rather than a `warning` is argued in M17 (<section_ref anchor="q9u5sbot"/>); the class, the `name`, and the `capMs` payload are M13's obligation.
- **stdin guard** — under cPanel/Passenger or CageFS, the claude-code SDK's stdin Socket init raises `open EEXIST`; the hardening replaces `process.stdin` with an empty `Readable` **before the SDK loads**, so it is not a filesystem bug but a stdin-initialization workaround.
- Missing credentials / unknown provider → `AdapterInitError` (init phase) before any event stream work.
- **inert-harness-tool → silent lost work** — a tool that belongs to the *interactive* harness rather than the SDK (the claude-code scheduling family: `ScheduleWakeup`, `Cron*`, `/loop`) is inert under headless drive: it accepts the call, ends the turn, and never fires — dropping the requested work with **no error to catch**. This is a resilience failure class distinct from init/runtime faults (nothing throws, nothing is emitted). The mitigation is prevention, not recovery: the adapter hard-suppresses such tools so the model cannot request the lost work (mechanism owned by A01 — see <section_ref anchor="sw3cwrsm"/>).

<!-- anchor: ioxlu1bw -->
## Acceptance criteria

These verify the phase distinction, that errors are events not throws, and that the stdin hardening prevents the EEXIST crash.

<tagged_list type="ac" tags="m13"/>
