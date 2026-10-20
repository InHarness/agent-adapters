---
type: patch
brief: 0-9-11-to-next-abort-race-opencode-gemini.md
patch_kind: incorrect
created_at: '2026-09-22T17:35:23.726Z'
created_by: unknown
applied: false
---
# Patch — stale paths/lines; idle clock already shipped

## What I found
The brief was written against HEAD 9a7e0f5 / 0.9.10, but the tree is at ba46d58 / 0.9.12:
- The adapters live at `src/adapters/opencode.ts` / `src/adapters/gemini.ts`, not `src/*.ts`. None of the quoted line numbers match.
- §6 calls `idleTimeoutMs` a separate, unreleased effort to stay out of. It had already shipped in 0.9.11 (`src/idle-clock.ts`, `AdapterIdleTimeoutError`) and is wired into both pump loops. The fix therefore had to keep `idle.clock.begin/end` balanced around the raced handler, and an idle expiry takes the same stop path, ending in `AdapterIdleTimeoutError`.
- §3 says there is no 0.10.0. That is correct, and the claude-code fix it refers to is present.

## Suggestion
Pin briefs to the HEAD they are generated against, and treat idle expiry as a third stop source alongside abort() and timeoutMs in M13's 'still terminates' bullet.

