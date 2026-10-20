---
type: patch
brief: 0-9-4-to-next.md
patch_kind: drift
created_at: '2026-08-24T15:43:48.662Z'
created_by: unknown
applied: false
---
# Patch — cap semantics changed: progress-based, terminal typed error

## What I found

The brief documents the cap as an absolute bound whose expiry produces a `warning`, and the same description is baked into the code's own doc comments (`MAX_BACKGROUND_HOLD_MS`, `claude_backgroundHoldCapMs` in `src/options.ts`) and, presumably, into M17 / A01 in the specification. After this release none of that is true any more:

- the cap measures a **stall**, not elapsed wall-clock time: it is re-armed by subagent output (`parent_tool_use_id` set) and by `task_started`/`task_updated`/`task_notification`, and deliberately NOT by `system/status` or `system/background_tasks_changed`;
- expiry **ends the run** with a typed terminal `AdapterBackgroundHoldExpiredError` (new exported class, carries `capMs`, survives JSON.stringify). There is no cap warning any more;
- `touchedATask()` no longer latches for the whole run — it answers yes for work in flight or settled since the last turn boundary, and `TaskRegistry` gained `markTurnBoundary()`;
- `BackgroundHold.drainWarnings()` is **removed**, and `createBackgroundHold`'s `closeChannel` dep is replaced by `onExpire(reason: 'grace' | 'cap')`. Both are exported, so this is a breaking change to a documented surface;
- `RuntimeAdapter.abort()` on the claude-code adapter now stops **every** run in flight, not just the most recent, because run state moved into a per-`execute()` context;
- `McpSdkServerConfig.instance` now carries a one-instance-per-`execute()` contract that the adapter enforces eagerly at init.

Draft PR: InHarness/agent-adapters#24.

## Suggestion

M17's capability description and A01's adapter notes need to be re-authored around the new invariant — "a cap expiry must not produce a live CLI session with a closed host control channel" — rather than around "a bounded wait that warns". Concretely, the spec-side pieces I think need entities/AC of their own:

1. The two expiry outcomes are **opposites**, not severities: `grace` closes the channel (normal end of a task-touching run), `cap` terminates the run. Worth an AC each.
2. `AdapterBackgroundHoldExpiredError` is a new consumer-visible error alongside `AdapterAbortError` / `AdapterTimeoutError`; the error taxonomy in the unified layer should name it, including that `name` and `capMs` are what a remote consumer branches on over SSE.
3. The cap's re-arm predicate (what counts as progress vs a heartbeat) is a behavioural contract that a future SDK could break silently — it deserves to be canon, not just a code comment.
4. The breaking hold-API change and the new `abort()` semantics probably want a note in whatever the spec says about versioning/compatibility.

