---
type: plan
title: Background tasks (run_in_background) — spec coverage
created_at: '2026-07-23T18:48:40.302Z'
created_by: agent
---
# Background & long-running shell tasks — spec coverage

Scope: spec only (`spec/`). Code follows via a release brief, not here.

<!-- anchor: qbnnzugt -->
## Locked decisions

1. **Resume model = PUSH (keep session alive).** `execute()` must not be treated as terminated at `result`; the SDK holds `query()` open while `background_tasks[]` is non-empty, emits `task_notification` on settle, and wakes the model → new turn → new `result`. Consumers keep iterating to generator `done`. No external watcher/backoff in the blessed path (pull/backoff documented only as an out-of-scope alternative).
2. **New event family + new module.** Add a decoupled `background_task_started/progress/completed` family (routed by `task_started.task_type` = `'shell'`/`'monitor'`/`'workflow'`); `subagent_*` stays for real Task subagents. New capability-module **M17 — Background & long-running tasks**. Conscious step to 17 modules (past the 8–15 band) — noted in index.

<!-- anchor: 0tm1oypd -->
## Findings (verified in code, 2026-07-23)

- **Agent never runs "in the background" — only the shell process does.** SDK collapses shell + subagents onto one `task_*` channel; that overload is the source of the confusion.
- **Decoupling is feasible at mapping time.** `SDKTaskStartedMessage.task_type?` (+ `subagent_type?`, `workflow_name?`), `sdk.d.ts:3667`. Adapter reads only `task_id` today (`claude-code.ts:1204-1232`) and drops `task_type`. `task_progress`/`task_notification` carry only `task_id`/`status`/`output_file`/`summary`/`usage` → need `Map<task_id, task_type>` populated on `task_started`.
- **Push already flows through our loop.** `execute()` ends only on iterator `done` (`claude-code.ts:1042`), not on `result`. SDK keeps query alive on non-empty `background_tasks[]` ("session paused waiting for background work to wake it").
- **Real env-runner bug:** consumer treats first `result` as terminal, stops iterating → never sees completion → waits full timeout.
- **No disable lever:** `run_in_background` is a Bash param; only a synthesized `PreToolUse` deny-hook can forbid it.
- **Unused control:** `Query.stopTask()` / `backgroundTasks()` / `is_backgrounded` — adapter calls none.
- **Doc drift (flag only):** claude-code-sdk skill says `task_notification → subagent_progress`; code says `subagent_completed`.

<!-- anchor: uvp3wqk1 -->
## Pre-execution verification (2026-07-23)

- Tag convention confirmed via `list_tags`: `mNN` + `mNN-edge` per module, `aNN` + `aNN-edge` per adapter. **`m17`/`m17-edge` do not exist yet** → `create_tag` both before tagging AC. Adapter-side AC go under existing `a01`.
- `search_entities("background", type=ac)` → empty. No existing AC touches background tasks — clean field, no collisions.
- `spec/modules/` holds M01–M16, all single files → M17 lands as **`spec/modules/M17-background-tasks.md`** (single file, module template).

<!-- anchor: g46kr5a7 -->
## Plan

1. **M01 unified-core** — (a) add `background_task_started/progress/completed` to the event taxonomy (fields: `taskId`, `taskType`, `description`/`status`, `outputFile`, `summary?`, `usage?`); (b) add an in-flight signal on `result` (`inFlight: boolean` / `backgroundTasks[]`); (c) document the contract rule: **`result` is not terminal while background tasks are in flight — consume `execute()` to generator `done`**. Per-adapter support notes.
2. **M17 (new) — Background & long-running tasks** — create `spec/modules/M17-background-tasks.md` (module template): SDK single task channel + `task_type` values; PUSH resume mechanics (SDK wake → model self-continues; consumer just keeps iterating); `output_file` as tail target; stop/disable levers; explicit note that agent≠background (only shell backgrounds). Document pull/backoff+`resume` as an out-of-scope alternative, not the blessed path. Cross-link A01, M06, M07. `## Acceptance criteria` embeds `<tagged_list type="ac" tags="m17"/>` + edge cases under `m17-edge`.
3. **M06 subagents** — scope explicitly to REAL Task subagents; pointer that background shell tasks are decoupled to M17 and no longer share `subagent_*`; update mapping table.
4. **A01 claude-code** — expand adapter doc: `task_type` capture + `Map<task_id,task_type>` routing; `task_notification` fields; loop-ends-on-`done`-not-`result` + SDK-holds-open-on-`background_tasks[]`; disable recipe (`PreToolUse` deny-hook, propose `architectureConfig.claude_disallowBackgroundBash: true`); known gaps (dropped `task_type`, unused `stopTask()`/`backgroundTasks()`).
5. **AC (entities)** — first `create_tag` `m17` + `m17-edge` (convention-matching colors); then create AC: (a) `run_in_background` completion surfaces as `background_task_completed` with correct `taskId`/`status`/`outputFile`; (b) `result` while background work in flight carries the in-flight signal and `execute()` yields the completion before `done`; (c) disable-background option forces synchronous execution / denies the backgrounded call. Tagging: module AC → `m17` (kind requirement) / `m17-edge` (kind edge-case), M01 contract AC → `m01`, adapter-side AC → `a01`.
6. **index.md** — add M17 to the module table (layers touched, one-line summary), bump module-count note, sync AC references.
7. **Flag only (no edit):** claude-code-sdk skill drift.

<!-- anchor: bryameky -->
## Non-goals

- No `src/` edits, no hook/BashOutput implementation, no tests — those flow through the brief → implementer pipeline.
