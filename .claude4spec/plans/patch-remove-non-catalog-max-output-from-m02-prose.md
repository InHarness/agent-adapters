---
type: plan
title: Patch — remove non-catalog "max output" from M02 prose
created_at: '2026-07-28T10:21:53.111Z'
created_by: agent
---
# Patch — max output 128k is not representable in the code catalog

**Patch kind:** `missing` · **Resolution:** Option 1 (max output is not catalog data — remove it from M02 prose).

<!-- anchor: 187azyng -->
## Decision (confirmed with user)

No consumer of the library uses max output. It is an Anthropic API fact the adapter never acts on — not catalog data. Therefore it must not sit in the model-addition prose, where implementers read it as an instruction. We drop it. No new public table / accessor / export (Option 2) is built.

<!-- anchor: ri3fqxg5 -->
## Findings (evidence)

1. "max output" appears in the entire `spec/` exactly once — the prose of M02 section `### claude-code models` (line 52), for `sonnet-5` and `opus-5`.
2. M02 catalog tables have no max-output column (columns: alias / resolved id / context window / adaptive-only?).
3. M08 consumes only context windows; nothing reads max output.
4. Per patch: `src/models.ts` has only `MODEL_CONTEXT_WINDOWS` + `getModelContextWindow()`; no max-output structure exists, and `sonnet-5` already shipped without this datum reaching code.

<!-- anchor: sdj08os0 -->
## Change

Single prose edit in `spec/modules/M02-models-aliases.md`, section `### claude-code models` (anchor `9gu9zp7z`), line 52:

- Remove `, max output 128k` from the `sonnet-5` clause.
- Remove `, max output 128k` from the `opus-5` clause.
- Keep `1M window` in both (that IS catalog data — the `context window` column).

Resulting sentence:

> `sonnet-5` (Anthropic API id `claude-sonnet-5`, 1M window) supports adaptive thinking only — extended/fixed-budget thinking is unavailable — so it joins the adaptive-only class alongside `opus-4.8`. `opus-5` (Anthropic API id `claude-opus-5`, 1M window) is likewise adaptive-only, joining the same class alongside `sonnet-5` and `opus-4.8`.

<!-- anchor: jlnn7u8o -->
## Out of scope

- No entity mutations (no `ac`, tag, or table changes).
- No code edits (`src/` is the downstream implementer's job, not the spec assistant's).
- No Option 2 work (no `max output` column, no `MODEL_MAX_OUTPUT` / `getModelMaxOutput()` / export, no backfill).

<!-- anchor: s8typ7p8 -->
## After the edit

Tell the user what changed; the patch is then ready for them to mark `completed` in the claude4spec UI (no agent tool does that).
