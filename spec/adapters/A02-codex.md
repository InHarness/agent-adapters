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

`architectureCapabilities('codex')` = `{ midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: true, toolGating: true }` — `toolGating` is `true` because a mechanism exists for *some* groups; the flag is deliberately a plain bool and says nothing about which, so a consumer reads M18's matrix (<section_ref anchor="1yllld10"/>) before assuming coverage. Degradation is **warn-and-ignore**, emitted once at startup before `adapter_ready` work — with tool gating as the single documented exception, which refuses the run instead:

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
- **Tool gating (M18)** — codex is the degradation case; the matrix and the strengths are canon in M18 (<section_ref anchor="1yllld10"/>). `file-write` maps onto the `read-only` sandbox posture and `web` onto the SDK's web-search toggle — both **hard but coarse**, because the posture is whole-run rather than per-tool. `shell` and `file-read` have **no primitive at all**: `ThreadOptions` exposes no shell toggle, and the permission-profile family that could express a read denial is documented as incompatible with the sandbox posture the `file-write` mapping already claims, and is unreachable through the config passthrough besides (see L7). Requesting either group therefore **refuses the run before dispatch** with `AdapterToolPolicyError` rather than warning — M18's fail-closed rule, and the one place codex parts company with its usual warn-and-continue degradation.
- **Sandbox** — `codex_sandboxMode` (default `workspace-write`); the plan-mode preset's `file-write` deny forces `read-only`. M15's `allowedPaths` maps onto `sandboxMode: 'workspace-write'` + `additionalDirectories` (writable roots), and a full block maps to `'read-only'`. This must **compose** with any `codex_sandboxMode` / `additionalDirectories` already set and with an M18 `file-write` deny — the path-scope only ever *narrows* the effective sandbox, never widens or overwrites it. Because all three land on the single `sandboxMode` field, the narrowest wins and the field is never assigned twice. <todo comment="Verify in code how allowedPaths composes with existing codex_sandboxMode/additionalDirectories before implementation"/>

<!-- anchor: 6wdgh63l -->
## Auth model (L6)

`OPENAI_API_KEY` **or** local ChatGPT OAuth via `codex login` (`~/.codex/auth.json`). When neither `codex_apiKey` config nor `OPENAI_API_KEY` is present, the adapter **omits** the apiKey field and lets the Codex CLI resolve auth from its local token store — so a missing env var is not itself a failure. Init faults (SDK import, model resolution, skill materialization) are emitted as `error` `phase: 'init'` (`AdapterInitError`).

<!-- anchor: b914jrkn -->
## SDK compatibility & schema drift (L7)

- **Supported peer-SDK range** — `@openai/codex-sdk` `>=0.120.0 <0.121.0` (the 0.120 line verified in CI; dev-pinned `^0.120.0`). The final bound is a semver decision in the release brief (M12), narrowing today's over-wide `>=0.120.0` peer entry to the verified range.
- **Verified-pin log** —

  | date | dev-pin | verified by | findings |
  | --- | --- | --- | --- |
  | 2026-07-28 | `^0.120.0` | CI e2e baseline | `none recorded retroactively` — this row is the log's seed, written when the field was introduced; it states the pin the suite has been running against, not a fresh measurement. |

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
- `shell` or `file-read` in `disallowedToolGroups` → the run is **refused before dispatch** (`AdapterToolPolicyError`, init phase). Nothing is partially applied: a `file-write` deny in the same request is not honoured either, because a half-applied capability gate reads to a consumer as a whole one.
- `planMode: true` on codex → the preset's `file-write` deny maps onto `read-only` and its `shell` deny has no primitive, so plan mode now refuses the run rather than silently delivering read-only-with-a-live-shell. The documented opt-out is an explicit empty `disallowedToolGroups` (M18 — <section_ref anchor="c0b6eyl5"/>).
- `file-write` denied while `shell` stays allowed → accepted, but `read-only` is a whole-run posture: the shell still executes and reads still work. M18's porous-combination `warning` fires, because this is not a filesystem boundary.

<!-- anchor: e4m8i9ie -->
## Acceptance criteria

These verify synthetic streaming, cumulative→delta usage with the `priorUsage` bridge, and warn-and-ignore degradation of MCP/subagents/user-input.

<tagged_list type="ac" tags="a02"/>
