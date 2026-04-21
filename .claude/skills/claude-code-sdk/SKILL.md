---
name: claude-code-sdk
description: >-
  Use when editing src/adapters/claude-code.ts or
  src/testing/e2e/claude-code.e2e.test.ts, bumping
  @anthropic-ai/claude-agent-sdk in package.json, debugging missing/unexpected
  events from the Claude Code adapter (thinking, subagents, AskUserQuestion, MCP
  elicitation, resume), or extending UnifiedEvent and needing to know what
  claude-code can emit natively. Covers Opus 4.7 ADAPTIVE_THINKING_ONLY,
  claude_* architectureConfig keys, dual-channel user input, and preset system
  prompts.
---

<!-- anchor: 5i6ubzxc -->
# claude-code adapter — `@anthropic-ai/claude-agent-sdk`

This is the **reference adapter** — closest to the UnifiedEvent semantics, because the unified layer was originally designed around Claude Code's event model. Use it as the baseline when extending `src/types.ts` or sanity-checking other adapters.

<!-- anchor: mw4jf15k -->
## Official documentation & sources

- **Overview**: https://docs.claude.com/en/docs/claude-code/sdk
- **TypeScript SDK reference**: https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript
- **Repo (TypeScript SDK)**: https://github.com/anthropics/claude-agent-sdk-typescript
- **npm**: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- **MCP docs (server setup, elicitation)**: https://docs.claude.com/en/docs/claude-code/mcp
- **Anthropic Messages API reference** (for thinking/effort parameters): https://docs.claude.com/en/api/messages

<!-- anchor: 0vsr6pry -->
## Pinned version & TODO

- **Dev**: `^0.2.109` (`package.json`)
- **Peer**: `>=0.2.0`
- **TODO / things to watch**:
  - New thinking modes (beyond ADAPTIVE_THINKING_ONLY). Keep `src/models.ts:ADAPTIVE_THINKING_ONLY` in sync when Anthropic ships a new Opus.
  - Elicitation API stability — `options.onElicitation` is still relatively new; watch for signature changes.
  - `canUseTool` callback ergonomics — if the SDK adds a first-class ask-user tool type, reduce our custom AskUserQuestion plumbing.
  - Preset expansion — currently only `'claude_code'`. If more presets ship, `claude_usePreset` should accept them.

<!-- anchor: da7anbcx -->
## Native API surface

- **Entry**: `query({ prompt, options })` returns an async iterable of `SDKMessage` objects.
- **Options** (key fields used by the adapter):
  - `model` — full model ID (resolved via `resolveModel`)
  - `systemPrompt: string | { type: 'preset'; preset: string }`
  - `maxTurns`, `permissionMode` (`'default' | 'plan' | ...`), `cwd`
  - `thinking: { type: 'enabled' | 'adaptive'; budget_tokens? }`
  - `effort: 'low' | 'medium' | 'high'`
  - `mcpServers` — `McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig`
  - `canUseTool(toolName, input) => Promise<...>` — fires before a tool call; used by adapter for `AskUserQuestion` bridging
  - `onElicitation(request) => Promise<...>` — MCP server elicitation side-channel
  - `resume: sessionId` — native session resumption
  - `env` — pass-through env vars for the spawned process

- **Message types** (`SDKMessage`):
  - `stream_event` — sub-events `text_delta`, `thinking_delta`, etc.
  - `assistant`, `user` — complete messages
  - `system` — with `subtype`: `init`, `task_started`, `task_progress`, `task_notification`, `compact_boundary`
  - `tool_use_summary` — accumulated tool-use summary
  - `result` — final with usage, session id

<!-- anchor: zmlptiyv -->
## Event mapping table

| Native (SDK) | UnifiedEvent | Notes |
|---|---|---|
| `stream_event` → `text_delta` | `text_delta` | 1:1, `isSubagent` from context |
| `stream_event` → `thinking_delta` | `thinking` | incremental, `replace` omitted/false |
| `assistant` | `assistant_message` | full `NormalizedMessage`, content blocks mapped |
| `user` (tool_result inside) | `assistant_message` (role user) + `tool_result` per block | each `tool_result` block's `is_error` is passed through to both `ContentBlock.toolResult.isError` and `UnifiedEvent.tool_result.isError` |
| `system` subtype=`task_started` | `subagent_started` | `taskId` from event, `toolUseId` from parent Task call |
| `system` subtype=`task_progress` | `subagent_progress` | |
| `system` subtype=`task_notification` | `subagent_progress` | same mapping |
| `system` subtype=`compact_boundary` | `flush` | |
| `tool_use_summary` | `tool_use` + synthetic `tool_result` | accumulated; `isSubagent` flagged |
| `canUseTool('AskUserQuestion', ...)` | `user_input_request` (source=`'model-tool'`) | adapter intercepts, calls `onUserInput` |
| `options.onElicitation(req)` | `user_input_request` (source=`'mcp-elicitation'`) | MCP side-channel |
| `result` | `result` | includes `sessionId` for resume |

<!-- anchor: pqk13bxx -->
## Quirks & gotchas

1. **Opus 4.7 requires adaptive thinking.** `src/models.ts:ADAPTIVE_THINKING_ONLY` lists model IDs that reject fixed-budget thinking. The adapter auto-converts `{ type: 'enabled', budget_tokens: N }` into `{ type: 'adaptive' }` for those models. When a new Opus ships, verify whether it also needs this.
2. **Dual-channel user input**:
   - **Model-tool channel**: `canUseTool` with `toolName === 'AskUserQuestion'` — the model is asking the user directly. Adapter builds `UserInputRequest` from the tool input.
   - **MCP channel**: `options.onElicitation` — an MCP server sent `elicitation/request`. Adapter builds `UserInputRequest` with `source: 'mcp-elicitation'`.
   - Both converge on the single `onUserInput` handler from `RuntimeExecuteParams`.
3. **`architectureConfig` keys** (`src/adapters/claude-code.ts:121+`):
   - `claude_thinking: { type, budget_tokens }` — thinking config (auto-adapted for Opus 4.7)
   - `claude_effort: 'low' | 'medium' | 'high'`
   - `claude_usePreset: true | 'claude_code' | <string>` — use a system prompt preset; when truthy, replaces/prepends `systemPrompt`
   - `custom_env: Record<string, string>` — env passthrough
   - `ollama_baseUrl: string` — legacy shortcut, sets `ANTHROPIC_BASE_URL` (used by `claude-code-ollama` architecture)
4. **Session resumption is native.** Pass `resumeSessionId` → adapter sets `options.resume`. No file-munging.
5. **MCP server types supported**: stdio, SSE, HTTP, in-process SDK (via `@modelcontextprotocol/sdk`'s `McpServer`). The widest coverage of all four adapters.
6. **Subagent events are first-class.** Unlike other adapters, we don't synthesize — we map. `task_started/progress/notification` carry `taskId` directly.
7. **`compact_boundary`** fires before the SDK compresses history. Emit `flush` so downstream can checkpoint.

<!-- anchor: b46yqjzy -->
## Skills support

**Native support: first-class, fully dynamic.** Skills are a built-in Claude Code concept with the widest SDK surface of any adapter we wrap.

<!-- anchor: vr2bteuk -->
### SDK surface (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)

- `AgentInput.skills?: string[]` (line 67) — preload specific skill names into the agent's context at session start
- `SettingsSource` union includes `'skills'` (line 192) — settings can originate from a skills scope
- `SettingsBase.skillOverrides: Record<string, 'on' | 'name-only' | 'user-invocable-only' | 'off'>` (line 3198) — per-skill visibility control
- `skillListingMaxDescChars` (line 3107, default `1536`) and `skillListingBudgetFraction` (line 3111, default `0.01`) — cap how many tokens the skill listing may consume per turn
- `disableSkillShellExecution` (line 3406) — security switch that replaces inline shell in skills/slash commands with a placeholder
- `strictPluginOnlyCustomization: boolean | ('skills' | ...)[]` (line 3434) — restrict skills to plugin-scoped only
- `Query.supportedCommands(): Promise<SlashCommand[]>` (line 1765) — runtime skill/command discovery
- `SlashCommand { name, description, argumentHint }` (lines 4369-4381) — skill descriptor shape
- `ConfigChange` hook with `source: 'skills'` (line 192) — fires when skill files change on disk

<!-- anchor: rvzindrz -->
### Dynamic loading

**Progressive disclosure**: at init, the SDK ships only `{ name, description }` per skill into the model context (budgeted by `skillListingBudgetFraction`). The body of `SKILL.md` is loaded into context only when the model invokes the skill. No restart required — file changes trigger a `ConfigChange` hook.

<!-- anchor: cmgr1my5 -->
### Filesystem discovery

`.claude/skills/<name>/SKILL.md` (project), `~/.claude/skills/<name>/SKILL.md` (user), plus plugin-bundled skills via `options.plugins`.

<!-- anchor: w8l32dhd -->
### Our adapter status

`src/adapters/claude-code.ts` passes **none** of these fields today. A `grep -ri "skill" src/` returns zero matches. Gap to close when adding skills support:

- Surface `claude_skills: string[]`, `claude_skillOverrides: Record<string, ...>`, `claude_skillListingBudgetFraction: number`, `claude_disableSkillShellExecution: boolean` via `architectureConfig`
- Optionally expose `supportedCommands()` output as a pre-execute hook so consumers can pick skills programmatically
- Consider emitting a synthetic `skill_invoked` unified event when a skill is opened (today the invocation is not distinguishable from a regular text turn)

<!-- anchor: tzqm6r7w -->
## Troubleshooting recipes

- **"Thinking events aren't showing for Opus 4.7"**
  → Opus 4.7 only accepts `type: 'adaptive'`. If you passed `{ type: 'enabled', budget_tokens: X }`, the adapter converts it; but if you bypass `architectureConfig` and set `thinking` elsewhere, the SDK will silently disable thinking. Check `src/adapters/claude-code.ts` thinking branch.

- **"`AskUserQuestion` invocations don't fire `onUserInput`"**
  → Confirm `onUserInput` (or deprecated `onElicitation`) is set on `RuntimeExecuteParams`. Without it, the adapter doesn't intercept `canUseTool`. Also: if the model calls a *different* ask-user tool, it won't bridge — name must be exactly `AskUserQuestion`.

- **"MCP elicitation request arrives but no `user_input_request` event"**
  → `options.onElicitation` is only wired when the consumer provides `onUserInput`. Re-check the handler is present and that the MCP server actually emits `elicitation/request` (test with MCP inspector).

- **"Session doesn't resume"**
  → Ensure `resumeSessionId` is the `sessionId` from a previous `result` event, not from an external store. The SDK validates the ID exists on disk (`~/.claude/projects/*/`).

- **"System prompt preset doesn't apply"**
  → `claude_usePreset: true` resolves to `'claude_code'`. For another preset pass the name as a string. The adapter overrides `systemPrompt` when a preset is present.

- **"Adapter hangs on abort()"**
  → `abort()` must propagate to the SDK's internal signal. If you see a hang, verify the adapter's `AbortController.signal` is wired into `query({ options: { abortController } })`.

<!-- anchor: dywisvaa -->
## Key files

- `src/adapters/claude-code.ts` — implementation
- `src/testing/e2e/claude-code.e2e.test.ts` — expected event shape per scenario
- `src/models.ts:ADAPTIVE_THINKING_ONLY` — thinking-mode gate
- `package.json` — pinned `@anthropic-ai/claude-agent-sdk` version
