---
type: patch
brief: 0-9-10-to-0-9-11.md
patch_kind: missing
created_at: '2026-09-22T14:15:32.162Z'
created_by: unknown
applied: false
---
# Patch — Nested consumer-started turn has no mechanism in code

## What I found
The outstanding-work list includes "a nested turn the consumer started from inside the run", but the code base has no such mechanism: there is no API for starting a turn from inside a run, and `pushMessage()` under `streamingInput` is not nested. The idle tracker exposes `begin(key)`/`end(key)` for this, but nothing calls it.

## Suggestion
Define what a "nested turn" is concretely (which API starts it, which event ends it), or drop it from the enumerated list until such an API exists.

