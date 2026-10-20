---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: clarification
created_at: '2026-09-22T22:29:37.849Z'
created_by: unknown
applied: false
---
# Patch — tool-call cap arming on codex and the subagent exemption on gemini

## What I found
Two per-adapter details of the tool-call cap that the brief leaves open:
1. **codex** emits `tool_use` and `tool_result` together at `item.completed`, so a cap armed at the unified `tool_use` could never fire. The cap is armed at the SDK's `item.started` instead, for `command_execution`, `file_change` and `mcp_tool_call`. That is the same reason the idle clock already tracks codex items from `item.started`.
2. **The "opens a subagent" exemption** is implemented in two ways: by tool name (`Agent`, `Task`), and generically when a `subagent_started` names the call's `toolUseId`. On **gemini** the synthesized `subagent_started.toolUseId` is the subagent's first *inner* tool request (not a spawning call), so that one inner call is exempted from the tool-call cap. It stays bounded by `subagentTimeoutMs`.

## Suggestion
Record in the per-adapter capability matrix:
- codex arms the tool-call cap at item start.
- On gemini/opencode, the synthesized subagent lifecycle determines which call counts as "the one that opened it".

