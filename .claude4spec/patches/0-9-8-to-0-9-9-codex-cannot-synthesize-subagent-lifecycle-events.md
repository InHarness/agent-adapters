---
type: patch
brief: 0-9-8-to-0-9-9.md
patch_kind: incorrect
created_at: '2026-09-07T10:58:18.574Z'
created_by: unknown
applied: false
---
# Patch — codex cannot synthesize subagent lifecycle events

## What I found

Brief item 5 asks the implementer to make `codex` emit synthesized `subagent_started` /
`subagent_completed`, on the strength of the M06 L2 matrix cell moving from
`❌ no subagent concept` to `⚠️ synthesized`. I did not implement it, and a `c4s ask`
consult (thread `5xFcyrLCoNJc`) confirmed that reading: the cell is
"poluzowanie zapisu w macierzy, nie nowe zobowiązanie".

Four independent reasons the cell is wrong rather than newly demanding:

1. **The matrix contradicts itself.** In the same M06 block, `Lifecycle events | ⚠️ synthesized`
   sits directly above ``subagentTaskId` on deltas | ❌ no subagent concept`. Three fields
   describe one adapter in three registers.
2. **A02 is silent.** Per this spec's own style, per-adapter event mapping lives in the adapter
   page's L1 table. A02 carries no `subagent_*` row at all — only "`subagentTaskId` is never
   populated (no subagent concept)". There are no declared primitives for codex to synthesize
   *from*.
3. **0.9.8 rejected this exact wording by name.** The 0.9.8 CHANGELOG entry reads: "codex emits
   no subagent lifecycle events at all, on any path including abort — documented previously as
   'at best synthesized', which implied events might arrive. The SDK has no subagent concept;
   the absence is the contract." 0.9.9 restores the phrasing 0.9.8 deliberately removed, which
   reads as an accidental revert.
4. **The SDK offers nothing to bracket.** `src/adapters/codex.ts:419-485` handles
   `agent_message | command_execution | file_change | mcp_tool_call | reasoning | error` plus
   `thread.started` / `turn.completed` / `turn.failed`. No task-, thread-, delegate- or
   child-shaped item exists. By contrast opencode keys off a tool literally named `task`
   (`src/adapters/opencode.ts:684`) and gemini off a native `event.threadId`
   (`src/adapters/gemini.ts:726`). Synthesizing on codex would require inventing a heuristic,
   which `src/testing/e2e/codex.e2e.test.ts:294-296` explicitly forbids
   ("the absence IS the contract … do not 'fix' it by adding a flush here").

The code is unchanged: codex still emits zero `subagent_*` events and the two e2e cases
(`codex.e2e.test.ts:293` abort path, `:319` ordinary path) that pin that still stand.

## Suggestion

- Revert the M06 L2 `Lifecycle events` cell for `codex` to `❌ no subagent concept`, and restore
  the degradation prose to the 0.9.8 wording ("no lifecycle events are produced") rather than
  "lifecycle is at best synthesized". Alternatively, if synthesis really is intended, A02 has to
  gain the mapping rows naming the primitives — but no such primitive exists in the pinned SDK,
  so this direction looks unreachable.
- Add an explicit **legend for ✅ / ⚠️ / ❌** next to the capability matrices. The spec has none
  today, and its absence is precisely what let the A01 `abort` row move from `⚠️ partial` to
  `✅ covered` without an agreed meaning for the symbol — the single change that made this
  release's intent unreadable.

