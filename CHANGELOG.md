# Changelog

All notable changes to `@inharness-ai/agent-adapters` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

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

[0.3.0]: https://github.com/InHarness/agent-adapters/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/InHarness/agent-adapters/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/InHarness/agent-adapters/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/InHarness/agent-adapters/releases/tag/v0.2.0
