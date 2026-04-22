# Changelog

All notable changes to `@inharness-ai/agent-adapters` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

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

[0.2.1]: https://github.com/InHarness/agent-adapters/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/InHarness/agent-adapters/releases/tag/v0.2.0
