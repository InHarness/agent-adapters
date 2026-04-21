---
name: gemini-cli-core
description: >-
  Use when editing src/adapters/gemini.ts or src/testing/e2e/gemini.e2e.test.ts,
  bumping @google/gemini-cli-core in package.json, debugging missing
  thinking/usage events, ask_user partial support, session resumption from
  ~/.gemini/projects, MCP server wiring, or extending UnifiedEvent. Gemini
  thinking is non-delta (replace:true), ask_user uses MessageBus
  TOOL_CONFIRMATION_REQUEST (not ASK_USER_REQUEST), 2.5-flash sometimes reports
  0 output tokens requiring char-length fallback.
---

<!-- anchor: 6hxxl4ka -->
# gemini adapter — `@google/gemini-cli-core`

Gemini has the most internal plumbing of any adapter: a `LegacyAgentSession` driven by a `MessageBus`, thread-keyed subagent events, non-delta thinking, and filesystem-based session resumption. It's also on an internal-CLI package (not the public Google Gen AI SDK), so API breakage is more likely.

<!-- anchor: e1potdn2 -->
## Why this package (and why we keep it despite being internal)

This adapter exists for one strategic reason: **`@google/gemini-cli-core` is the only package in the Google ecosystem that supports free-tier Code Assist for Individuals OAuth** — logging in with a personal Google account to get free-tier quota without an API key or paid Vertex subscription. Every alternative (`@google/genai` Interactions API, `@google/adk`) requires an API key, Workspace OAuth, or a Vertex service account.

The package is **internal to the `gemini-cli` monorepo**. Google has not published a formal public SDK — tracked in [google-gemini/gemini-cli#15539](https://github.com/google-gemini/gemini-cli/issues/15539) (opened Dec 2025; no timeline at the time of writing). API surface can change between versions without deprecation notice. We accept this risk because rebuilding personal-account OAuth ourselves, or dropping free-tier support, is worse.

**Routing rule for callers**:
- Free-tier personal OAuth → **this adapter** (`gemini-cli-core`)
- API key / Workspace OAuth / Vertex, single-agent call → sibling skill **`google-genai`** (Interactions API; Beta, documented)
- Multi-agent orchestration → sibling skill **`google-adk`** (Agent Development Kit for TypeScript; pre-GA for TS)

<!-- anchor: ahkle4mi -->
## Official documentation & sources

- **Repo** (monorepo: `packages/core`, `packages/cli`, `packages/a2a-server`): https://github.com/google-gemini/gemini-cli
- **Package README**: https://github.com/google-gemini/gemini-cli/tree/main/packages/core
- **npm**: https://www.npmjs.com/package/@google/gemini-cli-core
- **Releases / changelog**: https://github.com/google-gemini/gemini-cli/releases
- **Gemini API reference** (models, thinking, usage semantics): https://ai.google.dev/gemini-api/docs
- **Thinking config**: https://ai.google.dev/gemini-api/docs/thinking
- **⚠️ Not to be confused with `@google/genai`** (public Google Gen AI SDK) — `gemini-cli-core` is an *internal CLI package* and its API can change without deprecation notice. Always re-check types on version bumps.

<!-- anchor: y4du4389 -->
## Pinned version & TODO

- **Dev**: `^0.38.0` (`package.json`)
- **Peer**: `>=0.38.0`
- **TODO / things to watch**:
  - **ASK_USER_REQUEST channel** — currently we bridge via `TOOL_CONFIRMATION_REQUEST` with `ask_user` details. When Gemini ships a proper `ASK_USER_REQUEST` channel, rewrite the handler and drop the "auto-cancel then async reply" shim.
  - **Thinking deltas** — Gemini 3.1 may ship incremental thinking. If so, switch to `replace: false` for 3.1 models (or feature-detect) and keep `replace: true` only for 2.5.
  - **Output token estimation fallback** — 2.5-flash's `candidatesTokenCount: 0` bug; if Google fixes it, remove the ~4-chars-per-token estimation.
  - **`LegacyAgentSession` rename** — "Legacy" in the type name is a warning; a newer session class may replace it. Watch imports.
  - **Session file format** — resumption reads `~/.gemini/projects/*/chats/*`; format has changed before. Re-test resume after every version bump.
  - **Formal public SDK** — watch [gemini-cli#15539](https://github.com/google-gemini/gemini-cli/issues/15539). If Google publishes `@google/gemini-sdk` or stabilizes `gemini-cli-core` as public, remove the "internal" warnings in this skill and consider relaxing defensive code in `src/adapters/gemini.ts`.

<!-- anchor: oni9mqh1 -->
## Native API surface

- **Entry**: construct `Config { sessionId, targetDir, cwd, debugMode, model, approvalMode, excludeTools, maxSessionTurns, mcpServers, modelConfigServiceConfig }`, build `LegacyAgentSession` via `initialize()` **or** `resumeChat()`, then `session.sendStream(prompt)` yields events.
- **Event kinds** (union):
  - `initialization`, `session_update` — setup events
  - `message` — `{ role: 'agent' | 'user', content: [{ type: 'text'|'thought'|'media', ... }] }`
  - `tool_request { threadId, toolName, input, requestId }`
  - `tool_response { threadId, requestId, output, isError }`
  - `tool_update { threadId, ... }` — progress
  - `agent_end { threadId, status, usage? }`
  - `usage { inputTokens, outputTokens }`
  - `elicitation_*` — Gemini's own elicitation events (separate from MessageBus ask_user)
  - `error`
- **MessageBus** — a separate event bus on the `Config`; adapter subscribes to `TOOL_CONFIRMATION_REQUEST` with `details.type === 'ask_user'` for user-input bridging.

<!-- anchor: v5aipfzs -->
## Event mapping table

| Native | UnifiedEvent | Notes |
|---|---|---|
| `message` (role=agent, content.type=text) | `text_delta` + eventually `assistant_message` | chunks aggregated; `subagentTaskId` = `event.threadId` when present |
| `message` content.type=`thought` | `thinking { replace: true }` | **not a delta** — the full current thought summary; `subagentTaskId` = `event.threadId` when present |
| `tool_request` (with `threadId`) | `subagent_started` + `tool_use` | synthesized; `threadId` → `taskId` → `subagentTaskId` on the `tool_use` |
| `tool_update` (with `threadId`) | `subagent_progress` | synthesized |
| `tool_response` | `tool_result` | correlated by `requestId`; `event.isError` (set by gemini-cli-core when `ToolCallResponse.error` is present) is passed through to `tool_result.isError`; `subagentTaskId` = `event.threadId` when present |
| `agent_end` (with `threadId`) | `subagent_completed` | synthesized; status/usage forwarded |
| `usage` | accumulated into next `result` | not emitted as its own event |
| MessageBus `TOOL_CONFIRMATION_REQUEST` details.type=`ask_user` | `user_input_request` (source=`'model-tool'`) | **only when `onUserInput` is provided** — else `ask_user` tool is excluded via `excludeTools` |
| `error` | `error` | |
| final flush | `result` | includes estimated usage if native is 0 |

<!-- anchor: ewtqml5f -->
## Quirks & gotchas

1. **Thinking is non-delta.** Gemini emits the *full current thought summary* each time, not additions. The adapter sets `replace: true` on the event so downstream knows to overwrite prior thinking text rather than append. Don't concat — you'll see duplicated paragraphs.
2. **ask_user bridge is partial.** The scheduler auto-replies with Cancel on `TOOL_CONFIRMATION_REQUEST` before our async `onUserInput` handler can respond. We ship a bridge via `TOOL_CONFIRMATION_REQUEST` with `details.type === 'ask_user'`, but there's a race: the user sometimes doesn't have time to answer. Treated as **partial support** in the capability matrix.
3. **`ask_user` is excluded unless `onUserInput` is provided.** The adapter sets `excludeTools: ['ask_user']` by default; presence of the handler flips it on. Preserves behavior for consumers that don't handle it.
4. **Output token estimation.** `gemini-2.5-flash` sometimes emits `candidatesTokenCount: 0`. The adapter falls back to `~text.length / 4` as the output token estimate. If usage numbers look suspiciously round, that's the reason.
5. **Session resumption reads files directly.** Given a `resumeSessionId` shortId, the adapter scans `~/.gemini/projects/<dirhash>/chats/` and matches. Uses `resumeChat()` (not `initialize()`) to avoid overwriting the file.
6. **`approvalMode`** maps: `planMode: true` → `'plan'`; otherwise → `'yolo'`. No `'default'` or `'auto'` middle ground.
7. **MCP mapping takes positional args.** The adapter translates our `McpServerConfig` union into `GeminiMCPServerConfig(command, args, env, cwd, url, httpUrl, headers, tcp, type)`. If Gemini reorders constructor params, all four transport types break — re-verify on every bump.
8. **`subagentTaskId` is a direct pass-through of `event.threadId`.** No state tracking needed — every event that belongs to a subagent already carries `threadId`, which is the same value used as `taskId` on the synthesized `subagent_started`. Emit it verbatim on `text_delta`, `thinking`, `tool_use`, `tool_result`. Top-level events have no `threadId` → leave `subagentTaskId` undefined and `isSubagent: false`.
9. **`architectureConfig` keys** (`src/adapters/gemini.ts:182+`):
   - `gemini_approvalMode` — `'plan' | 'yolo' | ...` (overridden by `planMode: true`)
   - `gemini_temperature`, `gemini_topP`, `gemini_topK`
   - `gemini_thinkingBudget: number` — sets `thinkingConfig.thinkingBudget`
   - `gemini_thinkingLevel` — alternative, sets `thinkingConfig.thinkingLevel` (only if `thinkingBudget` absent)

<!-- anchor: pnayxngd -->
## Skills support

**Native support: partial and awkward — only via the Extensions bundle, no standalone skills, no dynamic loading, no public SDK.**

<!-- anchor: 9hh3pz2a -->
### Shape of the feature

Gemini CLI ships *Extensions* — a "shipping container" for customizations declared by a `gemini-extension.json` manifest. Inside an extension:
- `commands/` — custom slash commands (TOML-only today; markdown is an open feature request: [google-gemini/gemini-cli#15535](https://github.com/google-gemini/gemini-cli/issues/15535))
- `skills/<name>/SKILL.md` — Anthropic-style skill definitions
- MCP servers, prompts, hooks

Skills are only discoverable as part of a registered extension — there's no top-level `~/.gemini/skills/` or project `.gemini/skills/` analogous to Codex/OpenCode.

<!-- anchor: q3lf8u3o -->
### Dynamic loading

**None documented.** Per the extension reference: *"All management operations, including updates to slash commands, take effect only after you restart the CLI session."* Skills/commands added at runtime are not picked up without a restart.

<!-- anchor: n57cq6v5 -->
### Programmatic API

**No public surface in `@google/gemini-cli-core`.** The package is internal to the `gemini-cli` monorepo (see "Why this package" section above), and its reference documents `Config`, `LegacyAgentSession`, and the event model — not skills. There's no `listSkills()`, no `AgentInput.skills`, no skill-aware hook.

<!-- anchor: 46tvikok -->
### Our adapter status

`src/adapters/gemini.ts` **cannot pass skills** even if we wanted to. Even filesystem drop-in into `.gemini/extensions/<name>/skills/` requires a runtime restart per docs — and the adapter spins a fresh `LegacyAgentSession` per execute, so in theory each run could see updated skills, but this is not documented or tested behavior.

Treat skills as **unsupported for this adapter** until (a) `@google/gemini-cli-core` stabilizes as a public SDK and grows skills APIs, or (b) Google ships a formal `@google/gemini-sdk` per the long-standing request at [gemini-cli#15539](https://github.com/google-gemini/gemini-cli/issues/15539).

TODO (add to version watch):
- Markdown-based custom commands (gemini-cli#15535)
- Programmatic skill listing / per-session enablement
- Move out of Extensions-only constraint

<!-- anchor: ub8ipccx -->
## Troubleshooting recipes

- **"Thinking text is duplicated / grows weirdly"**
  → You're treating `thinking` events as deltas. Gemini emits `replace: true` — overwrite, don't concat. Check your consumer's accumulation logic.

- **"`ask_user` tool calls auto-cancel"**
  → Known partial-support issue. The scheduler races your async handler. Mitigations: (a) keep the handler fast (<1s), (b) wrap in a retry on the model side, (c) wait for the ASK_USER_REQUEST channel (TODO above).

- **"`onUserInput` handler never fires for Gemini"**
  → Without the handler in `RuntimeExecuteParams`, `ask_user` is excluded via `excludeTools`. Provide the handler and re-run.

- **"Usage input/output tokens are zero-ish"**
  → 2.5-flash bug: `candidatesTokenCount = 0`. Adapter estimates `~chars/4`. Check `src/adapters/gemini.ts` fallback branch. If you need exact counts, switch to a different Gemini model (e.g. 2.5-pro).

- **"Resume session fails silently"**
  → The shortId must match a file in `~/.gemini/projects/<hash>/chats/`. The hash is derived from `cwd` — resuming from a different `cwd` won't find the session. Use the same working directory.

- **"MCP server config with `url` isn't connecting"**
  → `GeminiMCPServerConfig` takes **positional** args; if Gemini changed the order, the wrong field carries your URL. Grep the SDK's source or its `.d.ts` file on a version bump — the arg list is unstable.

- **"Missing `session_update` / `initialization` events in my consumer"**
  → These are eaten by the adapter (they're setup noise). If you need them, add a passthrough path.

- **"Subagent events never fire"**
  → Gemini only emits subagent events when a tool call has a `threadId`. Top-level tool calls (no `threadId`) map to plain `tool_use` / `tool_result`.

<!-- anchor: 3u7jl1n3 -->
## Key files

- `src/adapters/gemini.ts` — implementation (look for MessageBus handling + session file resolution)
- `src/testing/e2e/gemini.e2e.test.ts` — expected event shape per scenario
- `src/models.ts:39-47` — Gemini model aliases
- `package.json` — pinned `@google/gemini-cli-core` version
