---
type: patch
brief: 0-9-0-to-0-9-1.md
patch_kind: missing
created_at: '2026-07-27T22:48:44.294Z'
created_by: unknown
status: completed
---
# Patch — M17 has no entry in the static capability matrix

## What I found

M17's degradation is "graceful absence": on codex, gemini and opencode no `background_task_*` event is ever emitted and `result` never carries `backgroundTasks`. The brief specifies that as a runtime property and asks that tests assert the absence rather than an error, which I implemented (`assertNoBackgroundTasks()` in the testing toolkit, wired into the codex/opencode fixture-replay suites and the codex/gemini/opencode live e2e).

What the brief is silent on is **static discoverability**. `src/capabilities.ts` exposes `architectureCapabilities(arch)` with one flag per capability that has a support matrix — `midTurnPush`, `imageInput`, `subagentDefinition`, `pathScope` — precisely so a consumer can choose a strategy up front without a trial call. M17 has no such flag, so a consumer cannot ask "will this adapter ever background work?" and must instead hard-code that only `claude-code` does.

That matters more here than for most capabilities, because the M17 consumer contract is a *loop shape*: "read the stream to `done`, not to the first `result`". A consumer that wants to keep the cheap early-exit for adapters that can never hold a session open has no supported way to know which those are. The absence contract tells it what it will *not* see, only after the run.

I did not add the flag — it is a public API addition the brief does not authorize.

## Suggestion

Add a `backgroundTasks: boolean` to the M17 support matrix and to `ArchitectureCapabilities` (`claude-code` and its provider variants `true`; codex, gemini, opencode `false`), and say in M17 what a consumer may conclude from `false`: that no `background_task_*` will arrive and that a `result` is always terminal, so the read-to-`done` loop is optional rather than required for that adapter.

Worth deciding at the same time whether the flag means "the adapter implements the M17 family" or "the underlying SDK can background work" — they coincide today, but a future adapter whose SDK backgrounds work before the adapter maps it would split them, and the answer determines which one the flag has to track.

