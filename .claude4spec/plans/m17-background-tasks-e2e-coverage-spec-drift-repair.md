---
type: plan
title: M17 background-tasks e2e coverage — spec drift repair
created_at: '2026-08-24T21:37:51.616Z'
created_by: agent
applied: true
---
> Read-only plan. Nothing below has been executed.

<!-- anchor: h1w3ep4n -->
## Scope & finding

Four drift claims were raised. Three are confirmed; one is a false positive that the plan deliberately does **not** "fix".

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | A01 <section_ref anchor="a01e2ecv"/> has no background-task / M17 row | **Confirmed** — table has no such row. |
| 2 | image / mid-turn / path-scope / usage / MCP elicitation / error-resilience marked `◻ planned` though implemented; `os sandbox degrade` has no row | **Confirmed** — plus the AC <inline_mention type="ac" slug="ac-claude-code-e2e-os-sandbox-degrade"/> already exists with no row to hang on. |
| 3 | M12 catalog <section_ref anchor="xe2ecat1"/> has no background-task scenario | **Confirmed** — and the same enumeration is duplicated in prose in L5 <section_ref anchor="ye2ecov1"/>, so the fix is two-sited. |
| 4 | All 13 m17 / m17-edge ACs have an empty `verifies`; no `ac-claude-code-e2e-background-tasks-scenario` exists | **Half false positive.** An empty `verifies` on a *capability* AC is the house convention, not drift: sampled leaves — <inline_mention type="ac" slug="ac-with-scope-declared-a-read-or-write-of"/>, <inline_mention type="ac" slug="ac-an-accepted-pushmessage-emits-user-messa"/>, <inline_mention type="ac" slug="ac-mcp-elicitation-bridges-elicitation-req"/> — all carry `verifies: []`. `verifies` points **from** the e2e scenario AC **to** the capability ACs it proves. The real gap is the missing scenario AC on the other end. |

Two open decisions are listed at the end; everything else is mechanical.

<!-- anchor: xyd6o3up -->
## 1. New AC entity — the background-tasks e2e scenario

`create_entities(type: "ac")`:

- **slug** — `ac-claude-code-e2e-background-tasks-scenario`
- **kind** — `requirement`
- **status** — `active`
- **tags** — `["m17"]` (owning-module tag, matching <inline_mention type="ac" slug="ac-claude-code-e2e-usage-scenario"/> → `m08`, <inline_mention type="ac" slug="ac-claude-code-e2e-path-scope-scenario"/> → `m15`; **not** `a01` — `a01` is reserved for adapter-unique capability ACs, and the e2e scenario ACs tagged `a01` are exactly the two that have no owning capability module)
- **text** — *"The claude-code e2e background-task scenario runs a wake-up matrix — {backgrounded bash, subagents} × {one-shot, streaming} — against a live model and asserts, in every cell, that task frames route to the right event family, that the run does not end at the first `result` but continues through the completion event and a continuation turn to `done`, that the control channel survives the held `result`, and that a healthy run emits no hold-bound `warning`."*
- **verifies** — six M17 capability ACs, one per assertion the matrix makes:
  - <inline_mention type="ac" slug="ac-the-claude-code-adapter-captures-task-ty"/> — `task_type` capture + family routing
  - <inline_mention type="ac" slug="ac-a-run-in-background-bash-command-s-settl"/> — the backgrounded-bash cells
  - <inline_mention type="ac" slug="ac-result-backgroundtasks-lists-engine-backg"/> — the subagent cells (held, but not reported)
  - <inline_mention type="ac" slug="ac-a-result-event-emitted-while-background"/> — push resume, `done` not first `result`
  - <inline_mention type="ac" slug="ac-the-input-control-channel-stays-open-acr"/> — the control-channel hold
  - <inline_mention type="ac" slug="ac-a-task-touching-run-whose-work-has-settl"/> — hold bounds silent on a healthy run

No `verifies` is added to the 13 existing M17 ACs — see the finding table, row 4.

<!-- anchor: zyheut9m -->
## 2. M12 — add `background-tasks` to the canonical catalog

`update_sections` on <section_ref anchor="xe2ecat1"/>, one row appended to the scenario table after `mid-turn` (keeping the lifecycle grouping) :

| `background-tasks` | engine-backgrounded work outliving the turn is observed end-to-end: the lifecycle family is emitted, the first `result` is **not** terminal, the engine's wake-up produces a continuation turn and a further `result` before `done`, and the control channel is still live across the hold. Absent on adapters whose SDK never backgrounds work (M17's skip strategy). |

Wording rule respected: the row states *what it proves*, not prompt strings or `assert*` names.

<!-- anchor: qa0jgm8l -->
## 3. L5 — un-drift the duplicated enumeration

<section_ref anchor="ye2ecov1"/> lists the catalog names inline in prose ("…simple text, thinking, tool/MCP, subagents, plan mode, path-scope, resume, todo, user-input, image, mid-turn, abort, unknown-model, usage"). A `textEdits` substitution appends `background-tasks` to that list, so the layer's own summary does not contradict M12's table. Nothing else on the L5 page changes.

<!-- anchor: 87wzulil -->
## 4. A01 — rewrite the `e2e coverage (L5)` table

`update_sections` on <section_ref anchor="a01e2ecv"/>. Six status flips, one row split, two rows added:

**Flips `◻ planned` → `✅ covered`** (each already has its scenario AC):

| Row | Owning module | AC backing the flip |
| --- | --- | --- |
| `image` | M10 | <inline_mention type="ac" slug="ac-claude-code-e2e-image-scenario"/> |
| `mid-turn` | M11 | <inline_mention type="ac" slug="ac-claude-code-e2e-mid-turn-scenario"/> |
| `path-scope` | M15 | <inline_mention type="ac" slug="ac-claude-code-e2e-path-scope-scenario"/> |
| `usage` | M08 | <inline_mention type="ac" slug="ac-claude-code-e2e-usage-scenario"/> |
| MCP elicitation | M04 | <inline_mention type="ac" slug="ac-claude-code-e2e-mcp-elicitation-scenario"/> |

**Split the `error/resilience` row.** It currently bundles two behaviours with different truth values:

- `error/resilience (timeoutMs)` | M13 | ✅ covered — backed by <inline_mention type="ac" slug="ac-claude-code-e2e-timeout-scenario"/>
- `sdk-version gate (out-of-range → AdapterInitError)` | M12 / L7 | ◻ planned — <inline_mention type="ac" slug="ac-claude-code-e2e-sdk-version-gate"/> states in its own text that the gate is *not yet implemented in code*. Flipping the bundled row to covered would assert something false.

**New rows:**

- `background-tasks` (wake-up matrix: {backgrounded bash, subagents} × {one-shot, streaming}) | M17 | ✅ covered
- `os sandbox degrade` (hard→soft on a host without bubblewrap/seatbelt) | M15 | ✅ covered — the orphaned AC <inline_mention type="ac" slug="ac-claude-code-e2e-os-sandbox-degrade"/> finally gets its row

**Unchanged:** `model matrix` stays `◻ planned` — nothing in the reported evidence says the parametrized sweep is run in CI, and <inline_mention type="ac" slug="ac-claude-code-e2e-model-matrix-scenario"/> is not contradicted. See open decision B.

The section's closing sentence ("Per-scenario acceptance detail is authored as AC entities…") stays as authored; it already describes the tagging scheme the new AC follows.

<!-- anchor: xgl078fa -->
## 5. M17 — the per-capability nuance line (one-home discipline)

L5 puts coverage in the adapter file and *per-capability nuance* — which assertion proves the capability — beside the capability's support matrix in the owning module. M17 has no L5 section and should not grow one. Instead, one sentence is appended to <section_ref anchor="ujhcafnf"/>, under the support matrix:

> The hold and the routing are proved live, not only by construction: claude-code's suite runs a wake-up matrix over {backgrounded bash, subagents} × {one-shot, streaming}, which is what makes the "control channel held with the session" row a measured ✅ rather than a design intent — coverage is owned by the adapter (see <section_ref anchor="a01e2ecv"/>).

No new heading, no restated table, no e2e detail duplicated into M17.

<!-- anchor: g8zazll6 -->
## 6. Verification pass

1. `check_consistency` — expect the new `verifies` edges to resolve and no new broken refs.
2. `find_references({ target: "entity", type: "ac", slug: "ac-claude-code-e2e-background-tasks-scenario", includeTagMatches: true })` — expect the `m17` `tagged_list` on <section_ref anchor="02okhxqj"/> to pick it up (that is the only surface it needs; A01's list is tag `a01`, which this AC deliberately does not carry).
3. Re-read <section_ref anchor="a01e2ecv"/> and confirm no row remains whose status contradicts its AC.

<!-- anchor: bfcbw8wv -->
## Open decisions (please confirm before execution)

**A. Should `os sandbox degrade` enter the M12 catalog, or stay adapter-local?** claude-code is today the only hard-capable adapter, so the scenario has no cross-adapter vocabulary value yet; the catalog is explicitly the *shared* vocabulary. The plan currently keeps it adapter-local (an A01 row only), the same way `MCP elicitation` and `model matrix` already live as A01 rows without catalog entries. Alternative: fold it into the catalog as a `path-scope` sub-case.

**B. `model matrix` status.** Left `◻ planned`. If the parametrized sweep does run, say so and it becomes a one-line flip in step 4.

**C. One scenario AC or two?** The matrix proves both a requirement (routing + push resume + hold) and an edge-ish invariant (silence of the bounds on a healthy run). The plan authors **one** `requirement` AC with six `verifies`, consistent with how <inline_mention type="ac" slug="ac-claude-code-e2e-path-scope-scenario"/> covers several assertions in one entity. Splitting off an `m17-edge` AC for the silence assertion is the alternative.

<!-- anchor: q029oajm -->
## Out of scope

No code, no tests. `src/testing/e2e/claude-code.e2e.test.ts` is the evidence this plan reads *about*; per CLAUDE.md the spec assistant never edits it. If the spec ends up ahead of the code (the sdk-version gate row), that is recorded as `◻ planned`, not silently reconciled.
