<!-- anchor: gs9qkh5p -->
# M06 — Subagents

> One lifecycle for sub-agents regardless of whether the SDK has a native subagent concept — observe `subagent_*` events, group interleaved deltas by `taskId`, and (where supported) define subagents up front.

<!-- anchor: 70dpqgcb -->
## Purpose

Developers can watch and group sub-agent activity uniformly: when an agent spawns a helper, M06 surfaces `subagent_started` / `subagent_progress` / `subagent_completed`, and marks the interleaved `text_delta` / `thinking` / `tool_use` of that helper with `isSubagent` and (where the SDK allows) `subagentTaskId`. It also owns subagent *definition* (`SubagentDefinition`, `validateSubagents`) for adapters that accept declared subagents. Per the one-home rule, M06 owns **the per-adapter subagent support matrix**.

<!-- anchor: 7tmzge8v -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `subagent_started`/`_progress`/`_completed`; `isSubagent` + optional `subagentTaskId` on deltas. |
| L2 | Owns the subagent support matrix (native vs. synthesized; taskId-on-deltas). |
| L4 | Exports `SubagentDefinition`, `validateSubagents`. |
| M09 | `splitBySubagent` groups a collected stream by subagent using these fields. |

<!-- anchor: 0f6287ae -->
## Unified Contract (L1)

- Lifecycle: `subagent_started { taskId, description, toolUseId }`, `subagent_progress { taskId, description, lastToolName? }`, `subagent_completed { taskId, status, summary?, usage? }`.
- A subagent emits the **full** event stream (not just lifecycle); its deltas carry `isSubagent: true` and, when available, `subagentTaskId` matching the `subagent_started.taskId`. `subagentTaskId` is optional — consumers must handle `undefined`.

<!-- anchor: 1zx424gy -->
## Capability & Degradation (L2)

**Subagent support matrix** (canonical home — adapters link here):

| Behavior | claude-code | codex | gemini | opencode |
| --- | :---: | :---: | :---: | :---: |
| Lifecycle events | ✅ native `task_*` | ⚠️ synthesized | ⚠️ synthesized per `threadId` | ⚠️ synthesized |
| `subagentTaskId` on deltas | ✅ from `parent_tool_use_id` | ❌ no subagent concept | ✅ pass-through `event.threadId` | ⚠️ ordering-based (single active) |

Degradation: codex has no subagent concept, so `subagentTaskId` is never populated and lifecycle is at best synthesized; consumers relying on per-subagent grouping must tolerate its absence (skip strategy).

<!-- anchor: gz6lltyi -->
## Public API & Packaging (L4)

Exports `SubagentDefinition` and `validateSubagents` from the package root.

<!-- anchor: 4b8iv50p -->
## Edge cases

- Multiple subagents run concurrently on an adapter that can't populate `subagentTaskId` (opencode ordering-based) → deltas carry `isSubagent: true` but grouping by id is unavailable; consumers fall back to the single-active assumption.
- `validateSubagents` rejects a malformed `SubagentDefinition` → surfaced as a definition error before the run, not mid-stream.
- codex target with declared subagents → no native effect; treated per the matrix (no subagent concept).

<!-- anchor: o0e0wak5 -->
## Acceptance criteria

These verify lifecycle observability and that the optional `subagentTaskId` is always safe to read.

<tagged_list type="ac" tags="m06"/>
