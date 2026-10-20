---
type: plan
title: 'Close two holes in the idleTimeoutMs outstanding-work model (M01 L1, M17)'
created_at: '2026-09-22T13:15:52.630Z'
created_by: agent
applied: false
---
# Close two holes in the `idleTimeoutMs` outstanding-work model (M01 L1, M17)

Follow-up to `specify-timeoutms-arming-semantics-in-runtimeexecuteparams-m01-l1.md` (v4, applied). That plan introduced the outstanding-work model in `modules/M01-unified-core.md` `8do90d06`. Its closing review found two holes in the model itself. Both are **real** — verified below against the spec text and against `src/`. Neither is editorial: each turns on a decision that is the owner's, so this plan **blocks on two questions** (Rule 4) and does not settle them.

<!-- anchor: edh9om9k -->
## Intent

The model's promise is that a consumer can set one number and get "the engine went quiet when it owed me something" without that number ever cutting a healthy run short. Two states break that promise today:

1. a run **parked on M17's control-channel hold waiting for a wake-up** — healthy, silent by design, and invisible to M01's closed enumeration; and
2. a run **streaming a long turn with no tool calls** — healthy, noisy, and also outside the enumeration.

In both, a consumer who sets `idleTimeoutMs` gets `AdapterIdleTimeoutError` on a run that was fine. Case 1 is worse than a spurious error: it replaces M17's **deliberately silent** grace expiry with exactly the false loss-of-work report that silence exists to prevent.

The two are not independent. Fixing 2 (what re-arms the clock) makes 1's exposure window exactly computable, so 2 is decided first and 1 is written against it.

<!-- anchor: js3bu3dj -->
## Entry 0 — verified facts

Read before deciding. Spec quotes are verbatim; code facts are from `src/` at HEAD.

| # | Fact | Source |
| --- | --- | --- |
| 1 | The enumeration is closed and complete as written: "a `tool_use` with no matching `tool_result` yet; a subagent still open (M06); a background task not yet settled (M17); an unanswered `user_input_request` …; and a nested turn the consumer started from inside the run." | M01 `8do90d06` |
| 2 | M01 **asserts** the idle clock re-arms, and never says on what: "The clock that does re-arm is `idleTimeoutMs` below." | M01 `8do90d06`, `timeoutMs` bullet |
| 3 | The `idleTimeoutMs` bullet states only gating, never a reset: "The idle clock advances **only in the first state**." The four-clocks paragraph repeats the gating ("advances only while nothing is outstanding and stops whenever work is in flight") while naming the grace window's reset explicitly ("re-armed by every frame that arrives while parked") — and then claims all four have "different re-arm rules". | M01 `8do90d06` |
| 4 | The rejected rule, verbatim: "'re-arm on the last sign of life' makes silence itself the signal, when silence means nothing on its own, and every fix built that way is one more special case on a list that is never complete." | M01 `8do90d06` |
| 5 | M17's grace is armed **after** the task settles, and names the residual state: "a short **grace window**, armed only once everything tracked has settled (**the sole outstanding thing is then a wake-up**) and **re-armed by every frame that arrives while parked**, so what it measures is engine *silence*." | M17 `q9u5sbot` |
| 6 | Grace expiry is silent, cap expiry is not: "The two bounds have opposite outcomes: grace expiry is silent, cap expiry is a terminal `error`." | M17 `q9u5sbot` |
| 7 | `BACKGROUND_WAKEUP_GRACE_MS = 15_000`; the code comment confirms the intent — "Expiry is silent: it is where a run whose work is finished ends, not a truncation." | `src/adapters/claude-code.background-hold.ts:290-296` |
| 8 | `MAX_BACKGROUND_HOLD_MS = 90_000`; `COLLECT_EVENTS_DEFAULT_TIMEOUT_MS = 120_000`. | `src/adapters/claude-code.background-hold.ts:328`, `src/utils.ts:17` |
| 9 | Grace is consumer-tunable at runtime and has **no upper bound**: "`claude_backgroundGraceMs` … A value that is not a finite number above zero degrades to the default." So any fixed numeric relation between `idleTimeoutMs` and grace is unsafe. | M17 `52ymvppn`, `src/options.ts:168-181` |
| 10 | There is already a **house pattern**: every module owning an outstanding-work state states at its own address that the idle clock cannot cut it short. M06: "**That list of triggers is complete, and the idle clock is missing from it on purpose:** an open subagent is outstanding work…". M13: "**Those two and no other clock:** an unanswered request is outstanding work…". **M17 has no such sentence** — the one module whose hold state the enumeration does not cover. | M06 `4b8iv50p`, M13 `1vd9sye5`, M17 `q9u5sbot` |
| 11 | M17 already carries the precedent for a **stated ordering constraint between clocks**: "The cap must stay strictly under whatever timeout the consumer applies to the stream … Adapters pick a default below the helper's, and the lever's documentation says to raise both together." | M17 `q9u5sbot` |
| 12 | M17 states the relation from its own side, and it covers only the unsettled phase: "`idleTimeoutMs` is the clock that does not: a background task **not yet settled** is outstanding work…" — i.e. M17 itself documents the gap's exact boundary without naming it. | M17 `8qbvk9c5` |
| 13 | **`idleTimeoutMs` does not exist in `src/`.** It appears only in `spec/modules/M01`, `M06`, `M13`, `M17` and two `ac` entities. The primitive is spec-ahead and unreleased, so neither fix carries an M12 semver consequence or a migration. | `grep -r idleTimeout` |
| 14 | M13 owns the outcome only, by explicit division: "M13 owns the outcome alone … What makes that clock advance and what stops it is M01's and is not restated here." | M13 `1vd9sye5` |

<!-- anchor: 6y4ympoq -->
## Verdicts

**Gap 1 — REAL.** Walk M01's enumeration at the moment M17 arms the grace (fact 5): no unmatched `tool_use`, no open subagent, **the background task has settled**, no open `user_input_request`, no nested turn. Nothing is outstanding, so the idle clock advances through a stretch the spec itself calls healthy. Fact 12 is the proof from M17's own side — it scopes its claim to "not yet settled" and says nothing about after. Fact 10 is the proof from the pattern's side: M06 and M13 both carry the sentence, M17 cannot, because the enumeration gives it nothing to point at.

**Gap 2 — REAL, and stronger than "underspecified".** Fact 2 is a promise the contract never redeems: M01 asserts the idle clock is the one that re-arms, then never states on what. Fact 3 shows the omission is systematic — the grace window's reset is spelled out in the same paragraph, the idle clock's is not, and the paragraph nonetheless claims all four differ in their re-arm rules. Read literally (no reset), a continuously streaming turn with no tool calls has nothing outstanding and dies mid-sentence. This is a dangling reference in a contract, not a silence a reader can fill safely — and the obvious fill is verbatim the rule of fact 4.

<!-- anchor: pdrb68ry -->
## Blocking decision A — what re-arms the idle clock when nothing is outstanding

Settle this first; entry 2 depends on the answer.

- **A1 — two-part rule: suspend while outstanding, reset on emission while not (RECOMMENDED).** The clock measures *continuous* silence toward the consumer: any `UnifiedEvent` the run yields resets it, and outstanding work suspends it entirely. This redeems fact 2, kills the streaming-turn regression, and — against fact 4 — is *not* a return of "last sign of life", because what was rejected was that rule **as the whole rule**: unguarded, it had no suspension, which is why a ten-minute silent tool call died and produced the consumer's regressions. The suspension is the model's contribution; the reset was never the defect. Cost: the rejection sentence must be rewritten to say precisely what was rejected, or a reader will read A1 as the plan undoing its own predecessor.
- **A2 — no reset; widen the enumeration to include "a turn in progress".** Keeps "advances only in the first state" literally true by making an unfinished turn outstanding work. Rejected on purpose: it guts the primitive. With a turn in progress always outstanding, the clock could only ever advance *between* turns — precisely never in the case it exists for, a wedged engine mid-turn.
- **A3 — leave it to adapters.** Rejected: fact 13 means every adapter would invent a different rule with nothing to conform to, and the field's whole value is being one number with one meaning across four adapters.

**Recommendation: A1**, with the rejection sentence rewritten in the same edit.

<!-- anchor: y0ezud5b -->
## Blocking decision B — how the wake-up park relates to the idle clock

Under A1, the park's exposure is exact: grace and the idle clock would measure the *same* silence (both reset by every frame while parked, fact 5), so the run ends with `AdapterIdleTimeoutError` instead of ending silently **iff `idleTimeoutMs` < the effective grace**. Default grace is 15 s (fact 7) and grace is tunable upward without limit (fact 9), so this is not an exotic misconfiguration.

- **B1 — add a sixth member to the enumeration: a held `result` whose wake-up has not arrived (RECOMMENDED).** The park becomes outstanding work; the idle clock never advances there; grace stays the sole authority over that stretch and keeps its silence. It satisfies the model's own admission test without amendment — "Outstanding work is not unbounded work … bounded by *that work's own cap*" — because the park is bounded by grace and by the hold cap (facts 7, 8). It also lets M17 finally carry the house sentence (fact 10). Cost: "outstanding" now covers a state where nothing is known to be *running*; the wake-up may never come. The model already answers this — the bound is what makes it admissible, not the certainty of completion.
- **B2 — ordering constraint instead: require `idleTimeoutMs` > effective grace.** Keeps the enumeration closed and mirrors the precedent of fact 11 exactly. Rejected as the primary fix: it makes an adapter-agnostic primitive's correctness depend on an adapter-prefixed key (`claude_backgroundGraceMs`), pushes a coupling onto every consumer who sets both, and fact 9 means the adapter cannot validate it once and be done. Worth adopting as a **secondary** note under B1 only if the owner also wants the cap/grace pair documented as "raise together".
- **B3 — clock precedence: the idle clock is suspended while M17's hold is armed.** Same runtime effect as B1, expressed as a rule between clocks rather than as enumeration membership. Keeps "outstanding" meaning *work*. Cost: it adds a second, differently-shaped mechanism for suspending the idle clock, and the four-clocks paragraph would then have to explain both — the enumeration is no longer the whole contract, which is what makes the enumeration worth having.

**Recommendation: B1.**

<!-- anchor: zkofkchr -->
## Blocking decision C — is the enumeration's closure itself the defect?

Gap 1 is an instance, not an accident: the enumeration is closed, and M17 demonstrably held an outstanding-work state M01 did not know about. Ask whether the next one is prevented or merely awaited.

- **C1 — keep the list closed, add the admission test that decides membership (RECOMMENDED).** The list stays normative and exhaustive; what is added is the *criterion* it was already applying silently — a state qualifies iff silence in it is expected **and** it is bounded by its own cap owned by a named module — plus the obligation, already practised by M06 and M13 (fact 10), that the owning module states the idle clock's non-role at its own address. A new state remains a contract change to M01; it just stops being a discovery.
- **C2 — keep it closed, change nothing structural.** Defensible: closure is the contract's value, and two entries in one release is a small sample. Cost: the next module with a hold repeats this exact review.
- **C3 — open the enumeration to an adapter-declared extension point.** Rejected: an enumeration a consumer cannot read off the contract is not a contract, and it re-creates fact 4's "list that is never complete".

**Recommendation: C1** — it is two sentences inside the edit entry 2 already makes, so its marginal cost is near zero and it makes B1's addition a derivation rather than a patch.

---

<!-- anchor: w2j9a1m1 -->
## Entries

Execute in order. Entries 2–5 are written against **A1 + B1 + C1**; the deltas under the alternatives are noted per entry.

<!-- anchor: d5mdlz1v -->
### Entry 1 — record the outcome of A, B and C

No spec edit. The owner's answers are the input to every entry below; entries 2–5 must not be started before they exist. If any of the three is deferred rather than answered, its question moves verbatim into `<index>`'s `Open questions` (plan.md Step 4, "Not yet decided") and the dependent entries stop.

<!-- anchor: zze3vvnh -->
### Entry 2 — M01: state the re-arm rule, the admission test, and the sixth member

- **Address:** `spec/modules/M01-unified-core.md` `8do90d06`, the `RuntimeExecuteParams.idleTimeoutMs?: number` bullet and the nested four-clocks sub-bullet. Edit in place with `update_sections`; the anchor is unchanged.
- **Layer / schema:** L1 — Unified Contract, `layers/L1-unified-contract.md` `yc5ftl18`, M01's slot as **implementor**, read in how-mode. Schema fields answered: the **param shape** (`RuntimeExecuteParams`) and the **invariants that hold across all adapters**. Rule 2, filling-vs-behavior test → framework runtime behavior → the implementor module's layer section, not the layer file. Rule 3 — the section already exists; no new layer section, no roll-up.
- **Changes, four of them, in one bullet:**
  1. **The re-arm rule** (A1): state that the clock measures continuous silence toward the consumer — reset by any `UnifiedEvent` the run yields — and that outstanding work suspends it outright. Two mechanisms, named apart, because they answer different questions: *does the clock run at all* and *when did it last start counting*.
  2. **Rewrite the rejection sentence** (fact 4) so it names what was rejected: last-sign-of-life **as the whole rule**, unguarded by the outstanding-work state. Keep the consumer regressions as its evidence. Without this the bullet contradicts itself on the page.
  3. **The admission test** (C1): one sentence giving the criterion the enumeration applies — silence expected, and bounded by that state's own cap owned by a named module — and one stating the owning module's obligation to carry the sentence at its own address (M06 `4b8iv50p` and M13 `1vd9sye5` cited as the existing instances).
  4. **The sixth member** (B1): "a held `result` whose wake-up has not yet arrived (M17 — `q9u5sbot`)", placed after the background-task member it continues, and phrased so the boundary with it is visible — the task settling does not end the outstanding state, it changes which bound holds it.
- **Also in this section:** the four-clocks sub-bullet must be brought into line — it currently spells out the grace window's reset and not the idle clock's while claiming all four differ (fact 3). Give the idle clock its now-stated reset and keep the contrast with the backstop's never-re-armed arming intact.
- **Do not touch:** the `timeoutMs` bullet's substance. Fact 2's sentence ("The clock that does re-arm is `idleTimeoutMs` below") becomes true once change 1 lands and needs no edit.
- **Under A2:** changes 1 and 2 are dropped and replaced by a "turn in progress" member — see the argument against in decision A before taking this path. **Under B3:** change 4 is dropped and the precedence rule goes into the four-clocks sub-bullet instead. **Under C2:** change 3 is dropped.

<!-- anchor: ykuom7eb -->
### Entry 3 — M17: carry the house sentence

- **Address:** `spec/modules/M17-background-tasks.md` `q9u5sbot` (Edge cases), at the grace-window bullet that already names the wake-up as "the sole outstanding thing" (fact 5).
- **Placement:** module-owned edge case, situation → behaviour. Not a layer change — it is untrue once M17 is deleted (Rule 2, layer-purity). Not M13's: M13 owns the outcome alone (fact 14).
- **Change:** state that the idle clock does not advance across the park and cannot be what ends it, because the wake-up wait is outstanding work under M01 `8do90d06` — and that grace expiry therefore stays silent. Model the wording on M06 `4b8iv50p` ("That list of triggers is complete, and the idle clock is missing from it on purpose") and M13 `1vd9sye5` ("Those two and no other clock"), so the three read as one pattern. The existing termination-trigger sentence — "`abort()` / `timeoutMs` fires with work in flight → the run terminates per M13" — is the list this sentence completes.
- **Under B2:** this becomes the opposite sentence — the idle clock *does* advance, and the run is only correct while `idleTimeoutMs` exceeds the effective grace — and entry 4 becomes mandatory rather than conditional.

<!-- anchor: nffli9mg -->
### Entry 4 — M17 `52ymvppn`: lever documentation (CONDITIONAL — only under B2, or under B1 if the owner also takes B2's note)

- **Address:** `spec/modules/M17-background-tasks.md` `52ymvppn`, the hold-bound levers paragraph.
- **Change:** state the relation raising `claude_backgroundGraceMs` bears to a consumer's `idleTimeoutMs`, in the shape fact 11 already uses for the cap and the stream timeout ("raise both together"). Note fact 9 — invalid degrades to the default — as the reason the adapter cannot enforce the relation, only document it.
- **Skip entirely under B1 alone.** Under B1 the park is outstanding work and the relation does not exist.

<!-- anchor: 51bgebsk -->
### Entry 5 — acceptance criteria

`ac` entities, tagged to match the four the parent plan created (`m01`, `m01-edge`). Call `describe_entity_type("ac")` before the first write. One observable thing each; surfaced by M01 `a7kxmtyl`'s existing `<tagged_list type="ac" tags="m01"/>` embed, so no page edit is needed to show them.

1. **`m01` — the streaming turn.** A run emitting `text_delta`s continuously for longer than `idleTimeoutMs`, with no tool call outstanding, does not expire on the idle clock. *(Pins A1's reset; this is the regression gap 2 would ship.)*
2. **`m01` — the positive case.** A run that emits nothing for longer than `idleTimeoutMs` with nothing outstanding ends with `AdapterIdleTimeoutError`. *(All four existing criteria are negative; nothing currently pins that the clock fires at all, which is what makes A1's reset assertable rather than unfalsifiable.)*
3. **`m01-edge` — the park.** A run parked on M17's control-channel hold awaiting a wake-up does not expire on the idle clock, however low `idleTimeoutMs` is set relative to the grace window. *(Pins B1. Under B2 this criterion inverts and must instead pin the required ordering.)*
4. **`m01-edge` — the silence is preserved.** A run whose grace window expires while `idleTimeoutMs` is set below it still ends with a normal `result` and no error. *(The distinct observable: not "no idle error" but "the silent ending survives". Separate criterion because it can fail while 3 passes — an adapter could suspend the clock and still surface something.)*

<!-- anchor: 463rj6jg -->
### Entry 6 — review

Hand the saved change to `spec-review`: layer purity on entries 2–4 (nothing about the idle clock may land in `layers/L1-unified-contract.md`), Rule 3 (no roll-up of layers appearing in M01 or M17), Rule 9 (no "was previously enumerated as…" breadcrumbs when the enumeration grows). Then re-read M01 `8do90d06`, M06 `4b8iv50p`, M13 `1vd9sye5` and M17 `q9u5sbot` **together** and confirm the four now state one model — the house pattern of fact 10 is only worth anything if all four read alike.

<!-- anchor: 16fcnfo1 -->
## Consequences attached by the rules

- **No `<index>` row** — no module is created, renamed or retired.
- **No dependency record** — Rule 3a. The M01↔M17 relation already exists and is unchanged in direction; and the `module-dependency` entity type is **inactive in this project** (see Seen, not planned), so both modules carry prose dependency tables instead.
- **No M12 semver entry** — fact 13: `idleTimeoutMs` is not in `src/`, so there is no released behaviour to change and no migration to write.
- **No M13 change** — fact 14: M13 owns the outcome, and neither fix changes the error's identity, phase or terminality. This holds under B1, B3 and C1. **Under B2 it does not**: a validation or degradation outcome for an `idleTimeoutMs` set below the grace would need a home, and M13 would be it.
- **No M09 change** — `diq2em77` governs consumer-side helpers, and the four-clocks paragraph already places `collectEvents()`'s own default outside the adapter-side set.

<!-- anchor: ysubfnai -->
## Seen, not planned

- **`modules/M17-background-tasks.md` `q9u5sbot` / `52ymvppn` and A01 `sw3cwrsm` — incomplete sentences about the set of clocks.** Named as the scope of a parallel child; untouched here, though entries 3 and 4 land in two of those sections and should be sequenced against that child to avoid a conflicting write.
- **The five standing reviewer defects from the parent plan.** Out of scope by instruction; not re-examined.
- **A01 `sw3cwrsm` states no numeric defaults for the hold levers.** M17 `52ymvppn` says the defaults are "sized off measurements of one engine at one version" and points at A01; the actual 15 s / 90 s (fact 7, 8) live only in `src/`, so the specification never names the number a consumer is asked to tune. Adjacent to this plan's subject — decision B turns on that number — but not this intent.
- **`module-dependency` is an inactive entity type in this project.** Both readers hit `INACTIVE_TYPE`, so Rule 3a's records do not exist here and cross-module edges live in prose tables (M01 `y7fp8wwg`, M17 `8qbvk9c5`). A style-conformance question for the corpus, not for this change.
- **M01 `8do90d06` is a single bullet list carrying the whole L1 contract.** The `idleTimeoutMs` bullet is now the longest thing in it and its four-clocks sub-bullet is doing a section's work. A split is worth considering the next time this section is opened; folding it into this change would bury the two fixes under a reorganisation.
