---
type: patch
brief: 0-9-10-to-0-9-11.md
patch_kind: missing
created_at: '2026-09-22T14:15:32.431Z'
created_by: unknown
applied: false
---
# Patch — Adapter-specific sources of outstanding work (codex item.started, dangling tool_use)

## What I found
Two implementation decisions the brief is silent on:
1. **codex** emits the unified `tool_use` and `tool_result` together at `item.completed`, so a clock fed only by the unified stream would count a long `command_execution` as idle, breaking the AC "a single tool_use still awaiting its tool_result does not expire". The adapter therefore treats each non-message item (command, file change, MCP call, web search) as outstanding from `item.started` to `item.completed`.
2. A `tool_use` whose `tool_result` is never emitted would pause the idle clock forever. The tracker drops tool keys still open at `result`: the turn has ended, so none of its tool calls are in flight. Subagent and background-task keys survive a `result`.

## Suggestion
Add a line to A02-codex that its in-flight tool calls are tracked from `item.started`. Add to M01 that a `result` settles any tool call of that turn for idle-clock purposes.

