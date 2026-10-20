---
type: patch
brief: 0-0-7-to-0-0-8.md
patch_kind: missing
created_at: '2026-07-15T10:49:34.584Z'
created_by: unknown
status: awaiting
---
# Patch — brief doesn't specify behavior when installed version is undeterminable

## What I found
Neither the brief nor its two formal acceptance criteria specify what should happen when the installed peer-SDK version **cannot be determined at all** (e.g. an unusual package-manager layout where the node_modules walk finds nothing). The brief only covers 'outside range' → hard fail and 'inside range' → defensive read; 'undeterminable' is a third case it doesn't address.

## Suggestion
Implemented as: treat an undeterminable version as a gate **failure** (fail closed), consistent with the 'hard, non-suppressible' framing of the gate elsewhere in the brief — silently proceeding when we can't even confirm the SDK is in range would undermine the whole point of the gate. The resulting `AdapterInitError` message reads "<pkg>: could not determine installed version (requires <range>)", distinguishable from an actual out-of-range mismatch. Suggest the spec explicitly document this third case (undeterminable → fail closed) in L7 alongside the two existing regimes.

