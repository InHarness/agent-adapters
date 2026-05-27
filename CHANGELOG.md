# Changelog

All notable changes to `@inharness-ai/agent-adapters` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

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
