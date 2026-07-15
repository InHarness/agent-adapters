<!-- anchor: m6bhu3ab -->
# A02 — codex

> A sandboxed OpenAI adapter whose SDK reports usage as running session totals and has no live input channel — so it synthesizes streaming, computes per-run usage by subtraction, and degrades every interactive capability to warn-and-ignore.

<!-- anchor: wfcgwbk5 -->
## Purpose & SDK identity

Wraps `@openai/codex-sdk` (optional peer dependency, loaded lazily inside `execute()`). The SDK drives the Codex CLI in a sandbox; the adapter's distinguishing work is reconstructing a unified stream and per-run usage from a CLI whose JSONL output is coarser than the contract. Architecture id `codex`.

<!-- anchor: t2v9clpy -->
## Event mapping (L1)

| SDK event | UnifiedEvent |
| --- | --- |
| `item.completed` `agent_message` | `text_delta` (whole text) + `assistant_message` |
| `item.completed` `command_execution` | `tool_use` (`shell`) + `tool_result` |
| `item.completed` `file_change` | `tool_use` (`file`) + `tool_result` |
| `item.completed` `mcp_tool_call` | `tool_use` (`mcp__<server>__<tool>`) + `tool_result` |
| `item.completed` `reasoning` | `thinking` |
| `item.completed` `error` | `error` (runtime, de-duplicated) |
| `thread.started` | (captures `threadId`) |
| `turn.completed` | `result` |
| `turn.failed` / top-level `error` | `error` (runtime, de-duplicated) |

**Synthetic streaming** — the SDK delivers a finished `agent_message`, so the adapter emits one `text_delta` carrying the entire text rather than incremental tokens. `subagentTaskId` is never populated (no subagent concept). Duplicate error envelopes (a `turn.failed` followed by the CLI's `Codex Exec exited with…` throw) are suppressed so consumers see exactly one structured error per failure.

<!-- anchor: dmy7oxr7 -->
## Capability support & degradation (L2)

`architectureCapabilities('codex')` = `{ midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: true }`. Degradation is **warn-and-ignore**, emitted once at startup before `adapter_ready` work:

- **MCP (M04)** — no dynamic configuration; `mcpServers` is ignored with a warning (servers must be pre-registered via `codex mcp add` / `~/.codex/config.toml`). Pre-configured servers' `mcp_tool_call` events are still normalized.
- **Subagents (M06)** — `subagents` ignored with a warning; no lifecycle events.
- **User input (M11/contract)** — `onUserInput` / `onElicitation` warned as never-invoked (no ask-user mechanism).
- **Mid-turn (M11)** — `midTurnPush: false`; one prompt per `runStreamed`. No `pushMessage`.
- **Path-scope (M15)** — supported as a **hard but coarse, allow-only** OS gate; M15 owns the matrix. Because Codex is allow-list-based (writable roots), fine-grained `disallowedPaths` carve-outs are **not guaranteed** — that expressiveness limit is surfaced via the matrix.

<!-- anchor: rdl4n5wk -->
## Per-capability consumption

- **Models** (<section_ref anchor="jq7y9jh0"/>) — `resolveModel('codex', …)`; `modelReasoningEffort` via `codex_reasoningEffort`.
- **Skills (M05)** — no programmatic API; inline skills are materialized then **mirrored** into `<cwd>/.agents/skills/` before the thread starts, and only the mirrored files are removed afterward.
- **Images (M10)** — SDK accepts a local **path** only; base64 is written to a temp file and a url is downloaded, then passed as `local_image`.
- **Resume (M07)** — `resumeThread(resumeSessionId, …)` vs. `startThread`.
- **Usage (M08)** — the key quirk: `turn.completed.usage` is **cumulative session totals**, so the adapter yields `current − prior` via `subtractUsage`. Prior lookup is `params.priorUsage` → per-`threadId` LRU (cap 256) → `{0,0}`. `priorUsage` is the cross-process bridge: the LRU starts empty each process, so a caller persists and re-supplies the prior cumulative. `cached_input_tokens` → `cacheReadInputTokens`.
- **Sandbox** — `codex_sandboxMode` (default `workspace-write`); plan mode forces `read-only`. M15's `allowedPaths` maps onto `sandboxMode: 'workspace-write'` + `additionalDirectories` (writable roots), and a full block maps to `'read-only'`. This must **compose** with any `codex_sandboxMode` / `additionalDirectories` already set and with plan mode — the path-scope only ever *narrows* the effective sandbox, never widens or overwrites it. <todo comment="Verify in code how allowedPaths composes with existing codex_sandboxMode/additionalDirectories before implementation"/>

<!-- anchor: 6wdgh63l -->
## Auth model (L6)

`OPENAI_API_KEY` **or** local ChatGPT OAuth via `codex login` (`~/.codex/auth.json`). When neither `codex_apiKey` config nor `OPENAI_API_KEY` is present, the adapter **omits** the apiKey field and lets the Codex CLI resolve auth from its local token store — so a missing env var is not itself a failure. Init faults (SDK import, model resolution, skill materialization) are emitted as `error` `phase: 'init'` (`AdapterInitError`).

<!-- anchor: b914jrkn -->
## SDK compatibility & schema drift (L7)

- **Supported peer-SDK range** — `@openai/codex-sdk` `>=0.120.0 <0.121.0` (the 0.120 line verified in CI; dev-pinned `^0.120.0`). The final bound is a semver decision in the release brief (M12), narrowing today's over-wide `>=0.120.0` peer entry to the verified range.
- **Version gate (HARD)** — at init the adapter reads the installed SDK version and `satisfies` it against the range; a mismatch **emits** `error` `phase:'init'` (`AdapterInitError`, "installed X, requires Y"), non-suppressible.
- **Version-acquisition mechanism** — resolve the installed `@openai/codex-sdk` `package.json` `version`; fall back to the nearest resolvable manifest if the `exports` map hides `package.json`.
- **Availability probe** — the lazy `import('@openai/codex-sdk')` inside `execute()` surfaces absence as `AdapterInitError`; the version gate runs immediately after a successful import.
- **Known schema-drift points** — none identified in-range yet. The coarse JSONL `item.completed` item shapes and the cumulative-usage field (`turn.completed.usage`) are the surfaces most exposed to drift; a concrete cutover is added here if observed, not on spec.
- **Defensive-read / in-range degradation** — SDK events are normalized through a single loose-shape reader, so an added or renamed field degrades to a documented gap rather than a crash.

<!-- anchor: 26dlg7ut -->
## Edge cases

- First resume after a process restart with no `priorUsage` supplied → the run's usage is reported as the cumulative-as-delta one-shot artifact (documented).
- `mcp_tool_call` from a pre-configured server still surfaces as `tool_use` + `tool_result` even though dynamic MCP config is unsupported.
- `turn.failed` then `Codex Exec exited with…` → only one `error` event (duplicate suppressed).
- `timeoutMs` / `abort()` → `AdapterTimeoutError` / `AdapterAbortError` (runtime phase).
- `disallowedPaths` carve-out inside an `allowedPaths` root → not enforceable (allow-list-only sandbox); the carve-out is documented as unsupported on codex so consumers don't assume a deny that won't fire.

<!-- anchor: e4m8i9ie -->
## Acceptance criteria

These verify synthetic streaming, cumulative→delta usage with the `priorUsage` bridge, and warn-and-ignore degradation of MCP/subagents/user-input.

<tagged_list type="ac" tags="a02"/>
