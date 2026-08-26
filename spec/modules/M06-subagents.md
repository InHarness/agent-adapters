<!-- anchor: gs9qkh5p -->
# M06 — Subagents

> One lifecycle for sub-agents regardless of whether the SDK has a native subagent concept — observe `subagent_*` events, group interleaved deltas by `taskId`, and (where supported) define subagents up front.

<!-- anchor: 70dpqgcb -->
## Purpose

Developers can watch and group sub-agent activity uniformly: when an agent spawns a helper, M06 surfaces `subagent_started` / `subagent_progress` / `subagent_completed`, and marks the interleaved `text_delta` / `thinking` / `tool_use` of that helper with `isSubagent` and (where the SDK allows) `subagentTaskId`. It also owns subagent *definition* (`SubagentDefinition`, `validateSubagents`) for adapters that accept declared subagents. Per the one-home rule, M06 owns **the per-adapter subagent support matrix**.

**Scope — real subagents only.** `subagent_*` is reserved for actual spawned helper agents (Claude Code `Task`/`Agent` tool, gemini per-`threadId` threads, synthesized equivalents). Engine-backgrounded side work — backgrounded shell commands, monitors, workflow runs — does **not** share this family: it routes to the decoupled `background_task_*` lifecycle owned by M17. On SDKs that multiplex both kinds onto one native task channel (Claude Code's `task_*`), the adapter splits by the task-kind discriminator (`task_type`): subagent kinds map here, everything else maps to M17.

<!-- anchor: 7tmzge8v -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `subagent_started`/`_progress`/`_completed`; `isSubagent` + optional `subagentTaskId` on deltas. |
| L2 | Owns the subagent support matrix (definition acceptance; native vs. synthesized; taskId-on-deltas). |
| L4 | Exports `SubagentDefinition`, `validateSubagents`. |
| M02 | A definition's `model` is passed through verbatim — subagent models are **not** resolved against the catalog. |
| M04 | A subagent has no MCP config of its own; it inherits the run's servers, filtered by its own toolset. |
| M05 | `skills` names skills; delivery and discovery stay M05's. |
| M09 | `splitBySubagent` groups a collected stream by subagent using these fields. |
| M15 | A subagent's reach equals the run's path-scope — the envelope has no field that could narrow or widen it. |
| M18 | Tool-gating deny-groups propagate into every subagent definition — a subagent is a fresh tool context, so a deny that stops at the parent is not a deny. |

<!-- anchor: 0f6287ae -->
## Unified Contract (L1)

- Lifecycle: `subagent_started { taskId, description, toolUseId }`, `subagent_progress { taskId, description, lastToolName? }`, `subagent_completed { taskId, status, summary?, usage? }`.
- A subagent emits the **full** event stream (not just lifecycle); its deltas carry `isSubagent: true` and, when available, `subagentTaskId` matching the `subagent_started.taskId`. `subagentTaskId` is optional — consumers must handle `undefined`.

- **M18 deny-groups propagate into every definition the run spawns.** When a run declares M18 deny-groups (<section_ref anchor="4j6f86yq"/>), those groups are resolved against the subagent's own toolset and applied to every definition, including definitions the consumer wrote without knowing tool gating existed. The reason is mechanical rather than stylistic: on claude-code a subagent does **not** inherit the parent's tool denies (<section_ref anchor="677rc2wh"/>), so "deny the shell" without propagation means "deny the shell until the model delegates" — which is not a boundary at all. Propagation is what lets M18 report a strength above `none` for that group.

<!-- anchor: 6fh6yq89 -->
### Subagent definition envelope

`SubagentDefinition` is the adapter-agnostic subset a consumer declares up front — nine fields, deliberately fewer than any one SDK offers (what is withheld, and why, is the export decision in L4 — <section_ref anchor="gz6lltyi"/>).

| Field | Req | Omitted → | Guarantee |
| --- | :---: | --- | --- |
| `name` | ✅ | — | the agent type the model invokes; unique within a call |
| `description` | ✅ | — | *when* to delegate here; the model reads it to route |
| `prompt` | ✅ | — | the subagent's **own** system prompt |
| `tools` | | inherits the parent's tools — under an M18 policy, the run's residual allow-list | allow-list, then intersected with the run's deny-groups |
| `disallowedTools` | | under an M18 policy, the run's denies; with no policy, nothing — a subagent does not natively inherit parent denies | unioned with the run's denied built-ins |
| `model` | | inherits the main model | passed to the SDK **verbatim**; not re-resolved through M02 |
| `skills` | | none preloaded | names, not bodies — delivery is M05's |
| `maxTurns` | | SDK default | bound on agentic round-trips |
| `effort` | | SDK default | named levels only; the SDK's integer form is not exposed |

The two tool rows are **conditional on an M18 deny-group being in play**. With no policy the adapter passes neither field and the SDK's own inheritance applies — which for denies means *no* inheritance (<section_ref anchor="677rc2wh"/>), the very asymmetry the propagation rule above exists to close.

**What a subagent inherits — and whether the definition gets a vote.**

| Tier | What | The definition's vote |
| --- | --- | --- |
| Fresh per subagent | system prompt, conversation, turn budget | total — `prompt` replaces the parent's, never extends it |
| Inherited unless narrowed | toolset, MCP servers, model | may narrow, never widen: a subagent's tool set is derived, not independent, and may never widen past the parent run's effective policy |
| Inherited unconditionally | M15 filesystem path-scope, M18 deny-groups | none — no field of the envelope expresses either |

The two tier-3 entries reach that tier by **different mechanisms**, and a reader who assumes symmetry will go hunting for propagation code that does not exist:

- **M18 deny-groups** — by explicit propagation (the rule stated above), because the SDK would otherwise let a subagent out.
- **M15 path-scope** — because the envelope has **no field that could express a scope**, and the one SDK field that could re-open one (`AgentDefinition.permissionMode`) is deliberately never set by this library. This is the single home of that mechanism; M15 and L4 link here rather than restate it.

The invariant is *a subagent's reach equals the run's* — not *a subagent is confined*. On a run that declares no path-scope there is no ceiling to inherit (the claude-code session keeps `bypassPermissions`), so tier 3 is vacuous there rather than violated.

**Validation.** `validateSubagents` requires a non-empty `name`, `description` and `prompt` on every definition, and requires names to be unique within the call. It throws **before** the run rather than failing mid-stream, so a malformed set is a definition error the consumer sees at dispatch.

<!-- anchor: 1zx424gy -->
## Capability & Degradation (L2)

**Subagent support matrix** (canonical home — adapters link here):

| Behavior | claude-code | codex | gemini | opencode |
| --- | :---: | :---: | :---: | :---: |
| Definition accepted (`subagentDefinition`) | ✅ definitions become native agent types | ⚠️ warn-and-ignore | ⚠️ warn-and-ignore | ⚠️ warn-and-ignore |
| Lifecycle events | ✅ native `task_*` | ⚠️ synthesized | ⚠️ synthesized per `threadId` | ⚠️ synthesized |
| `subagentTaskId` on deltas | ✅ from `parent_tool_use_id` | ❌ no subagent concept | ✅ pass-through `event.threadId` | ⚠️ ordering-based (single active) |

The `claude-code` column stands for the whole `claude-code-*` family: `claude-code-ollama` and `claude-code-minimax` report `subagentDefinition` true as well. The four columns are families, not an exhaustive list of registered architecture ids.

Degradation: codex has no subagent concept, so `subagentTaskId` is never populated and lifecycle is at best synthesized; consumers relying on per-subagent grouping must tolerate its absence (skip strategy).

<!-- anchor: gz6lltyi -->
## Public API & Packaging (L4)

Exports `SubagentDefinition` and `validateSubagents` from the package root.

**What the envelope deliberately does not carry.** The exported type is the nine-field adapter-agnostic subset (<section_ref anchor="6fh6yq89"/>). The SDK capabilities below are withheld by decision, and each is a contract change to add — not a backlog item:

- `permissionMode` — the SDK's only per-agent override of the session permission posture; exporting it would let a definition set itself back to `bypassPermissions` and out of the run's path-scope. Mechanism: <section_ref anchor="6fh6yq89"/>.
- `background` — a fire-and-forget agent is exactly the shape M06's scope rule separates from itself (<section_ref anchor="70dpqgcb"/>); exposing it would land a subagent in M17's lifecycle.
- `mcpServers` — per-subagent MCP would be a second, adapter-specific MCP surface next to M04's unified one; inheritance plus toolset filtering covers the observed need (<section_ref anchor="fv7bhx0s"/>).
- `memory`, `initialPrompt`, `observer` / `observerMessage`, `criticalSystemReminder_EXPERIMENTAL` — claude-code-only constructs with no analogue on the other three adapters; carrying them would make the envelope untranslatable and would put an `_EXPERIMENTAL` field under our semver promise.

<!-- anchor: 4b8iv50p -->
## Edge cases

- Multiple subagents run concurrently on an adapter that can't populate `subagentTaskId` (opencode ordering-based) → deltas carry `isSubagent: true` but grouping by id is unavailable; consumers fall back to the single-active assumption.
- `validateSubagents` rejects a malformed `SubagentDefinition` → surfaced as a definition error before the run, not mid-stream.
- Two definitions in one call share a `name` → `validateSubagents` throws before the run; neither of them is registered.
- codex target with declared subagents → no native effect; treated per the matrix (no subagent concept).
- Definition omits `tools` on a run with M18 denies → the subagent inherits the run's **residual** allow-list, not the SDK's full default toolset.
- Definition sets `model` to a unified alias the catalog knows but the SDK does not → passed through unchanged and rejected SDK-side, because M02 resolution is bypassed by design.
- Definition names a `skill` that M05 did not deliver for this adapter → the subagent starts anyway; the skill is simply not there.

- A run with M18 deny-groups spawning a subagent → the subagent's toolset is narrowed by the same groups. A `SubagentDefinition` naming a tool from a denied group is not an error and does not fail the run: the intersection wins silently, because a definition written before the policy existed should not be able to break a policy declared after it.
- The parent adapter cannot propagate a deny into subagents → M18 reports the affected group with the subagent escape surface and never as `hard`. The run still proceeds; what it must not do is claim an enforcement it does not have.
- Definition supplies a `tools` allow-list naming `Bash` on a run under soft path-scope → the subagent does not get it. M15's default-deny posture pre-approves the file built-ins only (<section_ref anchor="x2258xmh"/>), so shell and web are withheld from parent and subagent alike, and an allow-list cannot hand back what the run never held.

<!-- anchor: o0e0wak5 -->
## Acceptance criteria

These verify lifecycle observability, that the optional `subagentTaskId` is always safe to read, and that a definition's context is derived from its parent by the rules in <section_ref anchor="6fh6yq89"/> — narrowing where the envelope allows it, and never widening past the run's toolset or its filesystem reach.

Real-model proof: the e2e `subagents` scenario (delegation lifecycle + a consumer-defined subagent + the path-scope leg) exercises this against a live model — scenario catalog in M12 (<section_ref anchor="xe2ecat1"/>); per-adapter coverage in the adapter files (<section_ref anchor="a01e2ecv"/>).

<tagged_list type="ac" tags="m06"/>
