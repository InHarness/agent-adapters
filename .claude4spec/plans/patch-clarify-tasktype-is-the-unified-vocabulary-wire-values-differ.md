---
type: plan
title: 'Patch: clarify taskType is the unified vocabulary (wire values differ)'
created_at: '2026-07-28T09:29:30.120Z'
created_by: agent
---
<!-- anchor: 2iitjc0n -->
## Context

Patch `0-9-0-to-0-9-1-retraction-...` is a **retraction** of the earlier release-axis patch. It has two parts:

1. **Release-axis half — RETRACTED.** `0.10.0` was a bad bump in the code repo (commit `4552070`); npm latest is `0.9.0`, the brief's `to_release: 0.9.1` was correct all along. The implementer fixed `package.json`/lock/CHANGELOG in the code PR. **No spec change — the spec was never wrong here.**
2. **Two survivors** worth acting on:
   - **(a)** The M17 work was already implemented when the brief arrived → this is feedback for the *brief generator* (detect "release-diff content already present"), **not a spec-content change**. Out of scope for a spec edit; flag to user only.
   - **(b)** `task_type` vocabulary → the spec's `{shell, monitor, workflow}` is the correct **unified** vocabulary, but the SDK sends `local_bash` and prefixes locally-executed kinds with `local_` (stripped before mapping). The spec should say **explicitly** that its enum is the unified one and wire values differ, so an implementer reading only the brief doesn't match on the wrong strings. **← the actionable spec fix.**

`patch_kind: incorrect`, but the "incorrect" part is the code repo, not the spec. Only survivor (b) yields a spec edit.

<!-- anchor: 3f1hnu8n -->
## Current state (verified)

Three sites enumerate `'shell' / 'monitor' / 'workflow'`:

- **M17 L1** `spec/modules/M17-background-tasks.md` §Unified Contract (anchor `01or0cpk`, line 30) — the **canonical home** for the unified vocabulary. Presents the enum but never says "unified vs wire", never mentions `local_bash`/`local_` stripping.
- **M06** `spec/modules/M06-subagents.md` mapping table (anchor `70dpqgcb`) — same enum shown as the routing split.
- **A01** `spec/adapters/A01-claude-code.md`:
  - Event-mapping table (anchor `mn3ytsj4`, line 24) — same enum shown as the wire `task_type`.
  - §Per-capability consumption (anchor `sw3cwrsm`, **line 70**) — **already** fully documents the wire truth: `task_type: 'local_bash'` (not `'shell'`), `local_` prefix on locally-executed kinds, adapter strips before mapping, "checked against a live probe, never inferred from the types."

So A01 is the sole authority on the wire nuance and is internally correct; M17 (the vocabulary home, and the source briefs are generated from) is the gap the patch flags.

<!-- anchor: 8gbw1815 -->
## Plan (per one-home rule: unified vocabulary is owned by M17 L1)

1. **M17 `01or0cpk` (primary edit).** Reword the `taskType discriminates…` sentence to label the enum explicitly as the **unified** vocabulary that consumers see, state that the SDK's wire discriminator may differ and MUST NOT be matched directly, give Claude Code's `local_bash` / `local_`-prefix example, and cross-ref A01 `sw3cwrsm` via `<section_ref anchor="sw3cwrsm"/>`. Keep the existing subagent-routing clause.

2. **M06 `70dpqgcb` (optional consistency).** Add a short parenthetical to the background-task row noting these are the **unified** kinds — wire values differ, see M17/A01. Small; keeps the third enumeration site from misleading an implementer reading M06 alone. Decide with user whether to include or keep M17-only.

3. **A01 — no change needed.** Line 70 already documents the wire spelling and the strip. Optionally a one-word cross-ref from the line-24 table to line 70, but that internal consistency already holds. Leave as-is unless user wants it.

4. **No entity/tag/AC changes.** This is prose clarification only; the `background_task_*` types and AC are unaffected.

5. **Report to user:** release-axis half needs nothing; survivor (a) is brief-generator tooling feedback (not spec); survivor (b) resolved by step 1 (+ optional step 2). Patch ready to be marked `completed` by the user in the C4S UI after the edit lands.

<!-- anchor: sx1km8i0 -->
## Entity-linking self-check

Edits touch background-task prose. `background_task_*` are event-type names (L1 vocabulary owned by M01), not registered entities of a linkable type here; `task_type`/`local_bash` are the *subject* of the clarification (naming-convention discussion) → bare code spans are correct per `<entity_linking_rule>` exceptions. Cross-refs use `<section_ref anchor=…/>`. No banned endpoint/DTO/table prose introduced.

<!-- anchor: 6f1paa3y -->
## Outcome (applied)

- **M17 `01or0cpk`** — edited. `taskType` now explicitly labeled the **unified** vocabulary consumers see, wire discriminator may differ and MUST NOT be matched directly, Claude Code `local_bash` / `local_`-prefix example, cross-ref to A01 `sw3cwrsm`. ✅
- **M06 `70dpqgcb`** — **no change needed.** On inspection M06 does *not* enumerate `shell/monitor/workflow` as wire strings; it only says "subagent kinds map here, everything else maps to M17" — already correct, cannot mislead. (The earlier exploration report was wrong that a `shell/monitor/workflow` table lived in M06; that table is A01's.)
- **A01 line 31** — added a one-clause cross-ref: the three names in the routing prose are the unified kinds, live wire strings are `local_`-prefixed and stripped, per the `task_type` spellings note (line 70). Tightens the exact "don't match wrong strings" concern where the mapping is presented. A01 line 70 already held.
- **No entity/tag/AC changes.**
