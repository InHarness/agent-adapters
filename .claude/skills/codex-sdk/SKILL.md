---
name: codex-sdk
description: Use when editing src/adapters/codex.ts or src/testing/e2e/codex.e2e.test.ts, bumping @openai/codex-sdk in package.json, debugging missing events (user input not firing, MCP tools not showing, command execution events), or extending UnifiedEvent and needing to know what Codex can and cannot do. Codex has no native user input, no dynamic MCP config (must pre-configure via `codex mcp add`), and hardcodes approvalPolicy='never' regardless of planMode.
---

# codex adapter — `@openai/codex-sdk`

Codex is the most constrained of the four adapters: thread-based API, no native user input, MCP must be pre-configured via CLI, and the system prompt has to be concatenated with the user prompt. When a new UnifiedEvent feature arrives, Codex is usually the first place where "unsupported + warning" is the answer.

## Official documentation & sources

- **Codex overview**: https://developers.openai.com/codex/
- **TypeScript SDK docs**: https://developers.openai.com/codex/sdk/typescript/
- **Repo (SDK + CLI monorepo)**: https://github.com/openai/codex
- **npm**: https://www.npmjs.com/package/@openai/codex-sdk
- **MCP docs** (Codex as MCP server, and `codex mcp add` CLI): https://developers.openai.com/codex/mcp/
- **CLI advanced docs**: https://github.com/openai/codex/blob/main/docs/advanced.md
- **Releases / changelog**: https://github.com/openai/codex/releases

## Pinned version & TODO

- **Dev**: `^0.120.0` (`package.json`)
- **Peer**: `>=0.120.0`
- **TODO / things to watch**:
  - **Native MCP config from SDK** — currently `codex mcp add` is CLI-only. Watch release notes for a programmatic API; today we cannot inject `mcpServers` from `RuntimeExecuteParams`.
  - **First-class ask-user tool** — if Codex adds one, remove the "emits warning and ignores" branch for `onUserInput`.
  - **System prompt field** — currently concatenated into the prompt. A dedicated field would let us stop stringifying.
  - **`modelReasoningEffort` enum** — watch for new values; today we pass through `'minimal' | 'low' | 'medium' | 'high'`.

## Native API surface

- **Entry**: `new Codex({ apiKey, baseURL? })` → `codex.startThread(options) | codex.resumeThread(threadId, options)` → `thread.runStreamed(prompt)` yields events.
- **Thread options**:
  - `model` — full model ID (resolved via aliases, see `src/models.ts:28-32`)
  - `sandboxMode: 'read-only' | 'workspace-write'`
  - `workingDirectory` (cwd)
  - `approvalPolicy: 'never' | ...` — **hardcoded `'never'`** by adapter
  - `modelReasoningEffort: 'minimal' | 'low' | 'medium' | 'high'`
- **Streamed event shapes** (from `runStreamed`):
  - `turn.started`, `turn.completed` (with usage), `turn.failed`
  - `item.completed` — envelope for inner items:
    - `agent_message { text }`
    - `command_execution { command, args, output, exitCode }`
    - `file_change { path, before, after }`
    - `mcp_tool_call { server, tool, input, output }`
    - `reasoning { text }`
    - `error { message }`

## Event mapping table

| Native | UnifiedEvent | Notes |
|---|---|---|
| `item.completed` → `agent_message` | `text_delta` (per chunk) + `assistant_message` (full) | chunks emitted, then a terminal message |
| `item.completed` → `command_execution` | `tool_use` + synthetic `tool_result` | toolName synthesized (e.g. `shell`); result captures stdout/stderr; `isError = status === 'failed' \|\| exit_code !== 0` |
| `item.completed` → `file_change` | `tool_use` + synthetic `tool_result` | toolName synthesized (e.g. `file_edit`); result summarizes path+diff; `isError = status === 'failed'` |
| `item.completed` → `mcp_tool_call` | `tool_use` + `tool_result` | `toolName` formatted as `mcp__${server}__${tool}`; `isError = status === 'failed' \|\| error != null` |
| `item.completed` → `reasoning` | `thinking` | incremental-style; not `replace: true` |
| `item.completed` → `error` | `error` | |
| `turn.completed` | `result` | aggregates usage; `sessionId` not tracked here |
| `turn.failed` | `error` | |

No native subagent events → `subagent_*` events are **not emitted**.

## Quirks & gotchas

1. **No native user input.** If `onUserInput` (or legacy `onElicitation`) is passed, the adapter emits a one-shot `warning` event and then ignores the handler. The model cannot prompt the user mid-run.
2. **MCP servers must be pre-configured externally.** Incoming `mcp_tool_call` events are normalized to `tool_use`, but there is **no way to inject MCP servers from `RuntimeExecuteParams.mcpServers`** — you have to run `codex mcp add <name> <command>` beforehand. Document this in any integration that relies on MCP.
3. **`approvalPolicy` is hardcoded `'never'`** regardless of `planMode`. `planMode` is mapped to `sandboxMode: 'read-only'` instead. So plan mode ≠ approval mode here.
4. **System prompt is concatenated.** Codex has no native system-prompt field; the adapter prefixes the prompt with `systemPrompt + '\n\n' + prompt`. Long system prompts burn user tokens and may displace context. Prefer short, directive system prompts.
5. **`architectureConfig` keys** (`src/adapters/codex.ts:39+`):
   - `codex_apiKey` — API key (fallback `process.env.OPENAI_API_KEY`)
   - `codex_baseUrl` — base URL override
   - `codex_sandboxMode` — `'read-only' | 'workspace-write'` (default `'workspace-write'`); `planMode: true` forces `'read-only'`
   - `codex_reasoningEffort` — `'minimal' | 'low' | 'medium' | 'high'`
6. **Session resumption is partial.** `codex.resumeThread(threadId)` exists but the adapter doesn't currently persist/expose `threadId` in `result.sessionId`. Resumption from outside is unreliable; prefer keeping the `Codex` + `Thread` instance alive in-process.
7. **`codex-mini` alias** → `codex-mini-latest` (a rolling tag). Pin to a full ID (e.g. via `resolveModel` pass-through) if you need reproducibility.

## Skills support

**Native support: first-class at Codex runtime (CLI / IDE / app), but NOT exposed by `@openai/codex-sdk`.**

### File format (Anthropic-compatible)

Skill directory with:
- `SKILL.md` (required) — YAML frontmatter `name` + `description`, plus instructions
- `scripts/` (optional) — executable code
- `references/` (optional) — docs
- `assets/` (optional) — templates
- `agents/openai.yaml` (optional) — UI metadata, dependencies, `allow_implicit_invocation`

### Discovery (filesystem, hierarchical)

- `.agents/skills/` — walked up from cwd through parent dirs to repo root
- `$HOME/.agents/skills/`
- `/etc/codex/skills/` and Codex-bundled skills

File changes are detected automatically.

### Dynamic loading

**Progressive disclosure** at Codex-runtime level: metadata (name, description, file path, optional YAML metadata) shipped at start; full `SKILL.md` loaded only when the skill is selected. Invocation: explicit (`/skills` or `$name`) or implicit (when `allow_implicit_invocation: true`).

### SDK gap

`codex.startThread(options)` documented options are `workingDirectory`, `skipGitRepoCheck` — **no `skills` field, no `allowedSkills`, no listing callback**. Because skills are read from the filesystem by the Codex runtime itself, skills sitting in `$CWD/.agents/skills/` WILL be picked up when our adapter runs in that cwd — but there is no programmatic injection, filtering, or per-call toggle.

### Our adapter status

`src/adapters/codex.ts` does nothing about skills. Consumer can opt in by placing files in `.agents/skills/` relative to the adapter's cwd. Gap:

- No way to inject skills from process memory
- No way to disable skills per call (e.g. for tests)
- No observability — skill invocations look identical to regular tool calls in the event stream

TODO (add to version watch): track `@openai/codex-sdk` changelog for a `skills` field on `ThreadOptions` or a `listSkills()` helper.

## Troubleshooting recipes

- **"MCP tool calls aren't appearing"**
  → You did not pre-configure MCP via `codex mcp add`. Passing `mcpServers` in `RuntimeExecuteParams` does **not** inject them. Check `codex mcp list` on the machine running the adapter.

- **"`AskUserQuestion`-style prompts never fire my handler"**
  → Codex has no native ask-user tool. Adapter emits a `warning` event on the first `onUserInput`/`onElicitation` callback passed in; thereafter it ignores. Consumer must handle the unsupported case (degrade to non-interactive mode).

- **"`planMode: true` didn't block an approval prompt"**
  → Codex's `approvalPolicy` is always `'never'` in the adapter. `planMode` flips `sandboxMode` to `'read-only'` only. If the SDK internally still prompts, that's an SDK quirk — file upstream.

- **"Shell tool calls come through as `shell` instead of the real command"**
  → Expected. `command_execution` items are synthesized as a generic shell tool — the specific command is in the input payload, not the `toolName`. Inspect `input.command` / `input.args`.

- **"Reasoning text is huge and uncached"**
  → Codex emits reasoning as chunks; each chunk becomes a `thinking` event with a new text. If you're accumulating, de-dup by comparing to the previous event's text — we don't emit `replace: true` here.

- **"My system prompt seems ignored"**
  → It's concatenated into the user prompt. If you see the model treating it as if the user said it, shorten and tighten the system prompt. Alternatively, move critical constraints to in-prompt directives.

- **"`turn.failed` with no error detail"**
  → Upstream — open an issue at https://github.com/openai/codex with the thread id. Our adapter just forwards to `error`.

## Key files

- `src/adapters/codex.ts` — implementation
- `src/testing/e2e/codex.e2e.test.ts` — expected event shape per scenario
- `src/models.ts:28-32` — Codex model aliases (`o4-mini`, `o3`, `codex-mini`)
- `package.json` — pinned `@openai/codex-sdk` version
