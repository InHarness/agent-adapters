---
type: patch
brief: 0-0-7-to-0-0-8.md
patch_kind: clarification
created_at: '2026-07-15T10:49:05.348Z'
created_by: unknown
status: awaiting
---
# Patch — mcpTool() never loads the SDK, only createMcpServer does

## What I found
The brief's MCP integration section says the gate applies "where the MCP SDK is lazily loaded (in-process `sdk` servers / `createMcpServer` / `mcpTool` builders)", implying both `createMcpServer` and `mcpTool` need the version gate.

In src/mcp.ts, only `createMcpServer()` lazily loads `@modelcontextprotocol/sdk` (via `requireSdk('@modelcontextprotocol/sdk/server/mcp.js')`). `mcpTool()` is a pure data constructor — it builds and returns a `McpToolDefinition` object with no SDK interaction at all, so it never needs (and can't meaningfully perform) a version check.

## Suggestion
Implemented the gate only in `createMcpServer()`. Suggest correcting the spec's phrasing (M04 / L7) to say the gate lives in `createMcpServer` only, not "createMcpServer / mcpTool builders" as if both needed it.

