---
type: patch
brief: 0-9-8-to-next.md
patch_kind: missing
created_at: '2026-09-03T09:41:01.758Z'
created_by: unknown
applied: false
---
# Patch — Runtime CLI disables TodoWrite, so the Task* family is the only path - the broken merge gate has no fallback

Reinforcement for the root cause: on the runtime CLI the broken merge path has NO fallback.

Verified by disassembling the bundled `claude` binaries (0.3.210, 0.3.220 runtime, 0.3.258 for comparison). On 0.3.210 and 0.3.220 the TodoWrite and TaskCreate tool objects carry mutually exclusive enablement predicates:

  TodoWrite:   isEnabled(){ return !eP() && !Ete() }
  TaskCreate:  isEnabled(){ return  eP() && !Ete() }
  function eP(){ if (env.CLAUDE_CODE_ENABLE_TASKS === false) return false; return true }
  function Ete(){ /* Statsig 'tengu_vellum_ash' model-substring kill list, defaults to [] */ }

`eP()` is true by default, so on the runtime CLI the TaskCreate/TaskGet/TaskUpdate/TaskList family is provisioned and **TodoWrite is deliberately disabled**. There is no legacy path to fall back on: every task list the model keeps must travel through the per-item family, which is exactly the path mergeTaskToolInputIntoSnapshot drops when the input carries a non-canonical write shape.

This also explains the observed 2026-07-14 flip in the consumer's data (index ids "0","1" -> toolu_*) as an environment change rather than a model whim: TodoWrite stopped being offered, so the model had to switch families, and it switched onto the code path our gate had narrowed the same day.

Two further facts worth recording in the brief, both verified against the binaries:
- `CLAUDE_CODE_ENABLE_TODO_TOOLS` does not exist in 0.3.210 or 0.3.220 (0 occurrences). It was introduced exactly at **0.3.233** (bisected on the registry: 0.3.232 -> absent, 0.3.233 -> present). Setting it today is a no-op.
- Neither 0.3.210 nor 0.3.220 has any model-conditional gating of the family. The model-version gate (opus>=4.8, sonnet>=5, fable>=5, mythos>=5) appears only in 0.3.258, together with the CLI changelog line "Todo/task-tracking tools ... are no longer available on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer models".

