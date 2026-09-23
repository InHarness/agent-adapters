<!-- anchor: gs9qkh5p -->
# M06 — Subagents

> One lifecycle for sub-agents regardless of whether the SDK has a native subagent concept — observe `subagent_*` events, group interleaved deltas by `taskId`, and (where supported) define subagents up front.

<!-- anchor: 70dpqgcb -->
## Purpose

Developers can watch and group sub-agent activity uniformly: when an agent spawns a helper, M06 surfaces `subagent_started` / `subagent_progress` / `subagent_completed`, and marks the interleaved `text_delta` / `thinking` / `tool_use` of that helper with `isSubagent` and (where the SDK allows) `subagentTaskId`. It also owns subagent *definition* (`SubagentDefinition`, `validateSubagents`) for adapters that accept declared subagents. Per the one-home rule, M06 owns **the per-adapter subagent support matrix**.

**Scope — real subagents only.** `subagent_*` is reserved for actual spawned helper agents (Claude Code `Task`/`Agent` tool, gemini per-`threadId` threads, synthesized equivalents). Engine-backgrounded side work — backgrounded shell commands, monitors, workflow runs — does **not** share this family: it routes to the decoupled `background_task_*` lifecycle owned by M17. On SDKs that multiplex both kinds onto one native task channel (Claude Code's `task_*`), the adapter splits by the task-kind discriminator (`task_type`): subagent kinds map here, everything else maps to M17. Teammates and cross-session peers are not subagents (<index> OQ9).

<!-- anchor: 7tmzge8v -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `subagent_started`/`_progress`/`_completed`; `isSubagent` + optional `subagentTaskId` on deltas. |
| L2 | Owns the subagent support matrix (definition acceptance; native vs. synthesized; taskId-on-deltas). |
| L4 | Exports `SubagentDefinition`, `SubagentStatus`, `validateSubagents`, `mapSubagentStatus`. |
| M02 | A definition's `model` is passed through verbatim — subagent models are **not** resolved against the catalog. |
| M04 | A subagent has no MCP config of its own; it inherits the run's servers, filtered by its own toolset. |
| M05 | `skills` names skills; delivery and discovery stay M05's. |
| M09 | `splitBySubagent` groups a collected stream by subagent using these fields. |
| M15 | A subagent's reach equals the run's path-scope — the envelope has no field that could narrow or widen it. |
| M18 | Tool-gating deny-groups propagate into every subagent definition — a subagent is a fresh tool context, so a deny that stops at the parent is not a deny. |

<!-- anchor: 0f6287ae -->
## Unified Contract (L1)

- Lifecycle: `subagent_started { taskId, description, toolUseId }`, `subagent_progress { taskId, description, lastToolName? }`, `subagent_completed { taskId, status, summary?, usage? }`.
- **`status` is a closed vocabulary** — `'completed' | 'failed' | 'aborted' | 'stopped'` — and it is what a consumer switches on, so an adapter resolves its SDK's own terminal reason onto it rather than passing the raw value through. The mapping has one rule that is not a matter of taste: an unrecognized reason **never** resolves to `'completed'`. `mapSubagentStatus(raw, declared)` (<section_ref anchor="gz6lltyi"/>) is where that rule lives — it falls back to the caller's `declared` value when `raw` is not in the vocabulary, because a subagent silently reported as successful is the one mapping error a consumer has no way to detect downstream.
- A subagent emits the **full** event stream (not just lifecycle); its deltas carry `isSubagent: true` and, when available, `subagentTaskId` matching the `subagent_started.taskId`. `subagentTaskId` is optional — consumers must handle `undefined`.

- **M18 deny-groups propagate into every definition the run spawns.** When a run declares M18 deny-groups (<section_ref anchor="4j6f86yq"/>), those groups are resolved against the subagent's own toolset and applied to every definition, including definitions the consumer wrote without knowing tool gating existed. The reason is mechanical rather than stylistic: on claude-code a subagent does **not** inherit the parent's tool denies (<section_ref anchor="677rc2wh"/>), so "deny the shell" without propagation means "deny the shell until the model delegates" — which is not a boundary at all. Propagation is what lets M18 report a strength above `none` for that group.


- **`taskId` identifies the agent; `toolUseId` identifies the invocation.** An SDK that lets the model re-enter a helper it already spawned (Claude Code's `SendMessage` against a backgrounded `Agent`) produces a **second** `subagent_started` carrying the **same `taskId`** and a **new `toolUseId`** — the id of the tool call that re-entered it — closed by its own `subagent_completed`. A `taskId` is therefore not a guarantee of a single open/close bracket, and a consumer must not treat a second start for a known `taskId` as a duplicate.
- **`subagent_started.resumed?: boolean`** — `true` on every start after the first for a given `taskId`, absent otherwise. It exists because the signal is **not derivable downstream**: the re-entered agent's deltas keep resolving `subagentTaskId` from the **original** spawn's tool-use id, so a consumer grouping by `taskId` (M09's `splitBySubagent`) would see a closed bucket reopen with nothing on the stream to explain it.
- **Ordering guarantee.** A `subagent_started { resumed: true }` never precedes the `subagent_completed` of the cycle it re-enters — re-entry follows settlement, so the pairs nest not at all and sequence cleanly.

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

Exports `SubagentDefinition`, `SubagentStatus`, `validateSubagents` and `mapSubagentStatus` from the package root. `SubagentStatus` is the closed status vocabulary of `subagent_completed` and `mapSubagentStatus(raw, declared)` the shared mapper onto it; both are under the semver promise, and the mapping rule they carry is stated once, in L1 (<section_ref anchor="0f6287ae"/>).

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

- `abort()`, `timeoutMs`, hold-cap expiry or a `subagentTimeoutMs` expiry fires while a subagent is still open → the run terminates per M13 (<section_ref anchor="1vd9sye5"/>) and the adapter **synthesizes a closing `subagent_completed { status: 'aborted' }` for every `subagent_started` still unpaired**, at most once per `taskId` **per termination** — the synthesis fires once, at teardown, over the tasks still unpaired at that moment; across a whole run one `taskId` may legitimately carry more than one lifecycle pair (<section_ref anchor="0f6287ae"/>). A subagent that already produced its own terminal event is not closed a second time. **That list of triggers is complete, and the idle clock is missing from it on purpose:** an open subagent is outstanding work, so `idleTimeoutMs` does not advance while one is running and can never be what cuts it short (M01 — <section_ref anchor="8do90d06"/>).
- **`subagentTimeoutMs` is what makes that fourth trigger a trigger, and it re-arms.** The cap is armed when a subagent opens and returned to its full value by that subagent's own lifecycle events — its `subagent_started`, a re-entry's `resumed: true` start included, and every `subagent_progress` carrying its `taskId`. Without the re-arm the cap would cut short a long subagent that is visibly working, which is the failure it exists to prevent rather than one to introduce. **What re-arms it is a closed vocabulary — the lifecycle of one subagent — and not movement on the stream at large**, because subagent lifecycle is a signal whose per-adapter inequality is already declared (<section_ref anchor="1zx424gy"/>): where it is synthesized rather than native the cap is worth exactly what the synthesis is worth, and the matrix says so up front instead of the guarantee quietly changing meaning per architecture. Expiry ends the run down the path above, so the open subagent leaves through the same synthesized `subagent_completed { status: 'aborted' }` as any other termination, under the same at-most-once rule. The field's type home is M01 (<section_ref anchor="8do90d06"/>) and it is a field of the **run**, not of the definition envelope (<section_ref anchor="6fh6yq89"/>): a subagent the model spawns with no consumer definition behind it would otherwise carry no bound at all. Absent, no subagent carries a cap and an open one is bounded by `timeoutMs`, the hold cap or `abort()` alone — and the hold cap bounds that subagent's *silence*, not its length, on the same closed-vocabulary rule as this one (M17 — <section_ref anchor="q9u5sbot"/>).
- That rule is the deliberate opposite of M17's, where no `background_task_completed` is owed after termination (<section_ref anchor="q9u5sbot"/>), and the asymmetry is in the shape of the two things rather than in taste. Background work is *designed* to outlive the turn, so its silence after termination is legible on its own. A subagent is a **bracket inside** the turn: a consumer grouping deltas by `subagentTaskId` has no other signal that the bucket ever closed, and — once a `taskId` may carry a second cycle — no signal that a closed bucket may legitimately reopen, other than the `resumed` marker on the new start (<section_ref anchor="0f6287ae"/>), so an unpaired `subagent_started` is indistinguishable from a subagent still running against a run that no longer exists.


- The model re-enters a backgrounded subagent mid-run (`SendMessage`) → a second `subagent_started { taskId, toolUseId: <the re-entering tool call>, resumed: true }`, its own `subagent_completed`, and the session held open until it reports (M17 — <section_ref anchor="01or0cpk"/>). A consumer that keyed a map on `taskId` alone and asserted single-entry sees the second start as a contract violation; it is not, which is why the marker is on the event rather than left to be inferred.
- Termination fires between a subagent's settlement and its re-entry → nothing is synthesized: there is no unpaired start. The `taskId` simply never sees its second cycle.
- An agent-team teammate or a peer agent in another session addresses this run → it is not a subagent: no `subagent_started`, no `subagent_completed`, nothing on the unified stream, and no capability flag advertises it (<index> open question 9). The engine-side discriminator is that an in-process subagent's message carries a sender task id while a cross-session peer's does not; `subagent_*` covers only agents **this run spawned**.

<!-- anchor: o0e0wak5 -->
## Acceptance criteria

These verify lifecycle observability, that the optional `subagentTaskId` is always safe to read, and that a definition's context is derived from its parent by the rules in <section_ref anchor="6fh6yq89"/> — narrowing where the envelope allows it, and never widening past the run's toolset or its filesystem reach.

Real-model proof: the e2e `subagents` scenario (delegation lifecycle + a consumer-defined subagent + the path-scope leg) exercises this against a live model — scenario catalog in M12 (<section_ref anchor="xe2ecat1"/>); per-adapter coverage in the adapter files (<section_ref anchor="a01e2ecv"/>).

<tagged_list type="ac" tags="m06"/>
