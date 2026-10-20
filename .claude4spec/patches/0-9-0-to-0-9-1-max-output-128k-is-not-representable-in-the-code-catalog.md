---
type: patch
brief: 0-9-0-to-0-9-1.md
patch_kind: missing
created_at: '2026-07-27T22:47:19.163Z'
created_by: unknown
status: completed
---
# Patch — max output 128k is not representable in the code catalog

## What I found

The brief specifies `opus-5` as "(Anthropic API id `claude-opus-5`, 1,000,000-token context window, **max output 128k**)" and repeats "max output 128k" in the implementer section for `src/models.ts`.

There is no per-model max-output structure anywhere in `src/`. `src/models.ts` has exactly one numeric table, `MODEL_CONTEXT_WINDOWS`, which is *input* context window only, with a single accessor `getModelContextWindow()`. No `maxOutput` / `max_output` / `maxTokens` table exists, and nothing in the adapters reads such a value.

M02's own catalog table has no max-output column either — its columns are alias / resolved id / context window / adaptive-only. "Max output 128k" appears only in the surrounding prose, and it appears there for `sonnet-5` too, which shipped in an earlier release without the datum ever reaching the code.

So the phrase is not implementable as written: honouring it means inventing a new public table, an accessor, and an export, and then backfilling every existing model to keep it coherent — a public API addition well outside a catalog-row brief. I implemented the alias, the resolved id, the 1M context window and the adaptive-only membership, and left max output unrepresented.

## Suggestion

Decide which of these the spec means, and make M02 say it:

1. **It is not catalog data** — max output is an Anthropic API fact the adapter never acts on, so drop it from the model-addition prose (or move it to a non-normative note) so implementers stop reading it as an instruction.
2. **It is catalog data** — then add a `max output` column to the M02 tables for *all* models, and raise a dedicated brief for the `MODEL_MAX_OUTPUT` table + `getModelMaxOutput()` accessor + export, including what a consumer is expected to do with it. Worth stating the motivating use case: today nothing in the library would read it.

Option 1 looks right unless a consumer needs it for budgeting. If option 2, note that `sonnet-5`, `fable-5` and the Opus 4.x family all need backfilling in the same pass.

