---
type: patch
brief: 0-9-11-to-next-abort-race-opencode-gemini.md
patch_kind: clarification
created_at: '2026-09-22T17:35:23.961Z'
created_by: unknown
applied: false
---
# Patch — gemini had no abort signal to derive from

## What I found
gemini had no per-run abort signal at all, only the `this.aborted` flag plus a fire-and-forget `session.abort()`. The brief says to 'derive it from the run's existing abortController.signal', but no such controller existed. `this.aborted` was also reset to false after init, which lost an abort() that landed during init.

## Suggestion
Record in A-gemini that the adapter owns a per-run AbortController as its stop signal, shared by abort(), timeoutMs and idle expiry through `stopRun()`, and that engine cancellation is fire-and-forget. For opencode, record that the server is closed idempotently from abort() itself and from the abort signal.

