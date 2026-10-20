---
type: plan
title: Add Claude Fable 5.1 to the M02 model catalog
created_at: '2026-09-06T21:37:43.192Z'
created_by: agent
applied: true
---
# Add Claude Fable 5.1 to the M02 model catalog

<!-- anchor: q3rwam04 -->
## Intent

Anthropic released Claude Fable 5.1 on 2026-09-01. M02 is the **canon** for aliases, resolved ids, context windows and adaptive-only membership (`src/models.ts` mirrors it), so a consumer can only select the new model by alias once the catalog carries it. Everything else — adapters A01–A04, the claude-code e2e model matrix in L5 — reads the catalog rather than duplicating it, so the change stays inside `modules/M02-models-aliases.md`.

Verified against the vendor docs (not assumed): model id `claude-fable-5-1`, context window 1M tokens, thinking "Adaptive (always on)".

<!-- anchor: gr0cppif -->
## Facts the change is built on

| Property | Value | Source |
| --- | --- | --- |
| Claude API model id | `claude-fable-5-1` | platform.claude.com — Fable 5.1 overview, Model IDs |
| Context window | 1,000,000 | same page, Capabilities |
| Thinking | Adaptive (always on) — no `budget_tokens` mode | same page, Capabilities / "How it compares" |
| Released | 2026-09-01 | same page, Availability |

`fable-5` stays in the catalog alongside 5.1 (user decision) — same shape as `opus-4.6` / `4.7` / `4.8` living side by side.

<!-- anchor: ohes9r1w -->
## Edits

All three are in `modules/M02-models-aliases.md`, section `## Model catalog (L3)`.

<!-- anchor: ehuq2z79 -->
### 1. claude-code table — anchor `9gu9zp7z`

Insert one row **above** `fable-5` (the table leads with the newest Fable):

```
| `fable-5.1` | `claude-fable-5-1` | 1,000,000 | ✓ |
```

The trailing prose paragraph is **not** touched: it exists to explain why `sonnet-5` and `opus-5` joined the adaptive-only class; `fable-5` never got a sentence there, and the `ADAPTIVE_THINKING_ONLY` subsection is the one home for that semantics.

<!-- anchor: hzot3shj -->
### 2. opencode-openrouter table — anchor `b14uq6ky`

Insert one row directly **above** `claude-fable-5`, keeping the dotted OpenRouter id form used by the neighbouring `anthropic/claude-opus-4.8`:

```
| `claude-fable-5.1` | `anthropic/claude-fable-5.1` | 1,000,000 |
```

The table is ordered by popularity, so 5.1 takes the slot of its predecessor rather than the top of the table.

<!-- anchor: yo1e6r3q -->
### 3. `ADAPTIVE_THINKING_ONLY` semantics — anchor `udbixmag`

Extend the enumeration of resolved Anthropic ids with `claude-fable-5-1`, listed first:

> `ADAPTIVE_THINKING_ONLY` is keyed by **resolved** Anthropic model id (`claude-fable-5-1`, `claude-fable-5`, `claude-sonnet-5`, …)

This is what makes the `✓` in edit 1 true — A01 reads the class to auto-convert `claude_thinking: 'enabled'` to `'adaptive'` and to suppress a fixed thinking budget.

<!-- anchor: o2ws4dn1 -->
## Deliberately not edited

| Address | Why not |
| --- | --- |
| `M02` L4 — anchor `ckbqkmr6` | Exports `MODEL_ALIASES` / `ADAPTIVE_THINKING_ONLY` as a whole; a new row adds no export. |
| `L5-testing-conformance` — anchor `ye2ecov1` | claude-code parametrizes the e2e suite over the **whole** M02 catalog (`E2E_CLAUDE_MODEL`); breadth follows the catalog automatically. |
| `adapters/A01`–`A04` | Each links to its per-architecture table and does not duplicate rows. |
| `index.md` | No new module, layer or relation — the module and layer tables stay accurate. |
| `ac` entities tagged `m02` | The generic criteria already cover the new row: unknown-model pass-through, and "each resolved model maps to a known context window". A per-alias criterion for `fable-5.1` would only restate table data — see Open question 2. |

<!-- anchor: 1nwarrc0 -->
## Open questions (not part of this change)

1. **Fable 5.1 breaks forced tool use** and adds per-message effort, turn-scoped system messages and progress updates between tool calls. These are contract-surface questions for the tool-gating / thinking capability modules and A01, not catalog rows. Worth a separate pass — say the word and I will locate the owning modules.
2. **A dedicated `ac` for the new alias** — the m02 set holds sample criteria naming concrete aliases (`opus-5`, an openrouter id). Adding `resolveModel('claude-code', 'fable-5.1') → claude-fable-5-1` would be consistent with those samples; my default is not to, since the catalog table is already the assertion.

<!-- anchor: pomc2ktl -->
## Execution order

1. `update_sections` on `modules/M02-models-aliases.md` — the three edits above as one transactional batch, with `expectedHash` from `get_page_outline`, no anchor dropped.
2. Drift check of `index.md` against the module and layer tables (expected: clean).
3. Hand the saved change to `spec-review` and relay its verdict verbatim.
