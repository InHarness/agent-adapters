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
  - New thinking modes (beyond ADAPTIVE_THINKING_ONLY). Keep `src/models.ts:ADAPTIVE_THINKING_ONLY` in sync when Anthropic ships a new adaptive-only model. **Claude Fable 5 (`claude-fable-5`) added 2026-06-09** — adaptive-only, in the set. Watch for `claude-mythos-5` (restricted-access Mythos tier; no public model ID published yet — add the alias once Anthropic documents one).
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

1. **Opus 4.6+ and Fable 5 require adaptive thinking.** `src/models.ts:ADAPTIVE_THINKING_ONLY` lists model IDs that reject fixed-budget thinking (`claude-fable-5`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`). The adapter auto-converts `{ type: 'enabled', budget_tokens: N }` into `{ type: 'adaptive' }` for those models. The rule is documented in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (L1176-1177: `'adaptive'` is for "Opus 4.6+" and is the default for models that support it). When a new Opus/Fable ships, add it to the set.
   - **Fable 5 extra constraint (informational):** Fable 5 additionally rejects an *explicit* `thinking: { type: 'disabled' }` with a 400 (it is accepted on Opus 4.7/4.8) — the param must simply be omitted. This adapter never emits `'disabled'` (the `claude_thinking` branch only produces `'adaptive'`/`'enabled'`, and omits `thinking` entirely when unset), so the constraint is unreachable here. No adapter code is needed unless a future change starts emitting `'disabled'`.
2. **Dual-channel user input**:
   - **Model-tool channel**: `canUseTool` with `toolName === 'AskUserQuestion'` — the model is asking the user directly. Adapter builds `UserInputRequest` from the tool input.
   - **MCP channel**: `options.onElicitation` — an MCP server sent `elicitation/request`. Adapter builds `UserInputRequest` with `source: 'mcp-elicitation'`.
   - Both converge on the single `onUserInput` handler from `RuntimeExecuteParams`.
3. **`architectureConfig` keys** (`src/adapters/claude-code.ts:121+`):
   - `claude_thinking: 'adaptive' | 'enabled'` — thinking mode (auto-converted to `'adaptive'` for Opus 4.6+)
   - `claude_thinking_budget: number` — budget tokens for `'enabled'` mode; ignored for adaptive
   - `claude_thinking_display: 'summarized' | 'omitted'` — controls whether thinking text is returned. Adapter defaults to `'summarized'` for models in `ADAPTIVE_THINKING_ONLY` to undo Opus 4.7's silent `'omitted'` default. (Currently a no-op on Opus 4.7 via SDK 0.2.109 — see troubleshooting recipe.)
   - `claude_effort: 'low' | 'medium' | 'high'`
   - `claude_usePreset: true | 'claude_code' | <string>` — use a system prompt preset; when truthy, replaces/prepends `systemPrompt`
   - `custom_env: Record<string, string>` — env passthrough
   - `ollama_baseUrl: string` — legacy shortcut, sets `ANTHROPIC_BASE_URL` (used by `claude-code-ollama` architecture)
4. **Session resumption is native.** Pass `resumeSessionId` → adapter sets `options.resume`. No file-munging. **Gotcha — thinking config is immutable on resume.** The SDK replays the stored transcript, including the prior assistant turn's `thinking`/`redacted_thinking` blocks; Anthropic requires those to come back byte-identical. So resuming with a *different* `model` or `claude_thinking`/`claude_thinking_budget`/`claude_effort`/`claude_thinking_display` than the session was created with fails with `400 ... thinking blocks ... cannot be modified` (the adapter never rebuilds messages, so this is API-side, not a serialization bug). The adapter is stateless and cannot detect it; the unified layer declares the immutable set via `src/session-resume.ts` (`getSessionResumeConstraints` / `findResumeViolations`) and the `resumeImmutable` flag in `src/options.ts` so consumers lock those controls or start a new session. To change model/thinking mid-conversation, start a NEW session.
5. **MCP server types supported**: stdio, SSE, HTTP, in-process SDK (via `@modelcontextprotocol/sdk`'s `McpServer`). The widest coverage of all four adapters.
6. **Subagent events are first-class.** Unlike other adapters, we don't synthesize — we map. `task_started/progress/notification` carry `taskId` directly.
7. **`compact_boundary`** fires before the SDK compresses history. Emit `flush` so downstream can checkpoint.
8. **`subagentTaskId` on deltas requires a local lookup.** The SDK puts `parent_tool_use_id` on every `stream_event`, but the true subagent `taskId` only appears on the `task_started` system event. Adapter keeps a `Map<parent_tool_use_id, task_id>` per `execute()` call, populated on `task_started` and read on every delta / tool event. If a delta arrives before `task_started` (race), `isSubagent: true` is emitted with `subagentTaskId: undefined` — acceptable graceful degradation.
9. **`result.usage` on resume is per-call, not session-wide.** When `options.resume` is set, the SDK's `result.usage` reports only the tokens consumed by the new `query()` call — not the original session + resumed call combined. Confirmed in [Anthropic cost-tracking docs](https://code.claude.com/docs/en/agent-sdk/cost-tracking): *"each result only reflects the cost of that individual call"*. Consumers that aggregate across multiple `execute()` calls (one logical resumed session) must sum externally — use `sumUsage` / `addUsage` from `src/usage.ts`. The library-wide unified `result.usage` semantic is per-call delta; documented on `UnifiedEvent` in `src/types.ts`.

10. **Anthropic's three input buckets are rolled into a single `inputTokens`.** The Anthropic API exposes `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` as three **additive** counts. The library-wide `UsageStats` contract follows the OpenAI convention instead: `inputTokens` = TOTAL input posted to the LLM on this turn, with `cacheReadInputTokens` and `cacheCreationInputTokens` as **subsets** (overlap, not separate). `normalizeClaudeUsage` (`src/adapters/claude-code.ts`) sums all three Anthropic buckets into `inputTokens` and preserves the cache fields as informational subsets. This makes `result.contextSize` (`inputTokens + outputTokens`), the documented "fresh" formula (`inputTokens − cacheRead − cacheWrite`), and cross-adapter aggregation via `addUsage` / `sumUsage` work uniformly across codex, claude-code, gemini, and opencode. See the `UsageStats` JSDoc in `src/types.ts` for the canonical contract.

    Practical consequence: if you compare `result.usage.inputTokens` from this adapter against a value you scraped from the raw Anthropic API or from `claude` CLI output, they will differ — the unified value is bigger because it includes cache reads/writes. To recover Anthropic's raw `input_tokens` (fresh-only): `usage.inputTokens − (usage.cacheReadInputTokens ?? 0) − (usage.cacheCreationInputTokens ?? 0)`.

11. **`maxTurns` is cumulative across resumed sessions, not per-`query()`.** SDK `Options.maxTurns` counts every turn that has happened in the loaded session, then continues counting new ones. So `query({ resume: sessionId, maxTurns: 1 })` typically errors with `Reached maximum number of turns (1)` before the model can answer — the prior turn from the original session is already at the cap. Two failure modes seen in practice:
    - **Reliable**: when the resumed session's turn history has been persisted to disk and the SDK loads it before the new query runs (the common case after the script that created the session has exited cleanly).
    - **Race-conditioned**: when the resume happens quickly after the original session's `result`, the on-disk session file may not yet reflect the prior turn — the cap looks fresh and the new query succeeds. Don't rely on this; treat it as a flake.

    Recommendation: for resumed calls, omit `maxTurns` or set it generously above the prior turn count. The unified `RuntimeExecuteParams.maxTurns` JSDoc spells out the per-adapter semantics. The adapter passes `params.maxTurns` straight through to `Options.maxTurns` (`src/adapters/claude-code.ts:221`); we deliberately do NOT translate it (e.g. by computing `maxTurns = sdkPriorTurnCount + paramsMaxTurns`) because there is no SDK API to read the loaded session's turn count, and best-effort guessing would silently break consumers who actually want a session-cumulative cap.

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

- **"Thinking events aren't showing for Opus 4.6 / 4.7"**
  → Opus 4.6+ only accept `type: 'adaptive'`. If you passed `{ type: 'enabled', budget_tokens: X }`, the adapter converts it; but if you bypass `architectureConfig` and set `thinking` elsewhere, the SDK will silently disable thinking. Check `src/adapters/claude-code.ts` thinking branch.
  → **Opus 4.7 silently changed `thinking.display` default to `'omitted'`** ([Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking#controlling-thinking-display)). The adapter now passes `display: 'summarized'` automatically for any model in `ADAPTIVE_THINKING_ONLY`. Override per-call via `architectureConfig.claude_thinking_display: 'summarized' | 'omitted'`. **Fable 5 (`claude-fable-5`) shares this `'omitted'` default** and is a member of `ADAPTIVE_THINKING_ONLY`, so it gets the `'summarized'` restoration automatically — no Fable-specific handling required.
  → **Known SDK gap (observed against `@anthropic-ai/claude-agent-sdk@0.2.109`)**: even with `display: 'summarized'` explicitly set, Opus 4.7 emits zero `thinking` content blocks via this SDK — not even an empty placeholder, contrary to the Anthropic documentation. The same call against Opus 4.6 emits 10+ thinking blocks. Verified with `examples/claude-code/thinking.ts` (defaults to Opus 4.7 + the bear puzzle). Adapter-side fix is correct per docs; restoration likely needs an SDK bump or upstream issue. Use `MODEL=opus-4.6 npx tsx examples/claude-code/thinking.ts` to confirm thinking does work end-to-end through the adapter.

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
