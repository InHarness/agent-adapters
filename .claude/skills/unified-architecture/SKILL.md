---
name: unified-architecture
description: >-
  Use when editing src/types.ts, src/index.ts, src/models.ts, or adding a new
  adapter/event type to @inharness-ai/agent-adapters. Explains the
  RuntimeAdapter contract, the UnifiedEvent taxonomy, NormalizedMessage shape,
  RuntimeExecuteParams, the capability matrix across adapters, and the checklist
  for extending the unified layer without breaking adapters.
---

<!-- anchor: d4simyue -->
# Unified Architecture — the contract all SDK adapters translate to

This library exposes a single interface over heterogeneous agent SDKs. This skill is the authoritative map of what the unified layer guarantees and what is adapter-specific. Before changing anything in `src/types.ts` or adding a new event type, read this — every adapter has to keep up.

<!-- anchor: 87wbhi2j -->
## Cross-SDK references

Standards the unified layer is built on top of:

- **Model Context Protocol (MCP) spec**: https://modelcontextprotocol.io/ and https://spec.modelcontextprotocol.io/
- **MCP TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk — npm: https://www.npmjs.com/package/@modelcontextprotocol/sdk
- **MCP elicitation** (user-input side-channel spec): https://spec.modelcontextprotocol.io/specification/server/utilities/elicitation/
- **Per-adapter skills** (capability detail):
  - `claude-code-sdk` — the reference adapter
  - `codex-sdk`
  - `gemini-cli-core`
  - `opencode-sdk`

<!-- anchor: q5ce0ucl -->
## Contract: `RuntimeAdapter`

`src/types.ts:279-283`

```ts
interface RuntimeAdapter {
  architecture: Architecture;
  execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent>;
  abort(): void;
  pushMessage?(text: string): boolean;  // optional — mid-turn injection (streaming-input mode)
}
```

Three obligations (+ one optional capability):
1. **Identify yourself** via `architecture` — one of the `BuiltinArchitecture` strings or a custom string (`(string & {})`).
2. **Yield `UnifiedEvent`s** in response to `execute(params)`. The stream must terminate — either by yielding a `result` event and returning, or by yielding an `error` event. **Exception:** in streaming-input mode (`params.streamingInput`) the stream may yield **multiple** `result` events (one per delivered turn) and stays alive until the input channel drains or `abort()` is called.
3. **Be abortable** — `abort()` must stop the underlying SDK run promptly. Emit `AdapterAbortError` or let the iterator complete naturally.
4. **(Optional) `pushMessage(text)`** — push a user message into the live session mid-turn; returns `true` if accepted onto the open channel, `false` if closed/closing or not in streaming-input mode (caller re-dispatches after-turn). Only implement when the underlying SDK supports streaming input; advertise via `architectureCapabilities(arch).midTurnPush` (`src/capabilities.ts`). Accepting a push emits a `user_message` event.

<!-- anchor: c1zu1658 -->
## `UnifiedEvent` taxonomy

Defined in `src/types.ts:36-59`. Groups (bold = required for basic conformance):

- **Text**: `text_delta { text, isSubagent, subagentTaskId? }`, `assistant_message { message: NormalizedMessage }`
- **Thinking**: `thinking { text, isSubagent, replace?, subagentTaskId? }` — `replace: true` signals the whole thinking text, not a delta (see `gemini-cli-core` skill for why)
- **Tools**: `tool_use { toolName, toolUseId, input, isSubagent, subagentTaskId? }`, `tool_result { toolUseId, summary, isSubagent, isError?, subagentTaskId? }` — `isError` mirrors `ContentBlock.toolResult.isError`; absent when the adapter has no error signal (see capability matrix)
- **Subagent lifecycle**: `subagent_started { taskId, description, toolUseId }`, `subagent_progress { taskId, description, lastToolName? }`, `subagent_completed { taskId, status, summary?, usage? }`
- **User input**: `user_input_request { request: UserInputRequest }` — unified entry point for model-tool asks and MCP elicitation
- **Mid-turn push**: `user_message { text, timestamp }` — a message accepted into the live session via `pushMessage()` (streaming-input mode); emitted before the model's response so consumers persist it in transcript order. Only `midTurnPush`-capable adapters emit it (see capability matrix).
- **Legacy user input**: `elicitation_request { ... }` — **deprecated**, adapters should emit `user_input_request` with `source: 'mcp-elicitation'` instead
- **Todo list**: `todo_list_updated { items: TodoItem[], source: 'model-tool' | 'session-state', isSubagent, subagentTaskId? }` — unified TodoWrite/plan-tracking primitive. Replaces `tool_use` for claude-code TodoWrite (source: `'model-tool'`); synthesized from opencode's `todo.updated` SSE channel (source: `'session-state'`). Not emitted by codex or gemini. Adapters that emit this **also** place a `ContentBlock.todoList` into `NormalizedMessage.content` — claude-code replaces the TodoWrite `toolUse`, opencode pushes a synthetic `NormalizedMessage { role: 'assistant', native: undefined }`. See `TodoItem` in `src/types.ts` for item shape.
- **Terminal**: `result { output, rawMessages, usage, sessionId?, todoListSnapshot? }`, `error { error }` — `todoListSnapshot` carries the last seen todo-list items; `undefined` when the adapter never observed a todo update during this run.
- **Misc**: `warning { message }`, `flush` (boundary hint, e.g. Claude Code `compact_boundary`)

**Always include `isSubagent`** on delta-like events. Subagent events carry `taskId` so consumers can group them.

**Subagents emit the full event stream**, not just the `subagent_*` lifecycle envelope. While a subagent is running, its `text_delta` / `thinking` / `tool_use` / `tool_result` are interleaved with the parent's in the same stream. `isSubagent: true` marks them as belonging to *some* subagent; `subagentTaskId?` (optional) carries the same value as the surrounding `subagent_started.taskId` so consumers can group events per subagent when multiple run concurrently. The field is optional because not every adapter can populate it (see capability matrix row "Subagent taskId on deltas"); consumers must handle `undefined` gracefully.

<!-- anchor: iku0e0vm -->
## `NormalizedMessage` + `ContentBlock`

`src/types.ts:8-27`

```ts
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'toolUse'; toolUseId; toolName; input }
  | { type: 'toolResult'; toolUseId; content; isError? }
  | { type: 'image'; source: { type: 'base64'; mediaType; data } | { type: 'url'; url } }
  | { type: 'todoList'; items: TodoItem[] };  // replaces TodoWrite toolUse (claude-code) or synthesized from session-state (opencode)

interface NormalizedMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: string;          // ISO-8601
  subagentTaskId?: string;    // set on subagent-produced messages
  usage?: { inputTokens; outputTokens };
  native?: unknown;           // opaque passthrough of the original SDK message
}
```

- `timestamp` is adapter-assigned — usually `new Date().toISOString()` at emission time.
- `native` is a stable escape hatch; downstream consumers may read it but should not depend on its shape.

<!-- anchor: 2ntdjvl2 -->
## `RuntimeExecuteParams`

`src/types.ts:219-277`

| Field | Purpose | Notes |
|-------|---------|-------|
| `prompt`, `systemPrompt`, `model` | core input | `model` may be an alias (see `src/models.ts`) — adapters must call `resolveModel()` |
| `allowedTools` | tool allowlist | adapter maps to native equivalent |
| `mcpServers: Record<string, McpServerConfig>` | pre-built MCP servers | adapters read this; `builtinMCPServers` / `allowedMCPTools` are consumer-side |
| `cwd`, `maxTurns`, `timeoutMs` | runtime | adapter enforces if SDK supports |
| `resumeSessionId` | session resumption | support varies — see capability matrix |
| `streamingInput: boolean` | open input channel for `pushMessage()` | only honored by `midTurnPush`-capable adapters (claude-code); off → one-shot string prompt (unchanged). See capability matrix |
| `architectureConfig: Record<string, unknown>` | adapter-specific keys | prefix by adapter: `claude_*`, `codex_*`, `gemini_*`, `opencode_*`, plus cross-adapter `custom_env` / `ollama_baseUrl` |
| `planMode: boolean` | read-only run | maps to: claude `permissionMode='plan'`, gemini `approvalMode='plan'`, codex `sandboxMode='read-only'`, opencode **ignored + warning** |
| `onUserInput: UserInputHandler` | unified user-input callback | supported partially — see capability matrix |
| `onElicitation` | **deprecated** | bridged to `onUserInput` internally when the new handler is absent |

When both `onUserInput` and `onElicitation` are provided, `onUserInput` wins.

<!-- anchor: 02e0soku -->
## Capability matrix

| Capability | claude-code | codex | gemini | opencode |
|------------|:-----------:|:-----:|:------:|:--------:|
| Native user input (model tool) | ✅ `AskUserQuestion` | ❌ (warn) | ⚠️ partial (MessageBus) | ✅ `question.asked` |
| MCP elicitation → `user_input_request` | ✅ | ❌ | ❌ | ❌ |
| MCP dynamic config from `mcpServers` | ✅ stdio/SSE/HTTP/SDK | ❌ must pre-configure via `codex mcp add` | ✅ stdio/SSE/HTTP/TCP | ⚠️ stdio only |
| `planMode` | ✅ `permissionMode='plan'` | ✅ `sandboxMode='read-only'` | ✅ `approvalMode='plan'` | ❌ warning, ignored |
| `resumeSessionId` | ✅ native `options.resume` | ⚠️ `resumeThread` but no tracking | ✅ reads `~/.gemini/projects/*/chats/` | ⚠️ partial |
| Mid-turn push (`pushMessage` + `streamingInput` + `user_message`) — `architectureCapabilities().midTurnPush` | ✅ SDK streaming-input channel | ❌ one prompt per `runStreamed` | ❌ one prompt per call | ❌ one prompt per call |
| Resume config immutability enforced | API-enforced (hard 400 on changed `thinking`) | thread-bound (model/effort) | history-bound | session-bound |
| Thinking deltas | ✅ incremental | ⚠️ chunks via reasoning event | ❌ full summary with `replace: true` | ✅ incremental |
| Subagent lifecycle | ✅ native `task_*` system events | ⚠️ synthesized | ⚠️ synthesized per `threadId` | ⚠️ synthesized |
| Subagent taskId on deltas (`subagentTaskId`) | ✅ mapped from `parent_tool_use_id` via local lookup | ❌ no subagent concept in SDK | ✅ direct pass-through of `event.threadId` | ⚠️ ordering-based (single active) |
| Tool-error signal (`tool_result.isError`) | ✅ pass-through `is_error` from SDK tool_result blocks | ✅ derived from `status === 'failed'` / `exit_code` / `error` per item type | ✅ pass-through `event.isError` on `tool_response` | ✅ set on `status === 'error'` branch |
| Unified todo list (`todo_list_updated` + `ContentBlock.todoList` + `result.todoListSnapshot`) | ✅ source: `model-tool` — replaces TodoWrite `tool_use`/`tool_result` pair and `ContentBlock.toolUse` in rawMessages | ❌ no native todo primitive | ❌ no native todo primitive | ✅ source: `session-state` — from SSE `todo.updated`; synthesized `NormalizedMessage { role: 'assistant', native: undefined }` added to rawMessages |

This table decides whether a new unified feature degrades gracefully. If you add a new event/field and three adapters can't emit it, design the graceful degradation (warning event, or silently skip with adapter-specific note).

<!-- anchor: 6lok5126 -->
### Session-resume immutability (`session-resume.ts`)

`model` and the reasoning/thinking config must stay constant across all turns of a resumed session. Adapters are stateless and do **not** enforce this — the library only declares it, so consumers (who hold the thread's original config) can lock UI controls or fork a new session. Source of truth: the `resumeImmutable` flag on `ArchOption` (`options.ts`) plus the always-immutable `model`. Helpers: `getSessionResumeConstraints(architecture)`, `isSessionFieldMutable(architecture, path)`, `findResumeViolations(architecture, original, next)` — all pure. When adding a new reasoning/thinking arch option, set `resumeImmutable: true` on it; generation-only knobs (temperature, top-p) stay mutable. See README "Session resume".

<!-- anchor: exiq2qlz -->
## Skills (cross-cutting concern)

`@inharness-ai/agent-adapters` currently has **no skills support at the unified layer**: no `skills` field in `RuntimeExecuteParams`, no `skill_listing` / `skill_invoked` events in `UnifiedEvent`, no adapter bridges. See per-adapter skill files for native capability; the snapshot:

| Adapter | Native skills | Dynamic loading | Filesystem | Programmatic SDK API | Our adapter passes through? |
|---|:---:|:---:|---|---|:---:|
| **claude-code** | ✅ first-class | ✅ progressive disclosure | `.claude/skills/`, `~/.claude/skills/`, plugins | ✅ `AgentInput.skills[]`, `skillOverrides`, `skillListingBudgetFraction`, `disableSkillShellExecution`, `supportedCommands()` | ❌ |
| **codex** | ✅ (runtime only) | ✅ progressive disclosure, auto file-change detection | `.agents/skills/`, `~/.agents/skills/`, `/etc/codex/skills` | ❌ not in `@openai/codex-sdk` | ❌ (but filesystem path works in cwd) |
| **gemini-cli-core** | ⚠️ via Extensions bundle only | ❌ CLI restart required | `<ext>/skills/<name>/SKILL.md` inside a registered extension | ❌ no public API | ❌ |
| **opencode** | ✅ first-class | ✅ native `skill` tool + re-inject on `session.compacted` | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, plus globals | ⚠️ plugin-level via `synthetic`/`noReply` flags | ❌ (but filesystem path works in cwd) |
| **google-genai** (planned) | ❌ | ❌ | N/A — `systemInstruction` only | ❌ | N/A |
| **google-adk** (planned) | ❌ runtime primitive | ❌ | N/A — `Instructions` + `FunctionTool` + multi-agent | ❌ | N/A |

<!-- anchor: l6fsri0h -->
### Shared-directory invariant

claude-code, codex, and opencode all agree on the **Anthropic-style `SKILL.md` shape** (YAML frontmatter with `name` + `description`, optional body, optional sibling `scripts/` / `references/` / `assets/`). And the directory names overlap:

- `.claude/skills/` — read by claude-code **and** opencode
- `.agents/skills/` — read by codex **and** opencode
- `.opencode/skills/` — opencode only

So a skill authored in our repo's `.claude/skills/` is picked up transparently by **2 of 4 existing adapters** (claude-code, opencode) with zero code changes, and by codex if symlinked/copied to `.agents/skills/`. Gemini-cli-core is the outlier.

<!-- anchor: 4kvd095g -->
### Open design questions (resolve before any implementation)

1. **Unified-layer concept or per-adapter `architectureConfig`?** Argument *for* unified: the cross-adapter directory invariant above + claude-code + opencode dominating real usage. Argument *against*: only 2 of 4 adapters can act on programmatic hints, and gemini doesn't work at all.
2. **Event model.** If unified, do we emit a `skill_invoked { name }` / `skill_loaded { name, bodyTokens }` event when the model opens a skill? claude-code emits nothing observable today. opencode emits a tool call on its native `skill` tool (already maps to `tool_use`). Decide whether to synthesise a dedicated event or stay with the existing `tool_use`/`tool_result` mapping.
3. **Filesystem-only vs programmatic injection.** Filesystem works today for claude-code + opencode without adapter changes. Programmatic injection (allowedSkills, skillOverrides) only has a clean API path on claude-code. A two-phase rollout (filesystem first, programmatic second) is likely simplest.
4. **Filter surface.** `allowedSkills` / `deniedSkills` unified field would map cleanly to claude-code `skillOverrides` (`'on' | 'off'`) and to a generated `opencode.json` `skills.deny` list; would be a warn-and-ignore no-op for codex and gemini.

<!-- anchor: hfmi9na1 -->
### Planned additions

Two more Google adapters are on the roadmap — design briefs live in sibling skills:

- **`google-genai`** → uses `@google/genai` Interactions API (Beta). Documented schemas, SSE streaming (`content.delta`), built-in remote MCP, long-running tasks with polling, function calling + built-in tools (Google Search, Maps, Code execution, URL context, Computer Use, File search), Deep Research Agent. Auth: API key + Workspace OAuth + Vertex. Does **not** support free-tier personal OAuth — that remains the sole responsibility of `gemini-cli-core`.
- **`google-adk`** → uses `@google/adk` (Agent Development Kit for TypeScript; TS pre-GA, Go/Java GA). Code-first multi-agent orchestration, native MCP, `FunctionTool` extensibility, model-agnostic (Gemini / Vertex + third-party). First adapter where `subagent_*` events would be *native* rather than synthesized.

See the respective skill files for capability map, open questions, and non-goals. Neither adapter is implemented yet — implementation planned in a separate follow-up session.

<!-- anchor: gvjtuisz -->
## Architectures & models

Defined in `src/types.ts:63-71` and `src/models.ts`:

- `claude-code`, `claude-code-ollama`, `claude-code-minimax` — all use `@anthropic-ai/claude-agent-sdk`, differ by provider preset
- `codex`
- `opencode`, `opencode-openrouter`
- `gemini`

Custom architectures (`(string & {})`) are allowed; `resolveModel()` passes them through untouched. Always call `resolveModel(architecture, params.model)` in every adapter to handle aliases (`src/models.ts:107`).

<!-- anchor: 86lf1i8d -->
## Errors

`src/types.ts:289-319` — `AdapterError`, `AdapterInitError`, `AdapterTimeoutError`, `AdapterAbortError`. Yield them via `{ type: 'error', error }`, do not throw out of the iterator.

<!-- anchor: m49g5m6c -->
## Checklist: adding a new event type or param field

1. Edit `src/types.ts` — add the union member or field. Include JSDoc with *which adapters support it* upfront.
2. Update every adapter in `src/adapters/*.ts`:
   - If the adapter's SDK can emit it natively → map it.
   - If not → either synthesize (when the info is derivable) or document as unsupported. For unsupported cases, emit a one-shot `warning` event on first use (Codex does this for `onUserInput`).
3. Add assertions in `src/testing/e2e/shared.ts` if there's a new invariant.
4. Add a test case in each `src/testing/e2e/*.e2e.test.ts`. Use `requireEnv()` guards — tests must skip when the SDK's credentials are missing.
5. Bump the capability matrix above.
6. Bump `package.json` version once released.

Don't add a feature that only one adapter can support without calling it out in the type JSDoc — consumers will build on it and be surprised by the others.

<!-- anchor: vfih9src -->
## Key files

- `src/types.ts` — contract
- `src/capabilities.ts` — `architectureCapabilities()` static per-arch map (e.g. `midTurnPush`)
- `src/models.ts` — aliases, `resolveModel()`, `ADAPTIVE_THINKING_ONLY`
- `src/index.ts` — public entry, `createAdapter()`
- `src/adapters/*.ts` — per-SDK implementations
- `src/testing/e2e/shared.ts` — contract assertion helpers (`assertEventTypes`, `assertTextDeltas`, `assertNormalizedMessage`, `assertContentBlock`)
- `package.json` — authoritative SDK versions (peer + dev)
