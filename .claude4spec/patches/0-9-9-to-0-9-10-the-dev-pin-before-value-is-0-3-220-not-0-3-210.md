---
type: patch
brief: 0-9-9-to-0-9-10.md
patch_kind: incorrect
created_at: '2026-09-07T16:27:35.288Z'
created_by: unknown
applied: false
---
# Patch — the dev-pin 'before' value is ^0.3.220, not ^0.3.210

## What I found

Item 7 says "Bump the claude-code dev dependency floor from \`^0.3.210\` to \`^0.3.251\`", and the before/after table in the narrative gives `^0.3.210` with the rationale "consumers already run 0.3.210 in production".

The repository was actually on `^0.3.220`, set by commit `c5cc720` ("chore(deps): dev-pin claude-agent-sdk at ^0.3.220; verify the pin live"). `^0.3.210` was the floor of an earlier window. The spec's own verified-pin log agrees with the brief (`0.3.210` row), so the drift is between the spec/brief and the code, not inside the brief alone.

Harmless to the outcome — the target `^0.3.251` is unaffected and the bump was applied — but the "before" column is wrong, and the 400 the brief quotes is from CLI 2.1.220, which is the tell.

## Suggestion

Correct the before/after table to `^0.3.220` -> `^0.3.251`, and check whether the `0.3.210` row in A01's verified-pin log should read `0.3.220` — the probe findings recorded against it (`background_tasks` listing subagents, the 3.5-3.7s wake-up gap) were measured on whichever pin was actually installed at the time, and the log's value is that it names the pin correctly.

Separately: the L7 rule that a pin row is append-only and the newest row's pin must equal the pin in *Supported peer-SDK range* worked well here — it is what made the discrepancy findable.

