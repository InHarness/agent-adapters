---
name: opencode-sdk
description: >-
  Use when editing src/adapters/opencode.ts or
  src/testing/e2e/opencode.e2e.test.ts, bumping @opencode-ai/sdk in
  package.json, debugging SSE streaming issues, OpenCode CLI availability,
  provider/model string parsing, question.asked user-input flow, or MCP
  stdio-only limitation. Extending UnifiedEvent and need to know that OpenCode
  ignores planMode, only supports stdio MCP, and requires the OpenCode CLI
  binary in PATH.
---

<!-- anchor: no62p50n -->
# opencode adapter — `@opencode-ai/sdk`

OpenCode is the only adapter that requires an **external CLI binary in PATH** and that operates over **SSE** instead of in-process iteration. It runs two parallel subscriptions (v1 for events, v2 for question.asked), allocates a local port, and has the most "partial" checkboxes in the capability matrix.

<!-- anchor: uphg3eyd -->
## Official documentation & sources

- **Project site**: https://opencode.ai
- **Docs**: https://opencode.ai/docs
- **SDK (TypeScript) docs**: https://opencode.ai/docs/sdk
- **Repo**: https://github.com/sst/opencode
- **npm SDK**: https://www.npmjs.com/package/@opencode-ai/sdk
- **Releases / changelog**: https://github.com/sst/opencode/releases
- **MCP config docs**: https://opencode.ai/docs/mcp-servers
- **OpenRouter** (used by `opencode-openrouter` architecture for model access): https://openrouter.ai/docs

<!-- anchor: rt8i7e3z -->
## Pinned version & TODO

- **Dev**: `^1.4.6` (`package.json`)
- **Peer**: `>=1.4.0`
- **TODO / things to watch**:
  - **Non-stdio MCP** — currently SSE/HTTP/SDK MCP servers are **skipped** with warnings. Watch for SSE/HTTP support in OpenCode itself.
  - **`planMode` support** — today it's a warning + no-op. If OpenCode ships a read-only sandbox, wire it up.
  - **v2 client stability** — question flow uses a separate v2 client; consider collapsing once v1 ships parity.
  - **Session resumption** — partial; track whether OpenCode exposes a stable sessionId+resume API.
  - **Bundled OpenCode CLI** — consider bundling or documenting the install step. Today `isOpencodeAvailable()` only checks PATH and doesn't install.
  - **Port collision** — `getAvailablePort()` is a race if the adapter is instantiated many times in parallel.

<!-- anchor: 3q1rknwz -->
## Native API surface

- **Entry**: `createOpencodeClient(baseUrl)` (v1) + `createOpencodeV2Client(baseUrl)` (v2 for questions). Local OpenCode server binds to `127.0.0.1:${availablePort}`.
- **Flow**:
  1. `client.session.create({ ... })` → `sessionId`
  2. `client.event.subscribe(...)` → SSE stream of events
  3. Optionally `v2Client.event.subscribe(...)` filtered by `sessionId` for `question.asked`
  4. `client.session.promptAsync({ sessionId, prompt, providerID, modelID, systemPrompt, ... })` to start the run
- **Event kinds** (v1 SSE):
  - `message.part.updated` — with `.part.type`: `text`, `reasoning`, `tool` (states: `running`, `completed`, `error`)
  - `session.idle` — terminal signal
  - `session.error`
- **Event kinds** (v2 SSE, filtered):
  - `question.asked { sessionId, questionId, question, options, ... }`
  - `question.replied`, `question.rejected`

<!-- anchor: 1a9m42w4 -->
## Event mapping table

| Native | UnifiedEvent | Notes |
|---|---|---|
| `message.part.updated` part.type=`text` | `text_delta` + accumulated into `assistant_message` on state change | |
| `message.part.updated` part.type=`reasoning` | `thinking` | incremental, `replace` omitted |
| `message.part.updated` part.type=`tool` state=`running` | `tool_use` + synthesized `subagent_started` | |
| `message.part.updated` part.type=`tool` state=`completed` | `tool_result` + synthesized `subagent_completed` | |
| `message.part.updated` part.type=`tool` state=`error` | `tool_result { isError: true }` + synthesized `subagent_completed` with error status | |
| v2 `question.asked` (filtered by sessionId) | `user_input_request` (source=`'model-tool'`) | consumer's `onUserInput` response is POSTed back via v2 client |
| `session.idle` | `result` | accumulates usage across the run |
| `session.error` | `error` | |

<!-- anchor: vkk8pa6b -->
## Quirks & gotchas

1. **OpenCode CLI required in PATH.** `isOpencodeAvailable()` is checked at startup; if false, the adapter won't fail outright but downstream calls will. Document the install step (`brew install opencode-ai/tap/opencode` or equivalent).
2. **Two parallel SSE subscriptions.** v1 for message/tool/session events, v2 for `question.asked`. The v2 subscription is only opened when `onUserInput` is provided. Both must be cleaned up on `abort()`.
3. **Port allocation.** `getAvailablePort()` finds a free port for local OpenCode HTTP server. Race condition risk if many adapters start simultaneously.
4. **Model string format is `${providerID}/${modelID}`.** The adapter splits `params.model` on `/` to derive both. If the model string doesn't contain a slash, you'll get undefined `providerID`.
5. **MCP support is stdio-only.** SSE, HTTP, and in-process SDK MCP servers are **silently skipped** with warning events. If you rely on MCP for a feature, pre-flight that all servers are stdio.
6. **`planMode` is ignored.** Adapter emits a warning event and proceeds as if `planMode: false`. Read-only runs are not supported.
7. **`architectureConfig` keys** (`src/adapters/opencode.ts:56+`):
   - `opencode_apiKey` — provider API key (fallback `process.env.OPENROUTER_API_KEY` for OpenRouter)
   - `opencode_baseUrl` — per-provider base URL override
   - `opencode_providerID` — override the parsed providerID
   - `opencode_model` — override the full `provider/model` string
   - `opencode_temperature`, `opencode_topP` — inference params
8. **Question flow is POST-back**, not a promise. When `question.asked` arrives, the adapter calls `onUserInput`; the response is POSTed to the v2 client's question-reply endpoint. Failure to POST stalls the run indefinitely (until abort).
9. **`opencode-openrouter` architecture** uses OpenRouter as the provider; model aliases (`claude-sonnet-4`, `claude-opus-4`, `gemini-2.5-pro`, `deepseek-r1`) resolve to `anthropic/...`, `google/...`, `deepseek/...` strings.

<!-- anchor: y44duhba -->
## Skills support

**Native support: first-class, fully dynamic, and interop-friendly with Claude Code's skill directory.**

<!-- anchor: uqb5k32u -->
### Discovery (widest of any adapter)

Project (walked up from cwd to git worktree root):
- `.opencode/skills/<name>/SKILL.md`
- `.claude/skills/<name>/SKILL.md` ← **same directory claude-code uses; zero-config interop**
- `.agents/skills/<name>/SKILL.md` ← same directory codex uses

Global:
- `~/.config/opencode/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`
- `~/.agents/skills/<name>/SKILL.md`

<!-- anchor: z2l1bgtn -->
### File format

`SKILL.md` with YAML frontmatter:
- `name` — 1-64 chars, regex `^[a-z0-9]+(-[a-z0-9]+)*$`
- `description` — 1-1024 chars
- Optional: `license`, `compatibility`, `metadata`

<!-- anchor: dieb67dc -->
### Dynamic loading

**Native `skill` tool** — OpenCode injects a tool the model can call to load any skill's body on-demand. Lazy, progressive-disclosure semantics. On `session.compacted` events the server re-injects the skill listing so long sessions don't lose access.

<!-- anchor: ft1o7x3h -->
### Permission gating

`opencode.json` takes a `skills` block with three behaviors per pattern: `allow` (auto-loads), `deny` (hidden from agent), `ask` (prompts user). Wildcards supported (e.g. `internal-*`).

<!-- anchor: 6m1r3cu2 -->
### Programmatic injection pattern

Not officially part of the SDK reference, but community plugins (`zenobi-us/opencode-skillful`, `joshuadavidthomas/opencode-agent-skills`) inject skills into a session by POSTing messages with:
- `synthetic: true` — marks the message as system-generated
- `noReply: true` — agent observes content without being forced to respond

and by listening to `session.compacted` events to re-inject.

<!-- anchor: 34ob4cb6 -->
### Our adapter status

`src/adapters/opencode.ts` does nothing about skills, **and this is fine for the filesystem path** — skills under `.claude/skills/` or `.opencode/skills/` in the consumer's cwd are auto-discovered by the OpenCode server the adapter spawns. Zero code change needed for the common case.

Gaps to close if we ever want programmatic control:
- No way to pass `allowedSkills` / `deniedSkills` per call (would require generating an `opencode.json` snippet or using the plugin hooks)
- No unified `skill_invoked` event — the skill tool call appears as a regular `tool_use` named `skill` in our stream

TODO (add to version watch):
- First-class `sessionOptions.skills` on `client.session.create` (watch sst/opencode changelog)
- Unified `skill_*` events in our taxonomy once a second adapter supports them

<!-- anchor: z9qbf6pm -->
## Troubleshooting recipes

- **"Adapter starts but no events arrive"**
  → Check `isOpencodeAvailable()` — the OpenCode CLI binary must be in PATH. If absent, SSE will never connect. Also check firewall: local `127.0.0.1:${port}` binding may be blocked.

- **"`question.asked` fires but my handler is never called"**
  → The v2 subscription only opens when `onUserInput` is provided to `RuntimeExecuteParams`. If you provided only the deprecated `onElicitation`, confirm the internal bridge is active (it should be, but worth checking on version bumps).

- **"Model resolves to `undefined/gpt-4o`"**
  → Your model string is missing the `providerID/` prefix. For `opencode-openrouter` architecture, aliases like `claude-sonnet-4` resolve to `anthropic/claude-sonnet-4` automatically via `resolveModel`; for custom architectures, pass the full `provider/model` string.

- **"MCP server isn't connecting"**
  → Check the server `type`. Only `stdio` is supported — SSE/HTTP/SDK are skipped. Convert the server to stdio (if possible) or move that MCP dependency to a different adapter.

- **"`planMode: true` let the model still run writes"**
  → Expected — OpenCode ignores `planMode`. Warning is emitted once. If you need plan mode, pick a different adapter (claude-code, codex, gemini) or wrap the MCP tools you expose.

- **"Session never terminates after prompt"**
  → A pending `question.asked` is likely waiting for a POST-back. Either abort, or ensure `onUserInput` returns (any action, including `'cancel'`).

- **"Port-in-use error on adapter start"**
  → `getAvailablePort()` race. Retry, or serialize adapter construction with a mutex in the consumer.

- **"Usage numbers missing on `result`"**
  → OpenCode sometimes omits usage on `session.idle`. Adapter forwards whatever it got; if empty, consumer should treat as unknown. Don't interpolate.

<!-- anchor: 0b0f3611 -->
## Key files

- `src/adapters/opencode.ts` — implementation (v1 + v2 SSE plumbing, port allocation, provider/model split)
- `src/testing/e2e/opencode.e2e.test.ts` — expected event shape per scenario
- `src/models.ts:33-38` — `opencode-openrouter` model aliases
- `package.json` — pinned `@opencode-ai/sdk` version
