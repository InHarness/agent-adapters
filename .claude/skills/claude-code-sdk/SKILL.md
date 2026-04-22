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
  - Per-MCP-tool filtering at the options level — currently needs a `PreToolUse` hook matcher (see "Permission model"). If a first-class allow/deny list for MCP tool names lands in `Options`, revisit the `planMode` mapping and consider exposing `params.planModeAllowedTools`.

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
| `stream_event` → `text_delta` | `text_delta` | 1:1, `isSubagent` from context; `subagentTaskId` resolved via `parent_tool_use_id → task_id` map |
| `stream_event` → `thinking_delta` | `thinking` | incremental, `replace` omitted/false; `subagentTaskId` resolved same way as `text_delta` |
| `assistant` | `assistant_message` | full `NormalizedMessage`, content blocks mapped |
| `user` (tool_result inside) | `assistant_message` (role user) + `tool_result` per block | each `tool_result` block's `is_error` is passed through to both `ContentBlock.toolResult.isError` and `UnifiedEvent.tool_result.isError` |
| `system` subtype=`task_started` | `subagent_started` | `taskId` from event, `toolUseId` from parent Task call |
| `system` subtype=`task_progress` | `subagent_progress` | |
| `system` subtype=`task_notification` | `subagent_progress` | same mapping |
| `system` subtype=`compact_boundary` | `flush` | |
| `tool_use_summary` | `tool_use` + synthetic `tool_result` | accumulated; `isSubagent` flagged |
| `canUseTool('AskUserQuestion', ...)` | `user_input_request` (source=`'model-tool'`) | adapter intercepts, calls `onUserInput` |
| `options.onElicitation(req)` | `user_input_request` (source=`'mcp-elicitation'`) | MCP side-channel |
| `tool_use { toolName: 'TodoWrite' }` inside assistant | `todo_list_updated` (source=`'model-tool'`) + `ContentBlock.todoList` | **replaces** both `tool_use` event and `ContentBlock.toolUse` in rawMessages. The matching `tool_result` is also suppressed — its `{ oldTodos, newTodos }` payload is redundant. `result.todoListSnapshot` carries the last seen items. See `src/adapters/claude-code.ts:todoItemsFromTodoWriteInput` for the mapping (id is synthesized from array index). |
| `result` | `result` | includes `sessionId` for resume, `todoListSnapshot` when TodoWrite was used |

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
8. **`subagentTaskId` on deltas requires a local lookup.** The SDK puts `parent_tool_use_id` on every `stream_event`, but the true subagent `taskId` only appears on the `task_started` system event. Adapter keeps a `Map<parent_tool_use_id, task_id>` per `execute()` call, populated on `task_started` and read on every delta / tool event. If a delta arrives before `task_started` (race), `isSubagent: true` is emitted with `subagentTaskId: undefined` — acceptable graceful degradation.

<!-- anchor: pm3x9k7q -->
## Permission model & read-only agents

Critical mental model for anyone wiring restrictions around `planMode` or MCP tools. The SDK evaluates every tool call in this order, short-circuiting on the first decision:

1. **Hooks** (`PreToolUse`) — can `allow` / `deny` / pass through
2. **Deny rules** — entries in `disallowedTools`
3. **Permission mode** — `permissionMode`
4. **Allow rules** — entries in `allowedTools` (auto-approve)
5. **`canUseTool`** callback — last-resort runtime gate

Implications:

- `permissionMode: 'plan'` blocks at step 3. `allowedTools` (step 4) and `canUseTool` (step 5) run **after** and cannot override it. Only a `PreToolUse` hook (step 1) can.
- `allowedTools` never controls which tools Claude *sees* — only whether they auto-approve. JSDoc on `Options.allowedTools` in `sdk.d.ts`: *"To restrict which tools are available, use the `tools` option instead."*
- MCP servers listed in `mcpServers` are **spawned and listed to the model even in `permissionMode: 'plan'`**. Plan mode only gates execution, not discovery.

<!-- anchor: 8vb4lq6e -->
### Options that actually shape Claude's tool catalog

Verified against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

- **`tools: string[] | { type: 'preset'; preset: 'claude_code' }`** — *"Specify the base set of available built-in tools. `[]` disables all built-in tools"*. Filters **built-ins only**; MCP tools are unaffected.
- **`disallowedTools: string[]`** — *"These tools will be removed from the model's context and cannot be used, even if they would otherwise be allowed."* Hides from the catalog, not just gates execution. Works for built-in names. Filtering MCP tool names (`mcp__server__tool`) via this list is not documented and should not be relied on.
- **`allowedTools: string[]`** — auto-approve list only. Does not hide anything.
- **`permissionMode`** values (`'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`):
  - `'plan'` — blocks all tool execution; model can still see everything.
  - `'bypassPermissions'` — approves everything visible (requires `allowDangerouslySkipPermissions: true`). Our default for non-plan runs.
  - `'dontAsk'` — deny if not pre-approved (i.e. only `allowedTools` entries pass). Headless-safe alternative to `bypassPermissions` when you want a hard allow-list.

<!-- anchor: j7sdrh24 -->
### What the SDK can NOT do at the options level

- Filter `Bash` subcommands (`Bash(rm:*)` syntax belongs to Claude Code's hooks system, not the SDK's options).
- Whitelist individual MCP tools within a connected server. Per-tool MCP filtering requires a `PreToolUse` hook with a matcher, or server-side curation (pick which tools the MCP server exposes).

<!-- anchor: k9p2cxzl -->
### Read-only agent: two implementation options

**Option A — plan mode + `PreToolUse` hook to unblock selected tools**

```ts
options.permissionMode = 'plan';
options.hooks = {
  PreToolUse: [{
    matcher: 'mcp__readonly_server__.*',
    hooks: [async () => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    })],
  }],
};
```

- **When it fits**: a single MCP server exposes mixed read/write tools and you need to pick individual ones by name (e.g. allow `search_docs`, deny `delete_document` within the same server).
- **Cost**: the model sees the full catalog (all built-ins, all MCP tools) and may still attempt `Edit` / `Write` / blocked MCP tools — they fail at the gate and emit a `blocked`-style `tool_result`. Wasted turns, noisier event stream.

**Option B — restrict visibility: `tools` + `disallowedTools`** (adapter default as of this revision)

```ts
options.permissionMode = 'bypassPermissions';
options.allowDangerouslySkipPermissions = true;
options.tools = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'TodoWrite', 'AskUserQuestion'];
options.disallowedTools = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task'];
// Consumer is responsible for passing only read-only MCP servers in params.mcpServers.
```

- **When it fits**: general "read-only agent" semantics. Read/write split is done per-MCP-server rather than per-MCP-tool — the consumer curates `params.mcpServers` to only include read-only servers.
- **Cost**: built-ins are binary (no `Bash` means no `git log`, since the SDK can't filter sub-commands). MCP filtering happens at the server boundary.

<!-- anchor: z6fr2p5x -->
### Current adapter choice

`src/adapters/claude-code.ts` maps `params.planMode: true` to **Option B**. `permissionMode: 'plan'` is intentionally **not** used — its "block everything" semantics contradict the `RuntimeExecuteParams.planMode` contract documented in `src/types.ts` (*"read-only tools allowed, writes/edits/shell-mutations blocked"*), which must leave consumer-curated MCP tools executable.

Constants (in `src/adapters/claude-code.ts`):
- `CLAUDE_CODE_READONLY_BUILTINS` — the `tools` allow-list.
- `CLAUDE_CODE_MUTATING_BUILTINS` — the `disallowedTools` belt-and-suspenders list.

**If a future requirement needs individual MCP tool filtering** (one server exposing both read and write tools, and only the read ones should execute), switch to **Option A** or introduce a separate param (e.g. `planModeAllowedTools: string[]`) that the adapter turns into a synthesized `PreToolUse` hook. Don't reach for `canUseTool` — it runs after plan mode and cannot override it.

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
