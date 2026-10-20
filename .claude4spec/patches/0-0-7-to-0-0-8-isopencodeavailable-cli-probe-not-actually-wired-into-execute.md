---
type: patch
brief: 0-0-7-to-0-0-8.md
patch_kind: drift
created_at: '2026-07-15T10:48:55.662Z'
created_by: unknown
status: awaiting
---
# Patch — isOpencodeAvailable() CLI probe not actually wired into execute()

## What I found
The brief says for opencode: "keep the existing `isOpencodeAvailable()` / `which opencode` CLI probe as a *separate* fault" — phrasing that assumes this probe is already an active init-time check distinct from the version gate.

In the actual codebase, `isOpencodeAvailable()` (src/adapters/opencode.ts) is **not called anywhere inside `execute()`**. It's exported only as a standalone helper, used solely to gate whether e2e tests run (`const HAS_CLI = isOpencodeAvailable();` in opencode.e2e.test.ts). It has never been wired into the adapter's init path.

## Suggestion
Left `isOpencodeAvailable()` untouched in this brief's implementation — newly wiring it into `execute()` as an active init-time fault would be a scope expansion beyond "keep... as a separate fault", which reads as preservation, not addition. A future brief should explicitly decide whether opencode's `execute()` should call `isOpencodeAvailable()` and emit a distinct `AdapterInitError` when the CLI binary is missing (today a missing `opencode` binary is only caught downstream when the SSE client actually tries to connect, not surfaced as a clean init fault).

