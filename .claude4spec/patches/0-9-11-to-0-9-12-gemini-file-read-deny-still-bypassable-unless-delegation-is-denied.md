---
type: patch
brief: 0-9-11-to-0-9-12.md
patch_kind: clarification
created_at: '2026-09-22T16:38:38.775Z'
created_by: unknown
applied: false
---
# Patch — gemini file-read deny still bypassable unless delegation is denied

## What I found
The brief says to name `codebase_investigator`, `cli_help`, `generalist` and `confucius` in gemini's `delegation` group. It also says that until they are named, a `file-read` deny is bypassable via a spawned helper. Naming them under `delegation` closes the hole only when `delegation` is denied as well. A `file-read`-only deny on gemini is still bypassable through `codebase_investigator`. Unlike opencode, nothing folds file-read into delegation.

## What I shipped
- The names, verified in gemini-cli-core 0.38.2.
- An escape surface on gemini's `file-read` matrix row saying "deny delegation too". `probeToolGating` reports it.
- A README note.

## Suggestion
Decide whether gemini should fold like opencode (file-read ⇒ delegation), or whether the documented escape surface is the intended end state. Either way, state it in M18/A04.

