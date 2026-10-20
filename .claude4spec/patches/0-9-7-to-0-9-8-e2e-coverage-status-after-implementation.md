---
type: patch
brief: 0-9-7-to-0-9-8.md
patch_kind: missing
created_at: '2026-08-27T10:14:07.971Z'
created_by: unknown
applied: false
---
# Patch — e2e coverage status after implementation

## What I found

Two coverage facts the spec should record, now that the work has landed (draft PR #29, branch `feat/subagent-lifecycle-abort-flush`).

1. **claude-code's `abort` e2e row can flip back from `partial` to covered.** M12 downgraded it to "abort mid-stream is covered; the subagent leg … is not implemented yet". It is implemented and **verified live on sonnet-4.6**: `abort mid-stream with subagents in flight closes the lifecycle pair, exactly once` ran with real delegation (not an `[INCONCLUSIVE]` skip) and asserts pairing + at-most-once via the new `assertSubagentLifecycle`. The whole subagent/abort surface — 10 scenarios, including both subagent cells of the M17 wake-up matrix — was green in the same run.

2. **The gemini, opencode and codex legs are written but NOT verified live.** The analogous abort x subagent cases exist in `gemini.e2e.test.ts` / `opencode.e2e.test.ts`, and codex's "no subagent events on the aborted path either" case exists in `codex.e2e.test.ts`. All three collect cleanly under their skip gates; none was executed against a live model in this pass. If M12's scenario catalog marks per-adapter coverage, those cells should read as written-not-verified rather than covered — the honest state, and the same discipline the claude-code row was just downgraded under.

Also worth knowing for the next brief: there is **no unit-tier harness for gemini or opencode subagent streams** in this repo (no scripted SSE / ACP mock beside `gemini.normalize.test.ts` and `opencode.normalize.test.ts`). The flush on those two adapters is therefore pinned by inspection and by the e2e case only — where claude-code has 10 deterministic unit cases. If M12 wants the unit tier to be the real pin for this contract on every adapter, that harness is the missing piece and it is a brief of its own.

## Suggestion

Update the M12 coverage rows for the `abort` scenario: claude-code back to covered (with the live-verification note), and gemini / opencode / codex as written-not-verified. Consider a follow-up brief for a scripted gemini/opencode stream harness so the M06 flush is pinned deterministically there too.

