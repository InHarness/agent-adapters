<!-- anchor: 4f4p3q7f -->
# A03 — opencode

> A multi-provider adapter that boots a local OpenCode server on an ephemeral port and consumes its SSE stream — so it inherits OpenCode's provider reach (OpenRouter and friends) but is bounded by what the local CLI exposes: stdio-only MCP, no programmatic subagents, and a side-channel for ask-user.

<!-- anchor: vlmxi0ef -->
## Purpose & SDK identity

Wraps `@opencode-ai/sdk` (optional peer dependency, loaded lazily inside `execute()` together with the additive `@opencode-ai/sdk/v2/client`). Unlike the in-process SDKs, OpenCode runs as a **local server**: the adapter calls `createOpencode` to spawn one on a random ephemeral port, subscribes to its Server-Sent-Events stream, and normalizes those frames to the contract. It requires the `opencode` binary on `PATH` — `isOpencodeAvailable()` (a `which opencode` probe) lets callers gate before constructing. Architecture id `opencode`, with provider variant `opencode-openrouter` (see M03).

<!-- anchor: 83wdcw1d -->
## Event mapping (L1)

OpenCode delivers nearly everything as `message.part.updated` SSE frames discriminated by `part.type`, plus a few session-level frames:

| SDK event | UnifiedEvent |
| --- | --- |
| `message.part.updated` `text` | `text_delta` |
| `message.part.updated` `reasoning` | `thinking` |
| `message.part.updated` `tool` (running) | `tool_use` |
| `message.part.updated` `tool` (completed) | `tool_result` |
| `message.part.updated` `tool` (error) | `tool_result` (`isError`) |
| `message.part.updated` `step-finish` | (accumulates usage) |
| `todo.updated` | `todo_list_updated` (`source: 'session-state'`) |
| `message.updated` | (tracks message role) |
| `session.idle` | `result` |
| `session.error` | `error` (runtime) |
| `question.asked` (v2 SSE) | `user_input_request` |

A `tool` part whose name is `task` is treated as a **subagent**: it is reported as a `tool_use` named `Agent` and brackets a `subagent_started` / `subagent_completed` pair. Because OpenCode's SSE attaches no task id to text/reasoning deltas, subagent attribution is done **by ordering** — deltas seen inside a task's running→completed window inherit its `subagentTaskId` (a single active subagent is assumed; nested tasks would require a stack). A `todo.updated` is surfaced as `todo_list_updated` (source `session-state`) and projected into a synthetic assistant message so `rawMessages` carries a consistent todo history; the projection semantics and the cross-adapter task-tracking matrix are owned by M16 (see <section_ref anchor="3dln3isl"/>).

<!-- anchor: rqfg83d2 -->
## Capability support & degradation (L2)

`architectureCapabilities('opencode')` = `{ midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: false }`.

- **MCP (M04)** — M04 owns the matrix; opencode supports the **stdio transport only**. SSE / HTTP / in-process `sdk` servers are dropped from the config (`skip` degradation), without a per-server warning.
- **Subagents (M06)** — `subagents` ignored with a one-shot `warning` (no per-call definition API); the lifecycle of OpenCode's own `task` tool is still observed.
- **Mid-turn (M11)** — `midTurnPush: false`; one prompt per session, no `pushMessage`.
- **plan mode** — not natively supported; logged as a `console.warn` and ignored.
- **Path-scope (M15)** — `pathScope: false`; no per-call path sandbox is exposed by the local server. `allowedPaths` / `disallowedPaths` → a one-shot `warning` and operations run normally (M15 owns the matrix).

<!-- anchor: 3iaufx4q -->
## Per-capability consumption

- **Models** (<section_ref anchor="b14uq6ky"/>) — `resolveModel('opencode', …)`, then split into `providerID` / `modelID`. A slash-bearing slug like `anthropic/claude-sonnet-4` splits on the first `/`; a bare slug defaults `providerID` to `openrouter`. `opencode_providerID` overrides the split without mangling the slug.
- **Providers (M03)** — the `opencode-openrouter` variant and any factory-resolved `_providerConfig` are merged into the call; `opencode_baseUrl` points the provider entry at a custom backend.
- **Skills (M05)** — no programmatic API; inline skills are materialized then **mirrored** into `<cwd>/.opencode/skills/` before the server starts (the server has no cwd override and scans skills on boot); only the mirrored files are removed afterward.
- **Images (M10)** — passed as `file` parts referencing a `file://` url: a url passes through, a local path becomes `file://<abs>`, base64 is written to a temp file. `mime` is required on every part and inferred when absent.
- **Resume (M07)** — `session.get` for `resumeSessionId` (a miss → `AdapterInitError`) vs. `session.create`.
- **Usage (M08)** — accumulated from each `step-finish` frame's `tokens.input` / `tokens.output`; `contextSize` = input + output.
- **User input (M11/contract)** — the v2 client opens a parallel SSE subscription just for `question.asked`, normalizes it to `user_input_request`, and replies via `question.reply` / `question.reject`. Both clients share the one server and port.

<!-- anchor: 8yp085fj -->
## Auth model (L6)

`OPENROUTER_API_KEY` (or an `opencode_apiKey` config value) is **required** — its absence is an immediate `error` `phase: 'init'` (`AdapterInitError`) before any server spawn. Other init faults (SDK import, server boot, skill materialization, session creation) surface the same way. `opencode_baseUrl` allows pointing the provider at a non-OpenRouter backend.

<!-- anchor: gzef0pt9 -->
## SDK compatibility & schema drift (L7)

- **Supported peer-SDK range** — `@opencode-ai/sdk` `>=1.4.0 <2.0.0` (the 1.4 line verified in CI; dev-pinned `^1.4.6`, plus the additive `@opencode-ai/sdk/v2/client`). The final bound is a semver decision in the release brief (M12), narrowing today's over-wide `>=1.4.0` peer entry.
- **Version gate (HARD)** — at init the adapter reads the installed SDK version and `satisfies` it against the range; a mismatch **emits** `error` `phase:'init'` (`AdapterInitError`, "installed X, requires Y"), non-suppressible. This is separate from the `opencode` CLI-on-PATH probe below — an out-of-range SDK and a missing binary are distinct faults.
- **Version-acquisition mechanism** — resolve the installed `@opencode-ai/sdk` `package.json` `version`; fall back to the nearest resolvable manifest if the `exports` map hides `package.json`. The local `opencode` **binary** version is a separate axis — the adapter drives a spawned server, so a compatible SDK and an incompatible CLI can coexist.
- **Availability probe** — two probes: `isOpencodeAvailable()` (`which opencode`) gates on the CLI binary before construction, and the lazy `import('@opencode-ai/sdk')` (with `/v2/client`) surfaces a missing SDK as `AdapterInitError`.
- **Known schema-drift points** — none pinned in-range yet; the v1 `message.part.updated` frame discriminants and the additive v2 `question.asked` channel are the surfaces most exposed to drift (the adapter already tolerates a failed v2 subscription by falling back to v1).
- **Defensive-read / in-range degradation** — SSE frames are read by `part.type` discriminant and unknown parts are ignored, so an added frame type degrades to a no-op rather than a crash; a failed v2 channel degrades to a `warning` with user-input disabled.

<!-- anchor: d9ugsejh -->
## Edge cases

- The SSE subscription is opened **before** `promptAsync` — subscribing afterward would race the first events.
- Non-stdio MCP servers (SSE/HTTP/in-process) are dropped from config silently, with no per-server warning.
- v2 `question.asked` subscription fails → a `warning` is emitted and the run continues on the authoritative v1 stream with user-input disabled for that session.
- `timeoutMs` / `abort()` → `AdapterTimeoutError` / `AdapterAbortError` (runtime phase); the spawned server is always closed in `finally`.
- `resumeSessionId` not found on the server → `AdapterInitError` (init phase).
- `allowedPaths` / `disallowedPaths` supplied → one-shot `warning`; the run proceeds unscoped (no silent pretense of a sandbox).

<!-- anchor: 7mnbcmgm -->
## Acceptance criteria

These verify the local-server/SSE model, stdio-only MCP degradation, ordering-based subagent attribution, and the v2 user-input side-channel.

<tagged_list type="ac" tags="a03"/>
