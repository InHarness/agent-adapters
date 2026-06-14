# Changelog

All notable changes to `@inharness-ai/agent-adapters` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.8.0] — 2026-06-14

### Fixed
- **Optional peer SDKs are no longer required at module load.** Importing anything from the main entry (e.g. `registerAdapter`, `createAdapter`) no longer throws `Cannot find package '@anthropic-ai/claude-agent-sdk'` when an optional peer SDK is absent. The `claude-code`, `codex`, and `opencode` adapters now keep only `import type` at the top level and load their SDK values lazily via `await import()` inside `execute()` (matching the existing `gemini` adapter), and `createMcpServer` lazily `createRequire`s `@modelcontextprotocol/sdk`. A consumer that never touches a given adapter never loads its SDK. Covered by a regression guard (`no-eager-sdk.test.ts`) that asserts `dist/index.js` statically imports none of the five optional SDKs.

### Removed
- **BREAKING (minor):** `createSdkMcpServer` and `tool` are no longer re-exported from `@inharness-ai/agent-adapters/claude-code`. They were thin pass-throughs to `@anthropic-ai/claude-agent-sdk` and a source of the eager-load bug above. Import them directly from the SDK instead: `import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'`. The library's own `createMcpServer`/`mcpTool` builders are unchanged.

[0.8.0]: https://github.com/InHarness/agent-adapters/compare/v0.7.0...v0.8.0

## [0.7.0] — 2026-06-14

### Added
- **Mid-turn message injection (streaming-input mode)** — opt into `RuntimeExecuteParams.streamingInput: true` to keep the session's input channel open and push follow-up user messages into a live turn via the new optional `RuntimeAdapter.pushMessage(text): boolean`. Accepted pushes surface as a new `user_message` UnifiedEvent (`{ text, timestamp }`), and `execute()` may now yield **multiple** `result` events (one per delivered turn). `pushMessage` returns `false` when the channel is closed/closing or the adapter isn't in streaming-input mode, so callers re-dispatch after-turn with `resumeSessionId` — no lost-message window.
- **Capability discovery** — new `architectureCapabilities(architecture)` (and `ArchitectureCapabilities` type) reporting `{ midTurnPush }`. Only `claude-code` (and its provider variants) supports mid-turn push today, riding `@anthropic-ai/claude-agent-sdk`'s streaming-input mode; `codex`, `gemini`, `opencode`, and unknown architectures report `false`.
- New example `examples/claude-code/streaming-input.ts` and a streaming-input E2E that resolves whether the SDK delivers a pushed message between tool calls or at the turn boundary (risk R1).

### Fixed
- **Subagents available to the claude-code adapter in plan mode** — `Task` was in `CLAUDE_CODE_MUTATING_BUILTINS`, so it landed in `disallowedTools` and was dropped from the plan-mode tools whitelist, blocking legitimate read-only subagent use (research, exploration) with "no access to Task". `Task` and `Agent` now live in `CLAUDE_CODE_READONLY_BUILTINS` (both names are needed: `Task`→`Agent` was renamed in Claude Code v2.1.63, but the `system:init` tools list still uses `Task`), leaving only the genuinely mutating built-ins (`Bash`, `Edit`, `Write`, `NotebookEdit`) gated. As in native Claude Code plan mode, read-only is **not** enforced inside a spawned subagent — a subagent does not inherit the parent's `disallowedTools`.

All additions are optional and backward compatible — with `streamingInput` off, `execute()` behaves exactly as before (one prompt, one `result`).

[0.7.0]: https://github.com/InHarness/agent-adapters/compare/v0.6.4...v0.7.0

## [0.6.4] — 2026-06-09

### Added
- **Fable 5 model support** — registered `fable-5` (id `claude-fable-5`) in `models.ts` with its context window and adaptive-thinking-only constraint, added a Fable 5 E2E test command in `package.json`, and documented the model alias and its adaptive-only behavior across README, TESTS, and the `claude-code-sdk` skill.

[0.6.4]: https://github.com/InHarness/agent-adapters/compare/v0.6.3...v0.6.4

## [0.6.3] — 2026-06-03

### Fixed
- **`Skill` built-in now available to the claude-code adapter in plan mode** — in plan mode the adapter restricts the model's built-in catalog to a read-only whitelist, which omitted `Skill`. As a result, inline skills (materialized as a local plugin) could never be opened during a plan-mode run — the SDK reported `No such tool available: Skill`. `Skill` is read-only (it only loads a skill's body into context); mutating actions remain gated by `disallowedTools`. Outside plan mode the full catalog was already available, so this only affected `planMode: true` calls that inject skills.

[0.6.3]: https://github.com/InHarness/agent-adapters/compare/v0.6.2...v0.6.3

## [0.6.2] — 2026-05-29

### Added
- **Session-resume constraint helpers** — new `getSessionResumeConstraints()` and `findResumeViolations()` exported from the public API, along with `ResumeFieldConstraint` and `ResumeConfigSnapshot` types. They report which option fields (e.g. `thinking`, reasoning effort) must stay constant across the turns of a resumed session and detect, before a turn runs, when a resumed call would change a locked field. Adapters stay stateless; callers use these to lock fields in their UI and pre-empt provider rejections.
- **`resumeImmutable` / `resumeImmutableReason` option metadata** — per-option flags describing fields that are fixed for the lifetime of a resumed session/thread, each carrying a human-readable reason for surfacing in UI and logs.

### Changed
- **Session-resume documentation** — `resumeSessionId` JSDoc, README, and the `unified-architecture` / `claude-code-sdk` skills expanded to explain resume constraints and per-adapter behavior (claude-code rejects mismatched thinking config on resume; Codex reuses the thread's original reasoning effort).

[0.6.2]: https://github.com/InHarness/agent-adapters/compare/v0.6.1...v0.6.2

## [0.6.1] — 2026-05-28

### Changed
- **Opus 4.8 context window corrected to 1,000,000 tokens** — `MODEL_CONTEXT_WINDOWS` entries for `opus-4.8` and `claude-opus-4.8` raised from 200,000 to 1,000,000, so `getModelContextWindow()` / `contextSize()` report the model's full 1M window.

[0.6.1]: https://github.com/InHarness/agent-adapters/compare/v0.6.0...v0.6.1

## [0.6.0] — 2026-05-28

### Added
- **Opus 4.8 model support** — new `opus-4.8` alias in `MODEL_ALIASES` with its context-window entry, plus `CLAUDE_CODE_OPTIONS` wiring for adaptive thinking and reasoning-effort levels on Opus 4.8. README and TESTS.md updated to use Opus 4.8 in the Claude Code adapter and its tests.

### Changed
- **Adaptive thinking handling** in the Claude Code adapter refined to stay compatible with Opus 4.6+ models; SKILL.md documents the updated adaptive-thinking requirements and Opus 4.6/4.7 troubleshooting, and the `thinking.ts` example demonstrates adaptive thinking with effort control.
- **`@anthropic-ai/claude-agent-sdk` bumped to 0.3.153** in `package.json` / `package-lock.json`.

[0.6.0]: https://github.com/InHarness/agent-adapters/compare/v0.5.0...v0.6.0

## [0.5.0] — 2026-05-27

### Added
- **Disk skill discovery** — new `listDiskSkills()` and `getSkillSearchDirs()` exported from the public API. They enumerate the SKILL.md skills each architecture auto-loads from disk (e.g. `~/.claude/skills`, project `.claude/skills`), parsing frontmatter metadata and reporting each skill's search location, scope, and on-disk layout. New `DiskSkill`, `ListDiskSkillsOptions`, `SkillSearchLocation`, `SkillScope`, and `SkillLayout` types accompany the helpers. README documents the feature with examples.

## [0.4.0] — 2026-05-13

### Added
- **Context-window tracking** — every `result` event now carries `contextSize` (total tokens occupying the model's context window after the turn). New `contextSize()` helper exported from the public API for callers who only kept `UsageStats`. Pair with `MODEL_CONTEXT_WINDOWS` / `getModelContextWindow()` to render an IDE-style "X / 400k" utilization bar.
- **`subtractUsage` helper** exported from the public API. Subtracts two `UsageStats` field-by-field (flooring at zero, cache fields preserved symmetrically with `addUsage`). Used internally by the Codex adapter to derive per-call delta from session-cumulative SDK usage, and available for any consumer with the same need.
- **`priorUsage` on `RuntimeExecuteParams`** — cross-process escape hatch for Codex. Passing the previous turn's raw cumulative usage on a resumed call keeps `result.usage` accurate when the adapter's in-memory LRU starts empty after a process restart. Ignored by claude-code, gemini, opencode.
- **`maxTurns` JSDoc** documenting the per-adapter semantics: claude-code counts cumulatively across the resumed session (low values error on resume), gemini maps to `maxSessionTurns`, codex and opencode ignore it.

### Changed
- **`UsageStats` field semantics clarified** — `cacheReadInputTokens` and `cacheCreationInputTokens` are now documented as *subsets* of `inputTokens` (overlap, not additive), uniform across all adapters. Claude-code's normalization rolls Anthropic's three additive buckets into a single `inputTokens` so the contract holds.
- **`result.usage` JSDoc** distinguishes USAGE BILLING TOKENS (per-call billing cost, sums across calls can exceed the context window) from USAGE CONTEXT WINDOW (`result.contextSize`, bounded by the model's window).

### Fixed
- **Codex cumulative-as-delta usage** — the underlying `@openai/codex-sdk` reports session-cumulative usage in `turn.completed.usage` (openai/codex#17539); the adapter now subtracts the prior cumulative (tracked in a module-scoped LRU) so `result.usage` is a true per-`execute()` delta, matching the other three adapters.

## [0.3.1] — 2026-05-09

### Added
- **Cumulative-usage helpers** (`addUsage`, `sumUsage`, `sumUsageFromEvents`) exported from the public API, so consumers can aggregate `UsageStats` across multiple `execute()` calls. Documented that `result.usage` is the per-call delta on every adapter; an `assertResumeUsageIndependence` e2e helper verifies this on all four adapters.
- **Codex local ChatGPT OAuth** — adapter now falls back to `~/.codex/auth.json` (after `codex login`) when `OPENAI_API_KEY` is not set, mirroring the claude-code subscription pattern.
- **Codex thread resumption** — adapter captures `thread_id` from `thread.started` events and propagates it as `sessionId` so resumed sessions reattach to the same thread.
- **New Codex model aliases** — `gpt-5.4`, `gpt-5.4-codex`, `gpt-5.4-mini`, and `gpt-5.5` variants.

### Changed
- **Codex error handling** — extracts and de-duplicates human-readable messages from JSON-stringified API responses; suppresses duplicates when a turn-failure event is also emitted.
- **Codex e2e gating** — suite no longer skips on missing `OPENAI_API_KEY` (skips only on explicit `SKIP_CODEX_E2E`), so OAuth-only setups run the full test matrix.

## [0.3.0] — 2026-04-28

### Added
- **User message handling in the OpenCode adapter** — assistant text deltas now filter out the `PROMPT_ECHO` prefix so user input doesn't leak back as model output. The adapter tracks message roles to scope this filter to user messages only, with a new SSE fixture scenario and unit + E2E coverage.

### Changed
- README no longer shows `new ClaudeCodeAdapter()` and SDK-native MCP helpers as a parallel path to the unified API — keeping docs aligned with the package's one-interface-across-adapters pitch.

## [0.2.2] — 2026-04-28

### Added
- **Session resumption across all adapters** (`claude-code`, `codex`, `opencode`, `gemini`) via a unified `sessionId` / resume contract, plus expanded test coverage.
- **Unified inline skills** parameter (`InlineSkill`) wired through every adapter, including multi-file inline skills via `InlineSkill.files`. Documented in the README inline-skills section.
- **`adapter_ready` event** — startup snapshot of SDK-native config (secrets redacted) emitted once before the first message.
- **`createConsoleObserver` factory** with SDK-config filtering options for opt-in verbosity.
- **Try it** section in README pointing to `@inharness-ai/agent-chat` for an interactive multi-adapter demo (`npx @inharness-ai/agent-chat basic`).

### Changed
- Unified pre-SDK error handling across adapters — config / availability / resolution failures now surface as a typed `AdapterError` before any SDK call.
- Refactored model resolution so unknown aliases throw consistently with the list of valid aliases for that architecture.

### Removed
- `allowedTools` field on `InlineSkill` (pre-public, dropped in same release window as inline-skill landing).

## [0.2.1] — 2026-04-22

### Added
- **Unified `todo_list_updated` event** across `claude-code` and `opencode` adapters, replacing paired `tool_use` / `tool_result` emissions for TodoWrite operations. Introduces a new `TodoItem` type and `result.todoListSnapshot` reflecting the last-known state of the agent's todo list.
- **Per-message usage data** on Claude Code assistant normalization. `normalizeAssistantMessage` now exposes a `usage` field so consumers can inspect per-response cache behavior (cache read/creation tokens) without aggregating the session total.
- **Plan mode permission model** for the Claude Code adapter. Consumer-curated MCP tools remain executable while built-in mutating tools are hidden via `tools` + `disallowedTools`.
- E2E coverage for plan mode and for the unified todo-list event across adapters.

### Changed
- `RuntimeExecuteParams.planMode` typing clarified; adapter-specific mapping documented in `src/types.ts`.

### Removed
- Legacy `pages/unified-architecture/SKILL.md` duplicate (documentation consolidated under `.claude/skills/`).

## [0.2.0] — 2026-04

Initial public release on npm under the `@inharness-ai` scope. Baseline feature set: Claude Code, Codex, OpenCode, and Gemini adapters; MCP server integration; E2E testing framework.

[0.5.0]: https://github.com/InHarness/agent-adapters/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/InHarness/agent-adapters/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/InHarness/agent-adapters/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/InHarness/agent-adapters/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/InHarness/agent-adapters/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/InHarness/agent-adapters/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/InHarness/agent-adapters/releases/tag/v0.2.0
