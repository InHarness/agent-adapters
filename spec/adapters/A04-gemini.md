<!-- anchor: ogdzfqc4 -->
# A04 — gemini

> A Google adapter over gemini-cli-core whose stream speaks in *thought summaries* (whole-block reasoning, replaced rather than appended) and whose subagent lifecycle is synthesized entirely from a thread id — with full multi-transport MCP, but an API key it cannot run without.

<!-- anchor: 1jxingkl -->
## Purpose & SDK identity

Wraps `@google/gemini-cli-core` (optional peer dependency, loaded lazily inside `execute()`). The adapter drives a `LegacyAgentSession` whose `sendStream` yields coarse-grained `AgentEvent`s; its distinguishing work is normalizing Gemini's *thought* parts and reconstructing a subagent lifecycle from `threadId`. Architecture id `gemini`.

<!-- anchor: mlo3qpng -->
## Event mapping (L1)

| SDK event | UnifiedEvent |
| --- | --- |
| `message` (role `agent`) `thought` part | `thinking` (`replace: true`) |
| `message` (role `agent`) `text` part | `text_delta` (+ `assistant_message`) |
| `tool_request` | `tool_use` (+ `subagent_started` if `threadId`) |
| `tool_response` | `tool_result` (`isError`) |
| `tool_update` | `subagent_progress` (if `threadId`) |
| `usage` | (accumulates usage) |
| `agent_end` (subagent thread) | `subagent_completed` |
| `agent_end` (reason `aborted`) | `error` (timeout / abort) |
| `agent_end` (otherwise) | `result` |
| `error` | `error` (runtime; `fatal` ends the run) |

**Thought summaries** — Gemini emits each `thought` as a *complete* summary rather than a token delta, so the adapter sets `replace: true` on the `thinking` event (each one supersedes the prior, never concatenates). **Subagent lifecycle is synthesized**: a `tool_request` / `tool_update` / `agent_end` carrying a `threadId` drives `subagent_started` / `subagent_progress` / `subagent_completed`, deduplicated through an `activeSubagents` set — Gemini has no native subagent objects.

<!-- anchor: s7prl2pn -->
## Capability support & degradation (L2)

`architectureCapabilities('gemini')` = `{ midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: false }`.

- **MCP (M04)** — M04 owns the matrix; gemini supports **stdio, SSE, and HTTP** transports (via `MCPServerConfig`). In-process `sdk` servers are skipped.
- **Subagents (M06)** — `subagents` (definition) ignored with a one-shot `warning`; the lifecycle of Gemini's own thread-bearing tool calls is still observed and synthesized.
- **Mid-turn (M11)** — `midTurnPush: false`; one `sendStream` per run.
- **Path-scope (M15)** — currently `pathScope: false`; `allowedPaths` / `disallowedPaths` degrade to a one-shot `warning`. Whether the SDK's `targetDir` / include-directories can express a soft path gate is **to be verified** (M15 matrix; <index> Open question #5b) — if confirmed, this flips to a soft, capability-true mapping.

<!-- anchor: oirynpg7 -->
## Per-capability consumption

- **Models** (<section_ref anchor="b762jf0d"/>) — `resolveModel('gemini', …)`; `gemini_temperature` / `gemini_topP` / `gemini_topK` and `gemini_thinkingBudget` *or* `gemini_thinkingLevel` flow into a per-model `generateContentConfig` override.
- **MCP (M04)** — `mapMcpServersToGemini` builds `MCPServerConfig` instances per transport (stdio/SSE/HTTP); the SDK manages discovery and connection lifecycle.
- **Skills (M05)** — materialized and consumed **inline** via `Config.skills` `body` (a single string); `InlineSkill.files` multi-file payloads are **not** honored — written to disk for parity but only `content` reaches the model (warned once).
- **Images (M10)** — `media` content parts: base64 and local `file` become inline data (the file is read into memory), `url` becomes a `uri`. No temp files.
- **Subagents (M06)** — observed only (see L2); the lifecycle is synthesized from `threadId`.
- **Resume (M07)** — locates the prior session file through the SDK's `~/.gemini/projects.json` slug→temp-dir mapping and calls `resumeChat` (never `initialize`, which would overwrite the on-disk session); a missing or unreadable prior file degrades to a `warning` and a fresh start.
- **Usage (M08)** — accumulated from `usage` events; when Gemini 2.5's implicit thinking omits `candidatesTokenCount` (output reported as 0), output tokens are **estimated** from produced text length (~4 chars/token).
- **User input (M11/contract)** — `ask_user` is bridged over gemini-cli's `messageBus`: the adapter subscribes to `TOOL_CALLS_UPDATE`, normalizes awaiting-approval `ask_user` calls to `user_input_request`, and replies on `TOOL_CONFIRMATION_RESPONSE`. This requires `approvalMode: 'default'` + `interactive: true` (set when `onUserInput` is wired); `yolo` skips the confirmation flow entirely.
- **plan mode** — enforced at the tool-list level via `excludeTools` (removes `write_file`, `replace`, `run_shell_command`, `save_memory`); the SDK's own `approvalMode: 'plan'` is avoided because it would make the model defer even reads.

<!-- anchor: qhpv1am5 -->
## Auth model (L6)

`GOOGLE_API_KEY` **or** `GEMINI_API_KEY` is **required** — absence yields an immediate `error` `phase: 'init'` (`AdapterInitError`) before SDK import. Auth is refreshed through `AuthType.USE_GEMINI` with that key. Other init faults (SDK import, missing SDK exports, session construction, skill materialization) surface the same way.

<!-- anchor: srxv89v2 -->
## SDK compatibility & schema drift (L7)

- **Supported peer-SDK range** — `@google/gemini-cli-core` `>=0.38.0 <0.39.0` (the 0.38 line verified in CI; dev-pinned `^0.38.0`). The final bound is a semver decision in the release brief (M12), narrowing today's over-wide `>=0.38.0` peer entry. gemini-cli-core is the fastest-moving peer, so the narrow range matters most here.
- **Version gate (HARD)** — at init the adapter reads the installed SDK version and `satisfies` it against the range; a mismatch **emits** `error` `phase:'init'` (`AdapterInitError`, "installed X, requires Y"), non-suppressible. This runs alongside the existing check for missing SDK exports (which already fails init).
- **Version-acquisition mechanism** — resolve the installed `@google/gemini-cli-core` `package.json` `version`; fall back to the nearest resolvable manifest if the `exports` map hides `package.json`.
- **Availability probe** — the lazy `import('@google/gemini-cli-core')` inside `execute()` surfaces absence as `AdapterInitError`; the version gate runs immediately after a successful import.
- **Known schema-drift points** — none pinned in-range yet, but the exposure is real: the `AgentEvent` shapes (thought parts, `usage` reporting, `agent_end` reasons) and the `Config` surface (`skills`, `generateContentConfig`) are the fields the adapter reads defensively and the likeliest to drift within a minor line. <todo comment="Name a concrete gemini-cli-core drift point + cutover version once observed, then add an a04-edge/L7 AC"/>
- **Defensive-read / in-range degradation** — usage and thought parts are read defensively (e.g. output tokens estimated when `candidatesTokenCount` is absent), so a reshaped field degrades to an estimate or a documented gap rather than a crash.

<!-- anchor: 99avio4b -->
## Edge cases

- Thought summaries carry `replace: true`; a consumer that appends rather than replaces would duplicate reasoning text.
- The output-token estimate (~4 chars/token) only engages when `candidatesTokenCount` is absent and real usage is unrecoverable.
- Resuming calls `resumeChat` and deliberately skips `initialize()` to avoid clobbering the same-minute session file on disk.
- In-process `sdk` MCP servers are skipped; stdio / SSE / HTTP are mapped.
- `ask_user` under `approvalMode: 'yolo'` never fires (the policy auto-allows, so no confirmation bus message is published).
- `timeoutMs` / `abort()` → `agent_end` `reason: 'aborted'` → `AdapterTimeoutError` / `AdapterAbortError` (runtime phase).
- `allowedPaths` / `disallowedPaths` supplied → one-shot `warning` (path-scope unverified on this SDK); the run proceeds unscoped. <todo comment="Verify whether gemini-cli-core targetDir/include-directories can enforce a path gate; if so, set pathScope: true (soft) and map natively"/>

<!-- anchor: 7y3bfakm -->
## Acceptance criteria

These verify thought-summary replace semantics, threadId-synthesized subagent lifecycle, multi-transport MCP, the output-token estimate fallback, and the required-API-key init failure.

<tagged_list type="ac" tags="a04"/>
