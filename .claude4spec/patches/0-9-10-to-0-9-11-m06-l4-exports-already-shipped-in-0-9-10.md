---
type: patch
brief: 0-9-10-to-0-9-11.md
patch_kind: drift
created_at: '2026-09-22T14:15:31.778Z'
created_by: unknown
applied: false
---
# Patch — M06 L4 exports already shipped in 0.9.10

## What I found
The brief's "M06 gains two L4 exports" (`SubagentStatus`, `mapSubagentStatus`) was already true on 0.9.10: `SubagentStatus` is in `src/types.ts`, and `mapSubagentStatus` is in `src/subagents.ts`. Both have been exported from `src/index.ts` since commit 9a7e0f5 (gemini subagent status mapping). No code change was needed.

## Suggestion
Record the export surface in the 0.9.10 release rather than as a 0.9.10 → 0.9.11 delta, so later briefs don't present it as new.

