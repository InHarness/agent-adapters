---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: drift
created_at: '2026-09-22T22:29:37.450Z'
created_by: unknown
applied: false
---
# Patch — AdapterIdleTimeoutError was already exported from the root

## What I found
The brief asks to verify whether `AdapterIdleTimeoutError` was reachable from the package entry point before 0.9.13. It was: `src/index.ts` already exported it from the root in 0.9.12, between `AdapterTimeoutError` and `AdapterAbortError`. There was no packaging gap to close. Only the spec's export list was stale.

## Suggestion
Treat the export-list change for `AdapterIdleTimeoutError` as a spec catch-up, not a code fix. A root-export unit test now pins all nine classes.

