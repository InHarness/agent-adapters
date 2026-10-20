---
type: plan
title: >-
  Adjudicate five standing deviations from the timeoutMs / idleTimeoutMs change
  (M01, M13, M17)
created_at: '2026-09-22T13:22:54.008Z'
created_by: agent
applied: false
---
# Adjudicate five standing deviations from the timeoutMs / idleTimeoutMs change

<!-- anchor: d7gec4qu -->
## Intent

Three `spec-review` passes over the change that introduced `RuntimeExecuteParams.timeoutMs`
(absolute backstop), `RuntimeExecuteParams.idleTimeoutMs` (outstanding-work primitive) and
`AdapterIdleTimeoutError` left five deviations unrepaired. In this style a deviation is a
*finding*, not a verdict: the owner decides. This plan decides each one and records the
reasoning, so that the rejected three are not re-filed by the next reviewer.

Two are repaired. Three are rejected, and one of those three — deviation 1 — is rejected
because **the approved plan was right and the reviewer was wrong**, which is the outcome
this thread existed to establish.

No page and no entity was edited while drafting this. The product is this plan.

<!-- anchor: ybkfsvaa -->
## What the corpus actually does — evidence the verdicts rest on

Gathered before judging, because three of the five verdicts turn on it rather than on taste.

**E1 — naming an M13 error class outside M13 is the corpus idiom, not a deviation.**
32 occurrences across `adapters/A01`–`A04`, `index.md`, `layers/L6-auth-credentials.md`,
`layers/L7-sdk-compatibility.md`, and modules M03, M04, M12, M18. Only 3 of the 32 carry a
`section_ref` into M13 at all. Two *layer* files name `AdapterInitError` directly, one of
them inside its own `## Module slice schema`.

**E2 — naming the phase alongside the class is also the idiom.** `adapters/A03-opencode.md`
`d9ugsejh`: "`AdapterTimeoutError` / `AdapterAbortError` (runtime phase)".
`adapters/A02-codex.md` `26dlg7ut`: "(`AdapterToolPolicyError`, init phase)".
`layers/L6-auth-credentials.md` `le0v4g4j`: "always an `error` `phase: 'init'` —
`AdapterInitError`". The `class (phase)` parenthetical is a settled reference form here.

**E3 — L1's slice schema licenses the name and forbids only the definition.**
`layers/L1-unified-contract.md` `yc5ftl18`, consumer bullet: *"Reference each type by name;
do not restate its definition (that is the implementor's job)."* The line the schema draws
is name ↔ definition, not name ↔ pointer.

**E4 — M01 already names other modules' types in its own prose, elsewhere in its own file.**
`nbgtn5nk`: "`probeToolGating(...)` returns per requested group `{ group, enforceable,
strength, escapeSurfaces }` (M18)". `u39gu699`: "`resolveModel` passes the model through
untouched (M02)". And inside `8do90d06` itself, the `disallowedToolGroups` bullet spells out
M18's enum *members* verbatim — `'shell' | 'file-read' | 'file-write' | 'web'` — while
deferring the definitions. Naming another module's type in M01 is not novel here; it is four
bullets up in the same list.

**E5 — `module-dependency` is not an active entity type in this project, and 18 of 18
modules carry a `## Dependencies` markdown table.** `describe_entity_type("module-dependency")`
answers `INACTIVE_TYPE`. Not "zero records" — the type is not registered. Every module file
from M01 to M18 renders its dependencies as `| Module / Layer | Relation |`.

---

<!-- anchor: axnpyb2s -->
## Entry 1 — Deviation 1 (M01 `8do90d06`, `timeoutMs` bullet names `AdapterTimeoutError` and the `runtime` phase) — **REJECTED**

**Address:** `modules/M01-unified-core.md` `8do90d06`.
**Filed as:** rule 2 (one home) — strip the class name and the phase, leave the bare
`section_ref` to M13 `8q9q7ty7`, matching the neighbouring `idleTimeoutMs` bullet.
**Verdict: rejected. No edit. The approved plan's entry 2 was correct as written.**

The reviewer reads *naming a class* as already restating it. The style does not: E3 puts the
boundary at the type's **definition**, and a bare name is the reference form the schema
explicitly asks for. E1 and E2 show the corpus settling on exactly that form 32 times over,
including twice inside layer files, which are the strictest documents in this specification.
E4 shows M01's own file doing it four bullets above the disputed one, for M18's enum, down to
the member literals.

What M13 actually owns, and what this bullet must not carry, is the **outcome** — that the run
is stopped, what termination owes a run caught mid-work. The bullet defers precisely that, by
pointer, to `1vd9sye5`. So the clause "are not restated here" is true of what it governs.

The asymmetry with the `idleTimeoutMs` sibling is real but is not evidence for the reviewer's
reading: the terser bullet is the one departing from the corpus idiom, not the fuller one. If
the two are ever harmonised it should be by bringing `idleTimeoutMs` up to `class (phase)`,
not by stripping `timeoutMs` down. That harmonisation is **not planned here** — see
*Seen, not planned* — because the `idleTimeoutMs` bullet is being edited by another plan.

**Reason of record, for the next reviewer:** naming an M13 class and its phase inside M01 is
a *reference* under `layers/L1-unified-contract.md` `yc5ftl18` and the corpus idiom (E1, E2,
E4). Only M13's outcome is restatement, and it is pointered. Do not re-file.

<!-- anchor: u9vwslnv -->
## Entry 2 — Deviation 2 (M01 `8do90d06`, the "One standing exception…" clause repeats M17's cap arming) — **REJECTED**

**Address:** `modules/M01-unified-core.md` `8do90d06`, `timeoutMs` bullet, final clause.
**Filed as:** rule 2 — the clause carries "arms at a *held* `result`" and "bounds only the
parked stretch", which are M17 `q9u5sbot`'s content; reduce to a pointer plus "on terms M17
states".
**Verdict: rejected. No edit.**

The clause is not describing M17's cap for its own sake. It is bounding **M01's own
guarantee**, two sentences earlier: *"Omitting the field is a guarantee, not a default: …the
run carries no wall-clock bound."* That sentence is **false** without the exception, and the
exception is **misleading without its two qualifiers** — a reader told only "M17's cap ends a
run regardless of `timeoutMs`" concludes their unbounded run is in fact bounded, which is the
opposite of what M01 guarantees.

The style's allowance is explicit and this clause sits inside it: *"Someone else's insides
are one sentence and a pointer"* (plan.md, `Domain` residual test, question 2). One sentence,
one `section_ref` to `q9u5sbot`, and the sentence exists to delimit a claim M01 owns rather
than to explain a mechanism M17 owns.

**Reason of record:** the two qualifiers state the *scope of M01's own negative guarantee*,
not M17's mechanics. Stripping them makes M01's `timeoutMs` guarantee wrong. Do not re-file.

<!-- anchor: xmdsv5ky -->
## Entry 3 — Deviation 3 (M01 `8do90d06`, the four-clocks sub-bullet reproduces M17's grace/cap rules) — **FIX**

**Address:** `modules/M01-unified-core.md` `8do90d06`, the nested sub-bullet
*"This makes four clocks, and they must be told apart."*
**Rule:** 2 (one home for every piece of content).
**Verdict: fix. This is the one genuine rule-2 breach among deviations 1–3.**

Unlike entries 1 and 2, nothing M01 owns depends on these sentences. What M01 owns here is
the **four-way distinction** — "none substitutes for another", "a consumer's reaction is built
on distinguishing them", "all four are adapter-side". A distinction needs the two M17 clocks
**named by role and contrasted by outcome**; it does not need their arming conditions or
their re-arm rule, and today it carries both, one of them verbatim:

- M01: *"armed only once everything tracked has settled and is re-armed by every frame that
  arrives while parked"*
- M17 `q9u5sbot`: *"armed only once everything tracked has settled (the sole outstanding thing
  is then a wake-up) and **re-armed by every frame that arrives while parked**"*

Roughly fifteen consecutive words in two files. If M17 ever refines the re-arm rule — and the
parallel plan is about to touch exactly this model — M01's copy goes stale silently. Nothing
in this specification reports that; no consistency rule reads prose.

**The edit.** Inside the sub-bullet, replace, literally:

> The hold's **grace window** is armed only once everything tracked has settled and is
> re-armed by every frame that arrives while parked, and its expiry is silent. The hold's
> **hard cap** is armed at a held `result`, bounds the parked stretch, and its expiry is a
> terminal error; both of those belong to M17 (`<section_ref anchor="q9u5sbot"/>`).

with:

> The hold's **grace window** and its **hard cap** are M17's
> (`<section_ref anchor="q9u5sbot"/>`): both are armed by the hold rather than by the run, and
> they end it differently — grace silently, the cap with a terminal error. Their arming
> conditions and re-arm rules are stated there.

**What is deliberately kept:** the contrast (silent vs terminal) — it is the payload of M01's
own "different outcomes" claim. **What goes:** the arming condition, the re-arm rule, "bounds
the parked stretch".
**What is untouched:** the backstop and idle-clock sentences in the same sub-bullet. M01 owns
both of those clocks outright and they are not restatements of anything.

**Tooling:** `update_sections` on `8do90d06` with an `edit` action and a literal `textEdits`
substitution. No anchor is dropped; the sub-bullet has no heading of its own. No entity
operation. No `<index>` consequence.
**Execution order: this entry runs AFTER the parallel plan.** See *Collision*.

<!-- anchor: ji91ugka -->
## Entry 4 — Deviation 4 (M13 `1vd9sye5` copies M01's "a human being slow" rationale) — **FIX**

**Address:** `modules/M13-errors-resilience.md` `1vd9sye5`, the bullet
*"`abort()` / `timeoutMs` while a `user_input_request` is unanswered"*.
**Rule:** 2 (a rule is written once, at its owner).
**Verdict: fix, minimally — a nine-word deletion.**

M01 `8do90d06`, outstanding-work enumeration: *"an unanswered `user_input_request`, which is
a human being slow rather than an engine gone quiet"*. M13 `1vd9sye5`: *"a human being slow,
not an engine gone quiet"*. The same justification, near-verbatim, in two files.

A note on the filing: the reviewer also invoked L1's consumer clause *"Reference each type by
name; do not restate its definition"*. That clause governs `## Unified Contract (L1)`
sections, and `1vd9sye5` is M13's **Edge cases** section, so it does not reach here. Rule 2
does, on its own, and it is sufficient — which is why this is a fix and not a rejection.

**Why M13 loses nothing.** The fact M13 owns is the *behaviour*: those two clocks terminate
such a run and the idle clock never can. The fact M01 owns is *why* — that an unanswered
request counts as outstanding work. M13 keeps the premise in the form of a claim plus the
pointer it already carries; it stops keeping M01's gloss on that premise.

**The edit.** Replace, literally:

> outstanding work — a human being slow, not an engine gone quiet — so

with:

> outstanding work, so

leaving: *"…an unanswered request is outstanding work, so `idleTimeoutMs` does not advance
while one is open and can never be what ends such a run (M01 —
`<section_ref anchor="8do90d06"/>`)."*

**Tooling:** `update_sections` on `1vd9sye5`, `edit` action, literal `textEdits`,
`expectedMatches: 1`. No anchor dropped, no entity operation, no `<index>` consequence.
**Order:** independent of entry 3 — different page, different section. May run first or last.

<!-- anchor: kv0fvx95 -->
## Entry 5 — Deviation 5 (M17 `8qbvk9c5`, the M13 row's reason carries `M\d+` tokens) — **REJECTED**

**Address:** `modules/M17-background-tasks.md` `8qbvk9c5` (`## Dependencies`), the M13 row.
**Filed as:** rule 3a — *"a reason with an `M\d+` token in it"*; requires a bare `section_ref`
with no module name in prose. Filed with the standing load noted: the whole section is a
markdown table rather than records.
**Verdict: rejected. No edit — and the table conversion is explicitly not pulled in either.**

Rule 3a's symptom list describes the **`reason` field of a `module-dependency` record**. E5
settles it: that entity type answers `INACTIVE_TYPE` in this project. It is not empty — it is
not registered. There is no record, therefore no `reason` field, therefore no instance of the
symptom the rule names. The token sits in a markdown table cell, which is a different object
the rule does not govern.

**The wider problem is real and is not M17's.** 18 of 18 module files carry a `## Dependencies`
markdown table. Rule 3a's other symptom — *"a markdown table under `## Zależności`"* — is
therefore satisfied corpus-wide, uniformly, along with an English heading where the rule names
a Polish one. That is a **corpus-level decision**, and it has a hard prerequisite: the
`module-dependency` entity type must be activated in this project before a single record can
be written. Converting M17 alone would make it 1 of 18 — the one file the next reader cannot
pattern-match against — while fixing nothing. It goes to *Seen, not planned*.

And the point repair inside the wrong container is not merely pointless, it is wrong on its
own terms: E1 and E4 show that naming a module in module-file prose is this corpus's normal
register, including in M01's own sections and in `index.md` `vancl72m`. Rule 2a forbids
`[Mm]\d+` tokens in **layer** files; `modules/M17-background-tasks.md` is not one.

**Reason of record:** rule 3a governs `module-dependency` records; the type is `INACTIVE_TYPE`
here and 18/18 modules use tables. The `M\d+` tokens are in a table cell, not a record reason,
and module files are not subject to rule 2a. Re-file this only as part of a corpus-wide
conversion, and only after the entity type is activated. Do not re-file against M17 alone.

---

<!-- anchor: wh4rm3hn -->
## Collision with `close-two-holes-in-the-idletimeoutms-outstanding-work-model-m01-l1-m17`

**Recorded as a finding in its own right.** A parallel plan closes two holes in the
outstanding-work model: the missing "a wake-up not yet arrived" item in M01's enumeration, and
the missing re-arm rule for `idleTimeoutMs`. Both land in `modules/M01-unified-core.md`
`8do90d06` — the first in the `idleTimeoutMs` bullet, the second in **the four-clocks
sub-bullet**, which is the exact object entry 3 rewrites.

**I could not read that plan.** `get_plan` returns the plan attached to *this* thread and
takes no path; this thread is pinned to none. The collision below is derived from the scope
statement in the brief, not from that plan's text. Whoever executes should confirm against it.

**Ordering: the parallel plan goes first; entry 3 goes second.** Two reasons, both directional:

1. It **adds** a rule to the four-clocks sub-bullet; entry 3 **removes** duplicated text from
   it. Applied in that order, entry 3's trim lands on the final text and its literal `find`
   can be re-derived from what is actually there. Reversed, the addition re-expands a
   sub-bullet just trimmed, and an author re-establishing the contrast around a new re-arm
   rule is under real pressure to reach for M17's grace-window mechanics again — reintroducing
   exactly the duplicate entry 3 removed, with no reviewer left to catch it.
2. A new `idleTimeoutMs` re-arm rule may change what the four-way contrast has to say. Entry
   3's replacement text is written against today's sub-bullet and must be **re-read and
   re-fitted**, not pasted, once that rule exists.

**Operationally:** `update_sections` is hash-guarded, so the second writer must re-read
`8do90d06` before editing — the literal `find` string in entry 3 is transcribed from the
section as it stands today and will be stale if the parallel plan altered those lines.

**Entries 1, 2 and 5 do not collide** — they are rejections and write nothing. **Entry 4** is
in M13 `1vd9sye5`, outside the parallel plan's stated scope (M01 / L1 / M17), but that bullet
is about the idle model; if the parallel plan reached into it, re-read before editing.

<!-- anchor: 1eqblb85 -->
## Seen, not planned

- **`modules/M01-unified-core.md` `8do90d06`, `idleTimeoutMs` bullet** — it names neither its
  error class nor its phase, departing from the `class (phase)` reference idiom of E1/E2 that
  its `timeoutMs` sibling follows. Harmonising upward would settle the asymmetry the reviewer
  noticed, from the other end. Not planned: that bullet belongs to the parallel plan this
  turn, and two plans editing one bullet is the problem, not the fix.
- **`## Dependencies` across all 18 module files** — markdown tables where rule 3a asks for
  `module-dependency` records, under an English heading where it names `## Zależności`.
  Blocked on activating the `module-dependency` entity type, which is a project-configuration
  decision, not a spec edit. A corpus-wide conversion, or a deliberate ruling that this
  project departs from rule 3a; not a per-module repair.
- **`modules/M13-errors-resilience.md` `1vd9sye5`, hold-cap bullet** — *"Why an `error` rather
  than a `warning` is argued in M17"* points at reasoning that M17 `q9u5sbot` states at
  length. This is the shape of deviation 4 done correctly (claim + pointer, no copied
  rationale) and needs nothing; noted so a future sweep does not mistake it for one.

<!-- anchor: 29yyls96 -->
## Residual risk this plan does not close

The three rejections are recorded **here and nowhere else**. A reviewer reads the
specification, not plans, so nothing in the corpus stops deviation 1 or 5 from being filed
again. There is no in-spec channel for "reviewed and deliberately kept": `<index>`'s
`Open questions` is for the undecided, and a note in the prose saying why the text is the way
it is would be exactly the historical breadcrumb rule 9 forbids. Stated rather than papered
over.

<!-- anchor: g3jc02il -->
## Not investigated

- The parallel plan's own text — unreadable from this thread (see *Collision*).
- The incomplete sentences about the clock set in M17 `q9u5sbot` / `52ymvppn` and
  `adapters/A01-claude-code.md` `sw3cwrsm`, and the absence of `AdapterIdleTimeoutError` from
  M13's export list `9dv305bn` — another child's scope, excluded by the brief.
- Whether `AdapterIdleTimeoutError` is reachable by the e2e catalogue in M12 `xe2ecat1`; not
  raised by any of the three reviews and outside this brief.
