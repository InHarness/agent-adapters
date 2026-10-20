---
type: plan
title: Add Claude Opus 5.5 to the M02 model catalog
created_at: '2026-09-22T20:58:50.471Z'
created_by: agent
applied: true
---
# Add Claude Opus 5.5 to the M02 model catalog

<!-- anchor: vy0clzur -->
## Intent

Claude Opus 5.5 was released on 2026-09-22. The spec's model catalog (`M02-models-aliases`, L3) is **canon over `src/models.ts`**, so the model enters the specification first and propagates to code afterwards. Read as: you want the new model present in every list that enumerates Anthropic models, with the alias verified against Anthropic's own documentation — not a code change in this thread.

<!-- anchor: 4sm2g5wz -->
## Verified facts (platform.claude.com, fetched 2026-09-22)

| Fact | Value |
| --- | --- |
| Claude API id / alias | `claude-opus-5-5` (dateless id **is** the pinned snapshot; the alias row repeats it) |
| OpenRouter slug | `anthropic/claude-opus-5.5` |
| Context window | 1,000,000 tokens |
| Max output | 128K (300K on Batch API with `output-300k-2026-03-24`) |
| Thinking | Adaptive, **always on**, cannot be disabled |
| Effort ladder | `low\|medium\|high\|xhigh\|max`, default **`medium`** (every other model defaults to `high`) |
| `thinking:{type:'disabled'}` | 400 at **every** effort level (on Opus 5 only at `xhigh`/`max`) |
| Other breaking changes vs Opus 5 | forced tool use returns an error; thinking blocks tied to model+conversation; text between tool calls arrives in `thinking` blocks, empty at default `display` |

<!-- anchor: ipxqnjln -->
## Entry 1 — M02 `Model catalog (L3)` → claude-code table

**Address:** `modules/M02-models-aliases`, section <section_ref anchor="9gu9zp7z"/>.

Insert as the first row (the table is newest-first; `fable-5.1` heads it — place `opus-5.5` directly after it, before `sonnet-5`):

```
| `opus-5.5` | `claude-opus-5-5` | 1,000,000 | ✓ |
```

Extend the prose after the table in its existing shape: `opus-5.5` (Anthropic API id `claude-opus-5-5`, 1M window) is adaptive-only — thinking cannot be disabled at all, which is a stronger statement than for `opus-5`.

**Schema fields answered (L3):** alias, resolved id, context window, adaptive-only membership.

<!-- anchor: rj77qzkh -->
## Entry 2 — M02 `ADAPTIVE_THINKING_ONLY` semantics

**Address:** section <section_ref anchor="udbixmag"/>.

The set is keyed by **resolved** id and written as a parenthetical comma list. Insert `claude-opus-5-5` into it, after `claude-opus-5`. No change to the semantics sentence — <inline_mention type="ac" slug="ac-an-adaptive-thinking-only-model-ignores"/> covers the behaviour unchanged.

Note the asymmetry deliberately: the OpenRouter form `anthropic/claude-opus-5.5` does **not** enter this set — the column is meaningful only for architectures whose resolved ids are bare Anthropic strings.

<!-- anchor: daccj6e1 -->
## Entry 3 — M02 `opencode-openrouter` table

**Address:** section <section_ref anchor="b14uq6ky"/>.

That table has no adaptive-only column and orders by popularity. Insert:

```
| `claude-opus-5.5` | `anthropic/claude-opus-5.5` | 1,000,000 |
```

Placement: above `claude-opus-5`.

<!-- anchor: fhyhn1qi -->
## Entry 4 — acceptance criterion

**Operation:** `create_entities`, type `ac`, tag `m02`, kind `requirement`, following the wording of <inline_mention type="ac" slug="ac-resolvemodel-claude-code-opus-5-re"/>:

> `resolveModel('claude-code', 'opus-5.5')` returns `'claude-opus-5-5'`, and `'claude-opus-5-5'` is a member of `ADAPTIVE_THINKING_ONLY`.

One criterion, one observable fact per the type's rule — the membership clause is kept only because the sibling criterion for `opus-5` already joins them and consistency inside the module wins over splitting a pair that is read as one assertion. Split into two if you prefer the stricter reading; say so and the plan changes.

No second criterion for OpenRouter: the existing `anthropic/`-prefix criterion (<inline_mention type="ac" slug="ac-resolvemodel-opencode-openrouter-cla"/>) already fixes that mapping rule, and a per-model repeat would be catalogue data restated as a criterion.

<!-- anchor: gtuk484y -->
## Entry 5 — A01 SDK/CLI floor: an open measurement, not an edit yet

**Address:** `modules/A01-claude-code`, section <section_ref anchor="49zu34oc"/>.

L7 declares that a change to the model catalog **is itself a trigger** for re-checking this consumer's dev-pin floor, and A01 records exactly **one** floor — the newest alias's (`claude-fable-5-1`: CLI ≥ 2.1.251, SDK ≥ 0.3.251). The CLI validates the model id, so an unrecognised `opus-5.5` surfaces as a runtime `API Error: 400 … does not support this model`, never as an init fault.

What this plan asks for is therefore a **live probe**, not a guessed number:

1. Probe `opus-5.5` against the current dev pin (`^0.3.251`, resolved 0.3.263).
2. If it answers normally → no floor change; add a Verified-pin log row recording the probe outcome for the new alias, in the existing format `| date | dev-pin | verified by | findings |`.
3. If it 400s → bump the floor bullet to the CLI/SDK version the error names, quote the 400 **verbatim** in the new log row, and run `sdk-surface-probe` as the pin-bump obligation requires.
4. Only if the two disagree per alias does the section take the per-alias-table exception it already anticipates.

The log row is written after the probe. Nothing in A01 is edited on faith.

<!-- anchor: nyld7naj -->
## Entry 6 — `index.md` Open question 8

**Address:** `index.md`, section <section_ref anchor="0aj92zki"/>, point 8.

Point 8 is titled after Opus 5 and is now understated. Rewrite it to carry Opus 5.5 as the sharper case, keeping the question itself open:

- the ladder is unchanged (`low|medium|high|xhigh|max`) but the **default drops to `medium`**, so a request that omits `claude_effort` runs one level lower than it did on Opus 5 — a silent behaviour change for any consumer that switches model without touching config;
- the watch item hardens: `thinking:{type:'disabled'}` is a 400 at **every** effort level on Opus 5.5, not only at `xhigh`/`max`. Still unreachable today (the adapter never emits `'disabled'`), but it now forecloses a disabled-thinking path entirely rather than partially;
- sub-questions (a) widening `claude_effort` and (b) making the ladder spec canon stay open, unchanged.

Rename the point to cover both models rather than filing a ninth question — it is the same question, with a better example.

<!-- anchor: vqdwd615 -->
## Entry 7 — e2e coverage: no edit

**Address:** `A01-claude-code` section <section_ref anchor="a01e2ecv"/>, row `model matrix (core scenarios × M02 catalog) | M02 | ◻ planned`.

The matrix is parametrized over the whole M02 catalog via `E2E_CLAUDE_MODEL`; it carries no per-alias rows. Adding Opus 5.5 to M02 widens its declared scope automatically. **No edit here** — recorded so the widening is a decision and not an oversight.

<!-- anchor: bozwr1e9 -->
## Execution order

Entries 1 → 2 → 3 (catalog first, since it is canon) → 4 (criterion) → 6 (index) → 5 (A01, after the probe) → 7 (nothing).

<!-- anchor: 8jxr8hza -->
## Seen, not planned

- **Opus 5.5 breaking changes beyond the catalog.** Forced tool use returning an error, and thinking blocks being tied to the model that produced them, touch the adapter's request shaping and M07 resume across a model switch. Neither is a catalog fact; both deserve their own read before anything is written.
- **Text between tool calls arrives in empty `thinking` blocks at default `display`.** A streaming consumer goes quiet between tool calls. Likely an M08/M09 (stream) concern, not M02.
- **`src/models.ts` mirror.** The catalog is canon; propagating these three rows to code is a downstream brief, not part of this plan.
- **Codex / Gemini / local-runtime catalog tables** (<section_ref anchor="jq7y9jh0"/>, <section_ref anchor="b762jf0d"/>, <section_ref anchor="m2zqnniu"/>) were not read — Opus 5.5 is Anthropic-only and does not belong in them.
