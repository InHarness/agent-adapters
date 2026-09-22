<!-- anchor: 1kzx7q5e -->
# M01 — Unified Core & Factory

> The contract every adapter implements and every consumer depends on — the types, the capability mechanism, and the factory/registry that turn an architecture name into a running adapter.

<!-- anchor: 4sgzlms4 -->
## Purpose

Application developers can write against one stable surface and run a prompt through any agent SDK without learning each SDK's shape. M01 owns the unified vocabulary (`UnifiedEvent`, `NormalizedMessage`/`ContentBlock`, `RuntimeExecuteParams`, `UsageStats`, the `RuntimeAdapter` interface), the mechanism by which architectures declare capabilities, and the factory that resolves an architecture string to an adapter instance. It is the **implementor** of L1, L2, and L3 — it does not wrap any SDK itself; it defines the rules every wrapper obeys.

<!-- anchor: y7fp8wwg -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1, L2, L3 | Implements all three (this module is their home). |
| L4 | Consumer — exports the factory, registry, and types from the package root. |
| every adapter (A01–A04) | Each `registerAdapter`s into M01's registry and yields M01's `UnifiedEvent`s. |
| every other module | Reads M01's contract types; M01 is infrastructure for all of them. |

<!-- anchor: 8do90d06 -->
## Unified Contract (L1) — implementor

M01 defines the contract; this section is read in *how-mode* (what consumers can rely on).

- **`RuntimeAdapter`** — three obligations + one optional: identify via `architecture`; `execute(params): AsyncIterable<UnifiedEvent>` yielding a terminating stream (a `result` then return, or an `error`); `abort()` stops promptly; optional `pushMessage(text): boolean` for mid-turn injection (M11).
- **`UnifiedEvent` taxonomy** — text (`text_delta`, `assistant_message`), `thinking` (with `replace?`), tools (`tool_use`, `tool_result` with optional `isError`), subagent lifecycle (`subagent_started`/`_progress`/`_completed`), background-task lifecycle (`background_task_started { taskId, taskType, description }` / `background_task_progress { taskId, taskType, status?, outputFile? }` / `background_task_completed { taskId, taskType, status, outputFile?, summary?, usage? }` — for SDK-backgrounded work such as `run_in_background` shell commands; **decoupled from `subagent_*`**, which is reserved for real subagents; semantics owned by M17), `user_input_request`, `user_message`, `todo_list_updated`, terminal (`result`, `error`), and misc (`warning`, `flush`). `isSubagent` is present on all delta-like events; `subagentTaskId?` groups concurrent subagents. The deprecated `elicitation_request` is retained but adapters emit `user_input_request` with `source:'mcp-elicitation'`.
- **`NormalizedMessage` + `ContentBlock`** — role, content blocks (`text`/`thinking`/`toolUse`/`toolResult`/`image`/`todoList`), ISO timestamp, optional `subagentTaskId`, optional `usage`, and a `native` opaque passthrough consumers may read but not depend on.
- **Streaming-input exception** — in `streamingInput` mode the stream may yield multiple `result` events (one per delivered turn) and stays alive until the channel drains or `abort()`.
- **Background-work exception — `result` is not terminal while background tasks are in flight.** A `result` event carries an in-flight signal: `backgroundTasks?: Array<{ taskId, taskType }>` (empty/absent = truly terminal). When non-empty, the underlying session stays alive waiting for the background work to settle; on settlement the engine wakes the model, which continues and produces a further `result`. **Consumers must consume `execute()` to generator `done`, never treat the first `result` as end-of-run.** The list carries engine-backgrounded work only, never a subagent. Mechanics, per-adapter support, and stop/disable levers are owned by M17.
- **`warning` is side-band, and its position on the stream carries no meaning.** It reports *on* the run rather than advancing it, so nothing constrains where it lands — including after the run's last `result`, which is where a warning raised from a timer or a teardown path necessarily falls. "`result` is terminal" therefore means **last non-`warning`, non-`flush` event**, and any conformance obligation phrased as "the literal last event is `result`" is wrong. `flush` already had this exemption; `warning` joins it for the same reason. This is a statement about what the event *class* permits, not a report of an adapter that currently does it: an adapter that starts emitting a trailing `warning` must not thereby become non-conforming. Note that a condition which genuinely **ends** a run is never a `warning` — it is an `error` (M13), and an `error` *is* terminal.
- **`RuntimeExecuteParams` path-scope fields** — optional `allowedPaths?: string[]` / `disallowedPaths?: string[]` declare a filesystem sandbox for the agent's tools; semantics, precedence, and per-adapter realization are owned by M15. The type home is here; absent fields preserve today's behavior.
- **`RuntimeExecuteParams` tool-gating field** — optional `disallowedToolGroups?: ToolGroup[]`, where `type ToolGroup = 'shell' | 'file-read' | 'file-write' | 'web'`, removes whole classes of built-in capability from a run. Type home is here; group definitions, the preset registry, the per-adapter matrix, the fail-closed refusal and the composition rules against M15 are owned by M18 (<section_ref anchor="4j6f86yq"/>). Absent field preserves today's behavior byte for byte.
- **`RuntimeExecuteParams.autoApproveTools?: string[]`** — the tool names a run may use **without** an approval prompt. It auto-approves; it does not restrict, and it can never re-widen a group denied under M18. The name states that: the field was called `allowedTools`, which read as a restriction and was silently ignored by three of the four adapters (M12 governs the rename's semver consequence, <section_ref anchor="agvf1tok"/>). Adapters with no auto-approval primitive degrade with a one-shot `warning` per the L2 taxonomy below, rather than ignoring the field.
- **`RuntimeExecuteParams.timeoutMs?: number` — the absolute backstop.** It bounds the whole `execute()` call from the moment the run starts, and on expiry the run ends with `AdapterTimeoutError` in the **runtime** phase; the class and what termination owes a run caught mid-work are M13's (<section_ref anchor="8q9q7ty7"/>, <section_ref anchor="1vd9sye5"/>) and are not restated here. **It is armed exactly once and never re-armed** — no event, frame, tool result or progress notification moves it — and that is its *role*, not a shortcoming: a bound that anything inside the run can push forward is not a backstop. The clock that does re-arm is `idleTimeoutMs` below. **Under `streamingInput` the unit of arming is still the single `execute()` call** (M11 — <section_ref anchor="fr2hhuye"/>): one bound spans the whole streaming session, runs through the idle gaps between pushes, and covers every `result` the session yields — a push does not buy a fresh budget. **Omitting the field is a guarantee, not a default:** there is no fallback value and no timer at all on any adapter, so the run carries **no wall-clock bound**. One standing exception, and it is narrower than it looks: M17's control-channel hold cap (<section_ref anchor="q9u5sbot"/>) ends a run regardless of `timeoutMs`, but it arms at a *held* `result` rather than at run start, so it bounds only the parked stretch of a run that reached one — and only on an adapter that holds the channel at all, which M17 decides. A run that never holds and sets no `timeoutMs` is bounded by `abort()` and nothing else. Type home is here; the field is not new and this bullet adds no behavior, it states the one that was always there.
- **`RuntimeExecuteParams.idleTimeoutMs?: number` — the outstanding-work model.** A run is at every moment in one of two states: **nothing outstanding**, where silence means the engine owes the consumer something, and **work in flight**, where silence is exactly what a healthy run looks like. The idle clock advances **only in the first state**, and on expiry ends the run with its own terminal error, distinct from the backstop's (identity and phase are M13's — <section_ref anchor="8q9q7ty7"/>). That is the whole rule, and it is deliberately not the rule it replaces: "re-arm on the last sign of life" makes silence itself the signal, when silence means nothing on its own, and every fix built that way is one more special case on a list that is never complete. **What counts as outstanding is the contract, so it is enumerated here:** a `tool_use` with no matching `tool_result` yet; a subagent still open (M06 — <section_ref anchor="4b8iv50p"/>); a background task not yet settled (M17); an unanswered `user_input_request`, which is a human being slow rather than an engine gone quiet; and a nested turn the consumer started from inside the run. **Negative scope, stated on purpose:** a pause with nothing outstanding is idleness however short it is, and the clock does not care what preceded it. **Outstanding work is not unbounded work** — while it is outstanding the run is bounded by *that work's own cap* rather than by nothing, M17's hold cap being the existing instance of that shape, which this model generalises rather than competes with. Without that sentence a hung tool call would simply wait out the backstop. Type home is here; absent, there is no idle clock and a run behaves exactly as it does today.
  - **This makes four clocks, and they must be told apart.** The **backstop** (`timeoutMs`) runs from run start and never re-arms. The **idle clock** (`idleTimeoutMs`) advances only while nothing is outstanding and stops whenever work is in flight. The hold's **grace window** is armed only once everything tracked has settled and is re-armed by every frame that arrives while parked, and its expiry is silent. The hold's **hard cap** is armed at a held `result`, bounds the parked stretch, and its expiry is a terminal error; both of those belong to M17 (<section_ref anchor="q9u5sbot"/>). Different arming conditions, different re-arm rules, different outcomes — none substitutes for another, and a consumer's reaction is built on distinguishing them. All four are **adapter-side**: a clock the consumer runs over the stream, `collectEvents()`'s own default included (M09), is not among them, and how the cap must sit under it is M17's to state. `abort()` is not a fifth clock — it is the consumer's hand on the same switch.

Consumers rely on: the stream always terminates (outside streaming-input and in-flight background work); errors arrive as `error` events, never thrown out of the iterator; `native` is stable-as-escape-hatch.

<!-- anchor: nbgtn5nk -->
## Capability & Degradation (L2) — implementor

- **Declaration mechanism** — `architectureCapabilities(architecture)` returns a static per-architecture map of plain bool flags (e.g. `midTurnPush`, `pathScope`, `toolGating`). Adapters and the factory read it to decide behavior; consumers read it to gate UI. The flat-bool taxonomy is intentional: where a capability needs gradation (e.g. M15's hard/soft/none gate strength, or M18's per-group strength and escape surfaces), the owning module carries that as a *separate* signal — it is not folded into this map. `toolGating` therefore answers only *"does a gating mechanism exist at all"*; how strong it is, and where it leaks, is read from M18's matrix and `probeToolGating`.
- **Degradation taxonomy** — when a consumer requests an unsupported feature, exactly one of: **warn** (emit a one-shot `warning` event and continue — e.g. codex on `onUserInput`), **skip** (drop the unsupported input silently-but-documented), **synthesize** (emulate from primitives — e.g. synthesized subagent lifecycle). "Unsupported" is never an exception.
- **Pre-dispatch probes.** A capability whose absence a consumer must discover *before* dispatching — not from a post-hoc `warning` — is exposed as a synchronous probe function beside the flag map: `probeToolGating(architecture, requestedGroups)` returns per requested group `{ group, enforceable, strength, escapeSurfaces }` (M18), alongside the path-scope probe M15 requires. The probe is the mechanism; the per-adapter answers it returns are the owning module's data.
- M01 owns the *mechanism and taxonomy only*; the per-(adapter × capability) data lives in each capability-module's support matrix (one-home rule).

<!-- anchor: dyls74o5 -->
## Configuration & Extensibility (L3) — implementor

- **Factory & registry** — `createAdapter(architecture, …)` resolves a name to an adapter; `registerAdapter(architecture, factory)` adds a backend; `listArchitectures()` enumerates what is registered. Built-in architectures: `claude-code`, `claude-code-ollama`, `claude-code-minimax`, `codex`, `opencode`, `opencode-openrouter`, `gemini`; custom strings pass through.
- **ArchOption schema** (`options.ts`) — the typed description of each `architectureConfig` key, including the `resumeImmutable` flag consumed by M07. `architectureConfig` keys are prefixed per adapter (`claude_*`, `codex_*`, `gemini_*`, `opencode_*`) plus cross-adapter keys (`custom_env`, `ollama_baseUrl`).

- **Preset registries.** A module may publish a named, library-built constant that desugars a coarse consumer flag into the fine-grained contract underneath it — M18's plan-mode preset over `disallowedToolGroups` is the first. The registry is canon in the owning module and exported through L4 so consumers can inspect and extend it; M01 owns only the convention that such a preset is a value, not a per-adapter code path.

<!-- anchor: eud2jcxh -->
## Public API & Packaging (L4) — consumer

Exports `createAdapter`, `registerAdapter`, `listArchitectures`, `architectureCapabilities`, and all contract types from the package root (`@inharness-ai/agent-adapters`).

<!-- anchor: u39gu699 -->
## Edge cases

- Unknown architecture string → treated as a custom architecture; `resolveModel` passes the model through untouched (M02). No throw.
- Adapter throws synchronously inside `execute` → must be surfaced as an `error` event, never propagated out of the async iterator.
- Adding a new `UnifiedEvent` variant that an adapter cannot emit → must ship with a declared degradation (warn/skip/synthesize); never a silent gap.

<!-- anchor: a7kxmtyl -->
## Acceptance criteria

These verify the contract's stability guarantees — that consumers can depend on M01 regardless of which adapter runs.

<tagged_list type="ac" tags="m01"/>

Edge-case criteria:

<tagged_list type="ac" tags="m01-edge"/>
