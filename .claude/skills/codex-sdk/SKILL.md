---
name: codex-sdk
description: >-
  Use when editing src/adapters/codex.ts or src/testing/e2e/codex.e2e.test.ts,
  bumping @openai/codex-sdk in package.json, debugging missing events (user
  input not firing, MCP tools not showing, command execution events), or
  extending UnifiedEvent and needing to know what Codex can and cannot do. Codex
  has no native user input, no dynamic MCP config (must pre-configure via `codex
  mcp add`), and hardcodes approvalPolicy='never' regardless of planMode.
---

<!-- anchor: 4z89zfh9 -->
# codex adapter — `@openai/codex-sdk`

Codex is the most constrained of the four adapters: thread-based API, no native user input, MCP must be pre-configured via CLI, and the system prompt has to be concatenated with the user prompt. When a new UnifiedEvent feature arrives, Codex is usually the first place where "unsupported + warning" is the answer.

<!-- anchor: g4yl5z0a -->
## Official documentation & sources

- **Codex overview**: https://developers.openai.com/codex/
- **TypeScript SDK docs**: https://developers.openai.com/codex/sdk/typescript/
- **Repo (SDK + CLI monorepo)**: https://github.com/openai/codex
- **npm**: https://www.npmjs.com/package/@openai/codex-sdk
- **MCP docs** (Codex as MCP server, and `codex mcp add` CLI): https://developers.openai.com/codex/mcp/
- **CLI advanced docs**: https://github.com/openai/codex/blob/main/docs/advanced.md
- **Releases / changelog**: https://github.com/openai/codex/releases

<!-- anchor: tm1w5jzy -->
## Pinned version & TODO

- **Dev**: `^0.120.0` (`package.json`)
- **Peer**: `>=0.120.0`
- **TODO / things to watch**:
  - **Native MCP config from SDK** — currently `codex mcp add` is CLI-only. Watch release notes for a programmatic API; today we cannot inject `mcpServers` from `RuntimeExecuteParams`.
  - **First-class ask-user tool** — if Codex adds one, remove the "emits warning and ignores" branch for `onUserInput`.
  - **System prompt field** — currently concatenated into the prompt. A dedicated field would let us stop stringifying.
  - **`modelReasoningEffort` enum** — watch for new values; today we pass through `'minimal' | 'low' | 'medium' | 'high'`.

<!-- anchor: 6dyylgko -->
## Native API surface

- **Entry**: `new Codex({ apiKey, baseURL? })` → `codex.startThread(options) | codex.resumeThread(threadId, options)` → `thread.runStreamed(prompt)` yields events.
- **Thread options**:
  - `model` — full model ID (resolved via aliases, see `src/models.ts:28-32`)
  - `sandboxMode: 'read-only' | 'workspace-write'`
  - `workingDirectory` (cwd)
  - `approvalPolicy: 'never' | ...` — **hardcoded `'never'`** by adapter
  - `modelReasoningEffort: 'minimal' | 'low' | 'medium' | 'high'`
- **Streamed event shapes** (from `runStreamed`):
  - `turn.started`, `turn.completed` (with **session-level cumulative** usage; see quirk #9), `turn.failed`
  - `item.completed` — envelope for inner items:
    - `agent_message { text }`
    - `command_execution { command, args, output, exitCode }`
    - `file_change { path, before, after }`
    - `mcp_tool_call { server, tool, input, output }`
    - `reasoning { text }`
    - `error { message }`

<!-- anchor: i6l10l52 -->
## Event mapping table

| Native | UnifiedEvent | Notes |
|---|---|---|
| `item.completed` → `agent_message` | `text_delta` (per chunk) + `assistant_message` (full) | chunks emitted, then a terminal message |
| `item.completed` → `command_execution` | `tool_use` + synthetic `tool_result` | toolName synthesized (e.g. `shell`); result captures stdout/stderr; `isError = status === 'failed' \|\| exit_code !== 0` |
| `item.completed` → `file_change` | `tool_use` + synthetic `tool_result` | toolName synthesized (e.g. `file_edit`); result summarizes path+diff; `isError = status === 'failed'` |
| `item.completed` → `mcp_tool_call` | `tool_use` + `tool_result` | `toolName` formatted as `mcp__${server}__${tool}`; `isError = status === 'failed' \|\| error != null` |
| `item.completed` → `reasoning` | `thinking` | incremental-style; not `replace: true` |
| `item.completed` → `error` | `error` | |
| `turn.completed` | `result` | adapter converts cumulative session usage → per-`execute()` delta (see quirk #9); `sessionId` carried via `thread.started` |
| `turn.failed` | `error` | |

No native subagent events → `subagent_*` events are **not emitted**. Consequently `subagentTaskId` on `text_delta` / `thinking` / `tool_use` / `tool_result` is **always `undefined`** and `isSubagent` is always `false`. See `unified-architecture` skill's capability matrix.

<!-- anchor: olljlmnb -->
## Quirks & gotchas

1. **No native user input.** If `onUserInput` (or legacy `onElicitation`) is passed, the adapter emits a one-shot `warning` event and then ignores the handler. The model cannot prompt the user mid-run.
2. **MCP servers must be pre-configured externally.** Incoming `mcp_tool_call` events are normalized to `tool_use`, but there is **no way to inject MCP servers from `RuntimeExecuteParams.mcpServers`** — you have to run `codex mcp add <name> <command>` beforehand. Document this in any integration that relies on MCP.
3. **`approvalPolicy` is hardcoded `'never'`** regardless of `planMode`. `planMode` is mapped to `sandboxMode: 'read-only'` instead. So plan mode ≠ approval mode here.
4. **System prompt is concatenated.** Codex has no native system-prompt field; the adapter prefixes the prompt with `systemPrompt + '\n\n' + prompt`. Long system prompts burn user tokens and may displace context. Prefer short, directive system prompts.
5. **`architectureConfig` keys** (`src/adapters/codex.ts:39+`):
   - `codex_apiKey` — API key, **optional**; fallback `process.env.OPENAI_API_KEY`, then local ChatGPT OAuth from `~/.codex/auth.json` (after `codex login`). Adapter no longer hard-fails when none is set — see quirk #8.
   - `codex_baseUrl` — base URL override
   - `codex_sandboxMode` — `'read-only' | 'workspace-write'` (default `'workspace-write'`); `planMode: true` forces `'read-only'`
   - `codex_reasoningEffort` — `'minimal' | 'low' | 'medium' | 'high'`
6. **Session resumption is partial.** `codex.resumeThread(threadId)` exists but the adapter doesn't currently persist/expose `threadId` in `result.sessionId`. Resumption from outside is unreliable; prefer keeping the `Codex` + `Thread` instance alive in-process.
7. **`codex-mini` alias** → `codex-mini-latest` (a rolling tag). Pin to a full ID (e.g. via `resolveModel` pass-through) if you need reproducibility.
8. **Auth: API key OR local ChatGPT OAuth.** The SDK is a thin wrapper over the `codex` CLI binary — when neither `codex_apiKey` nor `OPENAI_API_KEY` is set, the adapter omits the `apiKey` field from `CodexOptions` entirely and the CLI resolves auth from `~/.codex/auth.json` (written by `codex login`, ChatGPT subscription). The adapter does **not** read or parse `auth.json` itself; if the CLI can't find any credential, it surfaces an auth error through the runtime catch path. Analogous to claude-code, where `ANTHROPIC_API_KEY` is also optional.

9. **Two distinct usage metrics: BILLING vs CONTEXT WINDOW.** Token consumption has two orthogonal meanings, and conflating them is the most common Codex usage bug:

   | Metric | Field on `result` | Bounded by | Use for |
   |---|---|---|---|
   | **USAGE BILLING TOKENS** | `result.usage` (per-call) | unbounded across resumed turns (replay re-billed at cache rate) | cost, billing alarms, USD estimation |
   | **USAGE CONTEXT WINDOW** | `result.contextSize` | model's window (e.g. 400k for `gpt-5-codex`) | "tokens left", IDE-style `X / 400k` utilization bar |

   `contextSize = usage.inputTokens + usage.outputTokens` for the LAST turn (NOT a sum across turns). It tells you how full the model's window is now. `usage` summed across turns tells you how many tokens you paid for total — that sum can far exceed the window, because every resumed turn re-bills the replayed history (mostly as cheap cache reads).

   **BILLING — cumulative-as-delta conversion.** Codex is the only wrapped SDK that reports session-level cumulative usage in `turn.completed.usage` — see [openai/codex#17539](https://github.com/openai/codex/issues/17539) (`event_processor_with_jsonl_output.rs::usage_from_last_total` drops the rust core's per-request `ThreadTokenUsage.last` and only emits `.total`). The unified contract in `src/types.ts` requires per-`execute()` delta in `result.usage` (consistent with claude-code/gemini/opencode), so the adapter subtracts the prior cumulative per `threadId` via a module-scoped LRU (`codexSessionLastUsage`, cap 256). Lookup priority for the prior:
   1. `params.priorUsage` — caller-supplied (cross-process scenarios, see below)
   2. module LRU — populated by previous `execute()` calls in this process
   3. `{0,0}` — fresh thread, OR first resume after process restart with no `priorUsage`

   **Cross-process caveat**: the LRU is in-memory only — no disk persistence (the library does not write to `~/`). If your runtime spawns a new Node process per `execute()` call (per-request workers, serverless, CLI invoked per turn), the LRU starts empty every turn. Without `params.priorUsage`, the first resumed turn after each restart returns the full session cumulative as `result.usage.inputTokens` (typical symptom: `In:` grows linearly across turns: 12k → 25k → 38k → 51k…). Fix: persist the previous turn's raw cumulative on your side (read it from `turn.completed.usage` if you proxy SDK events, or track `result.usage` summed since session start) and pass it as `priorUsage` on the next call. Note: Codex CLI replays full thread history server-side on each `runStreamed`, so per-turn LLM input legitimately grows with conversation length even when the per-turn delta is correct.

   For session-level billing totals: the unified contract says `result.usage` is per-call. Sum across calls on your side via `sumUsage()` from the public API, exactly as the [Anthropic Agent SDK cost-tracking docs](https://code.claude.com/docs/en/agent-sdk/cost-tracking) recommend ("The SDK does not provide a session-level total… accumulate the totals yourself.").

   **CONTEXT WINDOW — derived, never cumulative.** `result.contextSize` is computed as `usage.inputTokens + usage.outputTokens` after the cumulative-to-delta subtraction. Because the post-subtract `inputTokens` represents "context posted to the LLM on this turn" (system + full history up to this turn), adding `outputTokens` (the assistant response just appended) yields the post-turn conversation size. Use the LAST turn's `contextSize` only — summing it across turns is meaningless. Compare against `getModelContextWindow('codex', model)` from the public API for the per-model cap.

   **Cache reads are part of `inputTokens`, not separate.** Codex SDK reports `cached_input_tokens` alongside `input_tokens` in `turn.completed.usage`. The OpenAI convention is that `cached_input_tokens` is a **subset** of `input_tokens` — cache reads count toward `input_tokens` (just billed at a discounted rate), they aren't a separate bucket. The adapter forwards this as `cacheReadInputTokens` on `result.usage` (same field name as claude-code, where Anthropic's `cache_read_input_tokens` is normalized identically). To compute "fresh" input that was actually sent to the LLM at full price: `inputTokens - (cacheReadInputTokens ?? 0)`. On long replayed Codex threads, cache hit rates of 80–90% are typical — so a 25k cumulative `inputTokens` over a few resumed turns might mean only ~3k tokens billed at full rate, with the rest as cheap cache reads. If your UI reports raw `inputTokens` without showing the cached split, users will perceive the bill as much larger than it actually is. (Cache hit ratio does NOT affect `contextSize` — caching is a billing-side optimization only.)

   **USD cost.** `@anthropic-ai/claude-agent-sdk` emits `total_cost_usd` natively on its `ResultMessage` (claude-code adapter does not currently surface it on UnifiedEvent — sum across `usage` × Anthropic pricing yourself). OpenAI / Codex SDK does not expose USD; estimate from `freshInputTokens × price_in + cacheReadInputTokens × price_cache + outputTokens × price_out` against the [OpenAI pricing page](https://openai.com/api/pricing/) for the model.

<!-- anchor: jpscelad -->
## Skills support

**Native support: first-class at Codex runtime (CLI / IDE / app), but NOT exposed by `@openai/codex-sdk`.**

<!-- anchor: 1lvd0g7m -->
### File format (Anthropic-compatible)

Skill directory with:
- `SKILL.md` (required) — YAML frontmatter `name` + `description`, plus instructions
- `scripts/` (optional) — executable code
- `references/` (optional) — docs
- `assets/` (optional) — templates
- `agents/openai.yaml` (optional) — UI metadata, dependencies, `allow_implicit_invocation`

<!-- anchor: zd49e2uy -->
### Discovery (filesystem, hierarchical)

- `.agents/skills/` — walked up from cwd through parent dirs to repo root
- `$HOME/.agents/skills/`
- `/etc/codex/skills/` and Codex-bundled skills

File changes are detected automatically.

<!-- anchor: xwjmij2c -->
### Dynamic loading

**Progressive disclosure** at Codex-runtime level: metadata (name, description, file path, optional YAML metadata) shipped at start; full `SKILL.md` loaded only when the skill is selected. Invocation: explicit (`/skills` or `$name`) or implicit (when `allow_implicit_invocation: true`).

<!-- anchor: abozlykm -->
### SDK gap

`codex.startThread(options)` documented options are `workingDirectory`, `skipGitRepoCheck` — **no `skills` field, no `allowedSkills`, no listing callback**. Because skills are read from the filesystem by the Codex runtime itself, skills sitting in `$CWD/.agents/skills/` WILL be picked up when our adapter runs in that cwd — but there is no programmatic injection, filtering, or per-call toggle.

<!-- anchor: lw6qrttm -->
### Our adapter status

`src/adapters/codex.ts` does nothing about skills. Consumer can opt in by placing files in `.agents/skills/` relative to the adapter's cwd. Gap:

- No way to inject skills from process memory
- No way to disable skills per call (e.g. for tests)
- No observability — skill invocations look identical to regular tool calls in the event stream

TODO (add to version watch): track `@openai/codex-sdk` changelog for a `skills` field on `ThreadOptions` or a `listSkills()` helper.

<!-- anchor: bwhtsz14 -->
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

- **"No `OPENAI_API_KEY` set, but I ran `codex login` — does it work?"**
  → Yes. When neither `codex_apiKey` nor `OPENAI_API_KEY` is present, the adapter omits the `apiKey` field from `CodexOptions` and the underlying `codex` CLI reads the OAuth token from `~/.codex/auth.json`. If you still see an auth error, run `codex login status` (or re-run `codex login`) and verify the spawned CLI process can read `$HOME`. The adapter does not pre-validate the file — by design, auth resolution lives in the CLI.

- **"`result.usage.inputTokens` grows linearly across resumed calls (12k → 25k → 38k → 51k…)"**
  → Codex SDK reports session-level cumulative in `turn.completed.usage` (issue #17539); the adapter subtracts the prior cumulative from a module-LRU to emit per-`execute()` delta. If each turn runs in a new Node process, the LRU starts empty and the adapter falls back to `{0,0}` → emits cumulative as delta. Fix: persist the previous turn's raw cumulative client-side and pass it as `params.priorUsage` on the next call. See quirk #9 for full semantics. The growing `In:` you see in your UI is the SDK cumulative leaking through, not 12k tokens per paragraph; the true per-turn LLM input is the difference between consecutive cumulatives (~12.7k each) and reflects Codex's server-side replay of thread history + its built-in system prompt.

- **"My UI shows `25k / 400k` after two short turns — the model can't be using 6% of the context window already"**
  → You're summing `result.usage.inputTokens + outputTokens` across turns (BILLING) and labelling it as window utilization (CONTEXT WINDOW). Those are different metrics. Use `result.contextSize` from the LAST turn — it's already the post-turn window occupancy. BILLING totals can exceed the window because resumed turns re-bill the replayed history (mostly as cheap cache reads); CONTEXT WINDOW cannot. See quirk #9's "Two distinct usage metrics" table.

<!-- anchor: ptwasc3h -->
## Key files

- `src/adapters/codex.ts` — implementation
- `src/testing/e2e/codex.e2e.test.ts` — expected event shape per scenario
- `src/models.ts:28-32` — Codex model aliases (`o4-mini`, `o3`, `codex-mini`)
- `package.json` — pinned `@openai/codex-sdk` version
