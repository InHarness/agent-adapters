<!-- anchor: y6g4wtb0 -->
# M13 — Errors, resilience & process hardening

> A structured error hierarchy that distinguishes "couldn't start" from "failed mid-run", survives timeout and abort cleanly, and hardens the process against hostile hosting environments — all surfaced as `error` events, never thrown out of the stream.

<!-- anchor: 1c0ve8zr -->
## Purpose

Developers can reason about failure precisely: was it initialization (bad credentials, unknown provider) or runtime (the model errored)? Did the run time out or was it aborted? M13 owns the `AdapterError` hierarchy (`AdapterInitError`, `AdapterTimeoutError`, `AdapterAbortError`), the init-vs-runtime phase distinction, OS-field hoisting and `toJSON` for safe serialization, and the operational hardening that keeps the library working under constrained hosts (Passenger/CageFS stdin guard). Errors are always yielded as `error` events.

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

- **`AdapterError` hierarchy** — base `AdapterError` plus `AdapterInitError` (failed to start: credentials/config/provider), `AdapterTimeoutError` (`timeoutMs` exceeded), `AdapterAbortError` (`abort()` called).
- **Phase** — each error records whether it occurred in the *init* or *runtime* phase, so consumers can retry vs. fix-config appropriately.
- **Serialization** — OS error fields (`errno`/`code`/`syscall`) are hoisted onto the error, and `toJSON` produces a stable, loggable shape.
- **Delivery** — emitted via `{ type:'error', error }`; the iterator never throws.

<!-- anchor: 9dv305bn -->
## Public API & Packaging (L4)

Exports `AdapterError`, `AdapterInitError`, `AdapterTimeoutError`, `AdapterAbortError` from the package root.

<!-- anchor: 1vd9sye5 -->
## Edge cases

- `timeoutMs` exceeded → `AdapterTimeoutError` (runtime phase); the SDK run is stopped.
- `abort()` mid-run → `AdapterAbortError` or natural iterator completion; no dangling SDK process.
- **stdin guard** — under cPanel/Passenger or CageFS, the claude-code SDK's stdin Socket init raises `open EEXIST`; the hardening replaces `process.stdin` with an empty `Readable` **before the SDK loads**, so it is not a filesystem bug but a stdin-initialization workaround.
- Missing credentials / unknown provider → `AdapterInitError` (init phase) before any event stream work.
- **inert-harness-tool → silent lost work** — a tool that belongs to the *interactive* harness rather than the SDK (the claude-code scheduling family: `ScheduleWakeup`, `Cron*`, `/loop`) is inert under headless drive: it accepts the call, ends the turn, and never fires — dropping the requested work with **no error to catch**. This is a resilience failure class distinct from init/runtime faults (nothing throws, nothing is emitted). The mitigation is prevention, not recovery: the adapter hard-suppresses such tools so the model cannot request the lost work (mechanism owned by A01 — see <section_ref anchor="sw3cwrsm"/>).

<!-- anchor: ioxlu1bw -->
## Acceptance criteria

These verify the phase distinction, that errors are events not throws, and that the stdin hardening prevents the EEXIST crash.

<tagged_list type="ac" tags="m13"/>
