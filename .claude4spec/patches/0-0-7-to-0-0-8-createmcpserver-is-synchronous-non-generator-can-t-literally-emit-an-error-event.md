---
type: patch
brief: 0-0-7-to-0-0-8.md
patch_kind: clarification
created_at: '2026-07-15T10:49:58.803Z'
created_by: unknown
status: awaiting
---
# Patch — createMcpServer is synchronous/non-generator, can't literally emit an error event

## What I found
The brief frames the version gate uniformly across all five consumers as: on mismatch, 'emit (never throw) an error event with phase: init'. This fits the four adapters (`execute()` is an async generator that yields `UnifiedEvent`s), but `createMcpServer()` in src/mcp.ts is a **synchronous, non-generator** function with no event stream at all — it has no channel to 'emit an event' into. It also had **no existing try/catch** around its lazy `requireSdk(...)` call: a missing `@modelcontextprotocol/sdk` previously threw a raw, unwrapped `MODULE_NOT_FOUND` rather than `AdapterInitError`.

## Suggestion
Implemented `createMcpServer`'s gate (and the pre-existing missing-SDK case) as a synchronous **throw** of `AdapterInitError`, the closest equivalent given the function's synchronous, non-generator API shape — still 'surfaced as AdapterInitError' per the brief's own words, just not literally an emitted stream event. This also fixes the pre-existing raw-error leak on a missing MCP SDK as a side effect. Suggest the spec (L7 / M04) explicitly call out that MCP integration's gate throws synchronously rather than emitting an event, since `createMcpServer`'s API shape differs fundamentally from the four adapters' `execute()` generators.

