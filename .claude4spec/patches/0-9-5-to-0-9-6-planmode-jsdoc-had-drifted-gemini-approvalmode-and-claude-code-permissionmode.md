---
type: patch
brief: 0-9-5-to-0-9-6.md
patch_kind: drift
created_at: '2026-08-25T13:34:52.221Z'
created_by: unknown
applied: false
---
# Patch — planMode JSDoc had drifted: gemini approvalMode and claude-code permissionMode

## What I found

`RuntimeExecuteParams.planMode` carried a per-adapter mapping block in its JSDoc
(`src/types.ts:762-780` at 728ba37) that had drifted from the code on two points, both
predating this brief:

1. **`gemini: approvalMode='plan'`** — false, and deliberately so. `src/adapters/gemini.ts:243-247`
   explicitly rejects gemini-cli's `'plan'` approval mode because it injects a plan-first
   workflow system prompt that violates the unified `planMode` contract. The adapter used a
   hardcoded `excludeTools` list instead, and now uses the M18 group mapping.
2. **claude-code "runs under `permissionMode: 'bypassPermissions'`"** — no longer
   unconditional. Since the M15 soft path-scope fix, `permissionMode` is
   `softScope ? 'dontAsk' : 'bypassPermissions'` (`claude-code.ts:706`) — decided by path
   scope, not by plan mode.

I rewrote the block as part of this brief, since plan mode is now a preset over
`disallowedToolGroups` and the per-adapter enumeration no longer belongs there at all —
there are no per-adapter plan-mode code paths left to document.

## Suggestion

Not a spec defect so much as a warning about a shape: a **per-adapter mapping table
embedded in a type's JSDoc** is a second home for knowledge the adapter files already own,
and it drifted silently for at least two releases because nothing tests a doc comment.

If M01 or the adapter files carry a similar per-adapter enumeration for another field, it
is worth checking against the code — `allowedTools` had the opposite problem (no JSDoc at
all, which is how three adapters came to ignore it in silence without anyone noticing).

The one-home rule the spec applies to capability matrices would be worth stating for
prose/JSDoc too: the capability-module owns the matrix, and a type's doc comment should
link to it rather than restate it.

