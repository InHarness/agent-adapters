---
type: patch
brief: 0-9-7-to-0-9-8.md
patch_kind: missing
created_at: '2026-08-27T14:34:31.518Z'
created_by: unknown
applied: false
---
# Patch — flush obligation is every run-ending path, not only run-level termination

## What I found

The brief scopes the flush obligation to **run-level termination**: `abort()`, `timeoutMs`, a background hold-cap expiry. Implemented that way, the defect survived on two further paths that a review of the PR surfaced — and the conformance assertion the same brief asks for (`assertSubagentLifecycle`) claims pairing holds "on every terminal path", so the assertion over-claimed what the adapters delivered:

1. **The SDK stream throws for a reason of its own** — transport failure, CLI crash. Not an abort, not a timeout, so it took the generic error branch, which had no flush. Same unmatched pair, sixth exit path. Present on all three adapters (claude-code's non-abort `catch`, gemini's fatal `error` event and non-abort `catch`, opencode's `session.error` and non-abort `catch`).
2. **The run ends NORMALLY with a delegation the engine never reported on.** claude-code's `error_max_turns` closes the input channel while an Agent-tool `task_notification` is still seconds away (the SDK returns the Agent `tool_result` at dispatch; notifications land 7–19 s later). Same for gemini's ordinary `agent_end` → `result` and opencode's `session.idle` → `result`. Once the generator returns, nothing can ever close that pair.

I implemented the flush on all of them. On path 2 it stands alone — it emits `subagent_completed { status: 'aborted' }` with **no terminal error after it**, which is the one case the brief's framing did not anticipate, and which the vocabulary's definition of `'aborted'` ("a terminal `error` follows immediately") currently contradicts. It is also unit-pinned now.

## Suggestion

Restate the obligation in M06 as **"every run-ending path"** rather than "run-level termination", and enumerate the three families: terminal reason (abort/timeout/hold-cap), an SDK-side throw, and ordinary completion with a delegation still open. The invariant a consumer actually depends on is *"this generator never returns leaving a started event unmatched"* — which is stronger than, and cleaner than, the reason-by-reason list.

Then reconcile the vocabulary: either soften `'aborted'`'s "a terminal `error` follows immediately" (it does not, on the ordinary-completion path), or introduce a distinct value for "the run ended before this delegation was reported on". Softening looks right — a fifth value buys a distinction few consumers would branch on, and the flush's real meaning is already "this run stopped tracking that delegation", not a claim about the helper agent.

Related: [rule 2 cancellation-shaped default](0-9-7-to-0-9-8-rule-2-cancellation-shaped-default-conflicts-with-the-run-level-meaning-of-abort.md) touches the same definition from the other side.

