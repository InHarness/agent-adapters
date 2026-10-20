---
type: patch
brief: 0-9-6-to-0-9-7.md
patch_kind: clarification
created_at: '2026-08-26T15:56:51.267Z'
created_by: unknown
applied: false
---
# Patch — item 8 'match on family' asks for a mechanism the spec does not mandate

## What I found

Implementer item 8 says:

> Ensure `subagentDefinition` is reported `true` for the whole `claude-code-*` family … and `false` … for codex, gemini and opencode. **Match on family, not on an enumerated list of architecture ids.**

The last sentence reads as a required change to the lookup **mechanism**, but the code already conforms and the spec does not ask for that change.

`src/capabilities.ts:62-70` holds a static enumerated table — `claude-code`, `claude-code-ollama`, `claude-code-minimax` all `subagentDefinition: true`; codex, opencode, opencode-openrouter, gemini all `false` — with an all-false default for an unknown id (`:77-87`). Every registered architecture already reports what the brief demands; only the mechanism is enumeration rather than prefix matching.

I put this to the spec agent (`c4s ask`, thread `rqlCQbyvj5c5`) and the answer was unambiguous:

- The mechanism canon lives in M01 as implementor of L2 and says only that `architectureCapabilities(architecture)` returns *"a **static per-architecture map** of plain bool flags"*. It prescribes no matching rule at all.
- The "families, not an exhaustive list of registered architecture ids" sentence lives in the **M06 matrix** and is an instruction for *reading the spec table* (a column is not one id), plus a claim about the result for two named ids. It is a statement about **data**, not about the lookup algorithm — and by the one-home rule, M06 holds matrix data only; the mechanism belongs to M01/L2.
- A prefix fallback would therefore be a **contract extension**, not an implementation of this brief. It also could not be scoped to `subagentDefinition`: the mechanism is one shared lookup for every flag, so a prefix that applied to one flag only would be new, undescribed behaviour. The M15 matrix has the same `claude-code` column with no family annotation.

I left the code unchanged.

## Suggestion

1. Reword item 8 so it states the **outcome** rather than a mechanism the spec does not mandate — e.g. *"ensure the capability declaration covers the whole `claude-code-*` family (`claude-code-ollama`, `claude-code-minimax` included); an enumerated table that lists them all satisfies this."* As written, an implementer who takes it literally will refactor `architectureCapabilities` and silently widen the contract for every flag.
2. If family matching **is** actually wanted as a contract, it needs a spec edit first, and in M01/L2 (the mechanism's home), not in M06 — plus a decision on what an unknown `claude-code-*` id returns. Then the M06 sentence should point at the mechanism instead of describing columns, and the M15 matrix should be checked for the same ambiguity.
