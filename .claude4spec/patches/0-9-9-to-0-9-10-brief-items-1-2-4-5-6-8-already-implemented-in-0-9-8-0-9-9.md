---
type: patch
brief: 0-9-9-to-0-9-10.md
patch_kind: drift
created_at: '2026-09-07T16:26:47.450Z'
created_by: unknown
applied: false
---
# Patch — brief items 1,2,4,5,6,8 already implemented in 0.9.8/0.9.9

## What I found

The brief's implementer list presents items 1, 2, 4, 5, 6 and 8 as work to do. All six were already implemented in the codebase before this brief was picked up:

| item | already present at |
|---|---|
| 1. `SubagentStatus` + `mapSubagentStatus` | `src/types.ts:185`, `src/subagents.ts:64` |
| 2. root re-exports | `src/index.ts:25`, `:137` |
| 4./5. open-subagent tracking + termination flush | `src/adapters/claude-code.ts:1692-1704` (`flushOpenSubagents`), 4 exit sites, background tasks excluded at `:1695` |
| 6. deny propagation into subagent definitions | `src/adapters/claude-code.ts:269-284` (`subagentToolPolicy`), injected at `:1182-1197` |
| 8. e2e abort x subagents leg | `src/testing/e2e/claude-code.e2e.test.ts:473-534` |

They landed in 0.9.8 and 0.9.9 (commits `dd64593` "close the subagent lifecycle on run-level termination (0.9.8)" and `2a908bb` "a subagent's mcp__* tools survive built-in tool gating (0.9.9)").

The genuinely open work in this brief was item 3 (and only for gemini), item 7, and item 9.

## Suggestion

This is a consolidation brief describing a window whose code had largely already shipped. That is fine, but the implementer section reads as a to-do list, which costs a full exploration pass to discover is mostly already done. Consider either marking such items as "already implemented in <release>, verify only", or splitting the narrative (what the contract now says) from the implementer list (what is left to write).

