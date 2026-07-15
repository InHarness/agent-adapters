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
- **`UnifiedEvent` taxonomy** — text (`text_delta`, `assistant_message`), `thinking` (with `replace?`), tools (`tool_use`, `tool_result` with optional `isError`), subagent lifecycle (`subagent_started`/`_progress`/`_completed`), `user_input_request`, `user_message`, `todo_list_updated`, terminal (`result`, `error`), and misc (`warning`, `flush`). `isSubagent` is present on all delta-like events; `subagentTaskId?` groups concurrent subagents. The deprecated `elicitation_request` is retained but adapters emit `user_input_request` with `source:'mcp-elicitation'`.
- **`NormalizedMessage` + `ContentBlock`** — role, content blocks (`text`/`thinking`/`toolUse`/`toolResult`/`image`/`todoList`), ISO timestamp, optional `subagentTaskId`, optional `usage`, and a `native` opaque passthrough consumers may read but not depend on.
- **Streaming-input exception** — in `streamingInput` mode the stream may yield multiple `result` events (one per delivered turn) and stays alive until the channel drains or `abort()`.
- **`RuntimeExecuteParams` path-scope fields** — optional `allowedPaths?: string[]` / `disallowedPaths?: string[]` declare a filesystem sandbox for the agent's tools; semantics, precedence, and per-adapter realization are owned by M15. The type home is here; absent fields preserve today's behavior.

Consumers rely on: the stream always terminates (outside streaming-input); errors arrive as `error` events, never thrown out of the iterator; `native` is stable-as-escape-hatch.

<!-- anchor: nbgtn5nk -->
## Capability & Degradation (L2) — implementor

- **Declaration mechanism** — `architectureCapabilities(architecture)` returns a static per-architecture map of plain bool flags (e.g. `midTurnPush`, `pathScope`). Adapters and the factory read it to decide behavior; consumers read it to gate UI. The flat-bool taxonomy is intentional: where a capability needs gradation (e.g. M15's hard/soft/none gate strength), the owning module carries that as a *separate* signal — it is not folded into this map.
- **Degradation taxonomy** — when a consumer requests an unsupported feature, exactly one of: **warn** (emit a one-shot `warning` event and continue — e.g. codex on `onUserInput`), **skip** (drop the unsupported input silently-but-documented), **synthesize** (emulate from primitives — e.g. synthesized subagent lifecycle). "Unsupported" is never an exception.
- M01 owns the *mechanism and taxonomy only*; the per-(adapter × capability) data lives in each capability-module's support matrix (one-home rule).

<!-- anchor: dyls74o5 -->
## Configuration & Extensibility (L3) — implementor

- **Factory & registry** — `createAdapter(architecture, …)` resolves a name to an adapter; `registerAdapter(architecture, factory)` adds a backend; `listArchitectures()` enumerates what is registered. Built-in architectures: `claude-code`, `claude-code-ollama`, `claude-code-minimax`, `codex`, `opencode`, `opencode-openrouter`, `gemini`; custom strings pass through.
- **ArchOption schema** (`options.ts`) — the typed description of each `architectureConfig` key, including the `resumeImmutable` flag consumed by M07. `architectureConfig` keys are prefixed per adapter (`claude_*`, `codex_*`, `gemini_*`, `opencode_*`) plus cross-adapter keys (`custom_env`, `ollama_baseUrl`).

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
