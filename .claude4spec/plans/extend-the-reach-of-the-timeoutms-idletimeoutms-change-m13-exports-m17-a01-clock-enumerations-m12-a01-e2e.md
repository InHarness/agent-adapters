---
type: plan
title: >-
  Extend the reach of the timeoutMs/idleTimeoutMs change (M13 exports, M17+A01
  clock enumerations, M12/A01 e2e)
created_at: '2026-09-22T13:37:40.235Z'
created_by: agent
applied: false
---
# Extend the reach of the `timeoutMs` / `idleTimeoutMs` change

<!-- anchor: f801zhmv -->
## Intent

The change that added `timeoutMs` and `idleTimeoutMs` to `RuntimeExecuteParams` (M01 — `8do90d06`) and `AdapterIdleTimeoutError` (M13 — `8q9q7ty7`) took the specification from **three** run-bounding constraints to **four**. The closing pass licensed only the removal of redundancy, so nothing that merely *understated* the new set was touched.

This plan repairs the understatements — sentences and lists that were true at three clocks and are incomplete at four — and nothing else. It adjudicates six reports; four are repairs, two of those were reported as one item, and four reports are rejected with reasons.

**Nothing here touches M01 `8do90d06`.** Two standing plans contend for that section (`close-two-holes-in-the-idletimeoutms-outstanding-work-model-m01-l1-m17.md`, `adjudicate-five-standing-deviations-from-the-timeoutms-idletimeoutms-change-m01-m13-m17.md`); every entry below is downstream of it and consumes it by `section_ref` rather than restating it.

---

<!-- anchor: 2nwvl6b0 -->
## Entries

Execution order is provider-before-consumer: M13 is self-contained, the M17/A01 clock sentences are independent, and the M12 scenario catalog must carry the scenario name before A01 can record coverage of it.

<!-- anchor: g7f4gcpi -->
### 1. M13 — the export list names six of seven classes

- **Address:** `modules/M13-errors-resilience.md` — `9dv305bn` (`## Public API & Packaging (L4)`).
- **What is wrong:** the section reads *"Exports `AdapterError`, `AdapterInitError`, `AdapterTimeoutError`, `AdapterAbortError`, `AdapterBackgroundHoldExpiredError`, `AdapterToolPolicyError` from the package root"* — six classes. `8q9q7ty7`, on the same page, already declares `AdapterIdleTimeoutError` a member of the hierarchy. The list is **hand-written prose, not an embed**, so it does not heal itself.
- **Why it is decisive:** the section argues its own case — *"A typed error a consumer is expected to branch on is useless if it cannot be named in a `catch` or an `instanceof` — so **every class in the hierarchy is exported**, not only the base."* The sentence states a rule its own list now violates. An idle expiry is precisely the failure a consumer must branch on separately from the backstop, which is the entire reason the class was typed apart.
- **Change:** insert `AdapterIdleTimeoutError` into the enumeration, in hierarchy order (after `AdapterTimeoutError`, matching `8q9q7ty7`). The justifying sentence stays verbatim.
- **Schema field answered (L4, `hwhgr8bv`, capability-module consumer):** *"naming the symbols it exports"*. Subpath and peer-dependency are unchanged — the class ships from the package root like its siblings.
- **Entity operations:** none.

<!-- anchor: e62glja3 -->
### 2. M13 — `## Purpose` names four of six subclasses

- **Address:** `modules/M13-errors-resilience.md` — `1c0ve8zr` (`## Purpose`).
- **What is wrong:** *"M13 owns the `AdapterError` hierarchy (`AdapterInitError`, `AdapterTimeoutError`, `AdapterAbortError`, `AdapterBackgroundHoldExpiredError`)…"* — a third enumeration of the same hierarchy on the same page, and the shortest. It is missing `AdapterIdleTimeoutError` (this change's reach) **and** `AdapterToolPolicyError` (pre-existing drift from an earlier change).
- **Change:** bring the parenthetical to the full six, matching `8q9q7ty7`. The `AdapterToolPolicyError` omission is swept in the same edit — repairing one name in a six-name list while leaving the other gap is not a defensible stopping point, and the two are one sentence apart.
- **Note for the executor:** after entries 1 and 2 the page carries the hierarchy three times (`1c0ve8zr`, `8q9q7ty7`, `9dv305bn`), which is what let it drift twice. Consolidating those three into one list with two pointers is a real improvement and is **not** in this plan's scope — it is a structural change to a section the adjudication plan may also touch.
- **Entity operations:** none.

<!-- anchor: zfv0w62m -->
### 3. M17 — the cap-release clause understates what bounds a continuation turn

- **Address:** `modules/M17-background-tasks.md` — `q9u5sbot` (`## Edge cases`), the *"Work that never settles"* bullet, its **cap** sub-bullet.
- **Current text:** *"a hard **cap** on the parked stretch, for work that is still running and may never finish. Released the moment a continuation turn begins, because from there the run is an ordinary live turn again and is bounded by `timeoutMs` / `abort()` (M13) **like any other**."*
- **Why it is an undercount:** the clause justifies releasing the cap by asserting that what follows is bounded *like any other live turn* — and then enumerates two of the three things that bound one. A continuation turn is an ordinary turn precisely in the sense that it reaches moments with nothing outstanding (plain generation, the gap between tool calls); M01 `8do90d06` is explicit that *"a pause with nothing outstanding is idleness however short it is"*. So `idleTimeoutMs` **does** advance there and belongs in the set. The words "like any other" are what make the omission a claim rather than a partial list.
- **Change:** name the third clock and keep the attribution structure the module already uses — the outcome stays M13's, the clock's model stays M01's by pointer, e.g. *"…bounded like any other live turn: by `timeoutMs` and by `abort()`, and — once nothing is outstanding — by `idleTimeoutMs` (M13 for the classes; the outstanding-work model is M01's, `8do90d06`)."* Exact wording is the executor's; the requirements are (a) three clocks, (b) the idle one conditioned on nothing outstanding, (c) no restatement of what counts as outstanding — that lives once, in `8do90d06`.
- **Rule:** one home for every piece of content (rule 2). M17 states the *outcome* and points at M01 for the *model*; this is already the shape of M17's `8qbvk9c5` dependency row, which names `idleTimeoutMs` correctly today and is the in-module precedent to copy.
- **Entity operations:** see entry 4 — the same claim exists as a criterion.

<!-- anchor: kq3ki48q -->
### 4. AC `ac-a-held-run-that-the-engine-resumes-is-nev` — the same undercount, in entity form

- **Address:** entity `ac` / `ac-a-held-run-that-the-engine-resumes-is-nev`, tags `m17`, `m17-edge`, surfaced on `modules/M17-background-tasks.md` — `02okhxqj`.
- **Current title, closing clause:** *"…and a live turn is **bounded only by timeoutMs / abort()**."* The word *only* makes this a false universal, not a partial list, and it is checkable text: a criterion states one observable thing, and this one now states something untrue about the clock set as a by-the-way justification.
- **Change:** `update_entities` on the `title`, replacing that clause with one that does not enumerate at all — the criterion's observable is *"a continuation turn that stays busy past the hard cap runs to its own result with every event delivered"*, and the reason only needs to say the hold's bounds are released, not to re-list the run's clocks. Suggested: *"…because the bounds are released once the main model is producing again and the run is bounded from there like any other live turn."*
- **Why not simply add the third clock:** an AC states one observable thing. Enumerating the clock set inside a criterion about hold-release duplicates `8do90d06` in a place nothing keeps in sync — which is how this criterion came to be wrong. Removing the enumeration is the repair that does not recur.
- **Consequence:** the slug is derived from the old title and is immutable on update; it will no longer echo the text. That is expected — the slug is an identifier, and every reference to it stays valid.

<!-- anchor: ug8x6ry6 -->
### 5. A01 — the adapter-side copy of the same sentence

- **Address:** `adapters/A01-claude-code.md` — `sw3cwrsm` (`## Per-capability consumption`), the *"The hold is bounded…"* bullet.
- **Current text:** *"…an absolute **cap** on the parked stretch, released the instant a continuation turn's first main-model frame arrives, because from there the run is an ordinary live turn bounded by `timeoutMs` / `abort()` (M13)."*
- **Change:** the same repair as entry 3, in the adapter's register. Keep it to a clause — A01 carries the mechanics, M17 carries the rule, and neither re-states `8do90d06`.
- **Do together with entry 3.** These two sentences are a deliberate pair (M17 states the bound, A01 records the measurement); repairing one and not the other reproduces the split this plan exists to close.

<!-- anchor: xmlfnqs0 -->
### 6. M12 — the e2e scenario catalog has no `error/resilience` entry

- **Address:** `modules/M12-conformance-release.md` — `xe2ecat1` (`## e2e scenario catalog (L5)`), the `| Scenario | What it proves (real-model) |` table.
- **What licenses this:** M12's own contract-extension checklist, `agvf1tok` — *"adding an event/field requires: … add a per-adapter e2e case — and, if it introduces a new real-model scenario, add it to the scenario catalog, record it in each covering adapter's e2e coverage list, and add its AC entity."* `idleTimeoutMs` is a new field on `RuntimeExecuteParams`, and a clock that must **not** fire while work is outstanding is a real-model scenario nothing else in the catalog proves. The checklist fires; this entry and the next two are it being run.
- **Change:** add one row, `error/resilience`, covering the concern rather than one lever — the catalog names scenarios, and A01 already parenthesises the lever in its own coverage rows. Its *what it proves* must carry both directions: that `timeoutMs` ends a run at its budget with `AdapterTimeoutError`; that an idle run with nothing outstanding ends with `AdapterIdleTimeoutError`; and that neither clock cuts short a run whose work is genuinely outstanding.
- **Side effect, deliberate:** A01 has carried an `error/resilience (timeoutMs)` coverage row against a catalog entry that never existed. This row closes that dangle as well as opening the idle one.
- **Schema field answered (L5, `9xedv63z`, implementor):** *"the **canonical scenario catalog** (the named real-model scenarios every suite draws from), documented in how-mode."* Coverage stays out of M12 — `xe2ecat1` says so itself (*"not a matrix here"*).
- **Entity operations:** none.

<!-- anchor: la294tau -->
### 7. A01 — record the idle leg as coverage this suite does not yet have

- **Address:** `adapters/A01-claude-code.md` — `a01e2ecv` (`## e2e coverage (L5)`).
- **The existing row is not wrong.** `| error/resilience (`timeoutMs`) | M13 | ✅ covered |` names its lever in the scenario cell, so it claims coverage of the backstop and of nothing else. Report 4 read it as overclaiming; it does not. What is missing is a **row**, not a corrected marker — leave `✅ covered` alone.
- **Change:** add `| error/resilience (`idleTimeoutMs` — no expiry while work is outstanding) | M01 | ◻ planned |`. Owning module is **M01**, not M13: what the scenario proves is the outstanding-work model, whose type home is M01's; M13 owns only the class that fires when the clock does. `◻ planned` is the honest marker — no such test exists, and the two criteria it would prove are exactly the kind provable only by a live run.
- **Schema field answered (L5, `9xedv63z`, adapter consumer):** *"which real-model scenarios that suite exercises **is** per-adapter content — it lives in the adapter file."* This is why the row goes here and not in M12.
- **Depends on entry 6** — the row draws on a catalog scenario, so the catalog names it first.

<!-- anchor: lb5dn07r -->
### 8. The e2e criterion for that row

- **Entity operation:** `create_entities`, type `ac`, one record. Pattern to copy: `ac-claude-code-e2e-timeout-scenario` (kind `edge-case`, tags `m13`/`m13-edge`, `verifies` pointing at the capability criteria it proves) — this is the shape A01 `a01e2ecv` names in its closing sentence, *"shared-capability ones under the owning module's `mNN` tag with `verifies` pointing at the capability."*
- **Proposed record:** title along the lines of *"The claude-code e2e idle-timeout scenario runs a live turn with a tool call left unanswered and with a `user_input_request` left unanswered, and neither expires on `idleTimeoutMs`."* — kind `edge-case`, tags `m01`, `m01-edge`, `verifies` → `ac-a-run-whose-only-activity-is-a-single` and `ac-a-run-parked-on-an-unanswered-user-in`.
- **Drop this entry if the user prefers.** The checklist in `agvf1tok` asks for the AC entity, but the row lands as `◻ planned` and the two capability criteria already exist; authoring the suite's criterion before the suite is a defensible thing to defer. Entries 6 and 7 stand without it; it does not stand without them.

---

<!-- anchor: 4a2di8wy -->
## Rejected, with reasons

**M17 `52ymvppn` — correct as written.** The parallel finding was verified against the section, not taken on trust. The sentence is *"A run with **in-flight background work** is still bounded by M13's `timeoutMs` / `abort()`"*, and it is a **Stop lever** paragraph: it is scoped by its own opening clause to the state in which background work is outstanding, and it never generalises to "any other live turn" the way `q9u5sbot` does. In that state `idleTimeoutMs` by definition does not advance, so listing it among the levers that stop such a run would be wrong, not more complete. M17's own `8qbvk9c5` row says exactly this. Corroborating precedent: M06 `4b8iv50p` and M13 `1vd9sye5` both carry three-clock lists that state their exclusion of the idle clock on purpose — scoped lists are a house form here, not stale ones.

**The `(M13)` / "M13's" attributions — correct in the sense they are used.** M17 refers to M13 four times around the clocks: *"(M13)"*, *"M13's `timeoutMs` / `abort()`"*, *"terminates per M13"*, *"ends it with M13's classes"*. A01 heads a whole bullet *"Abort / timeout (M13)"*. The possessive in `52ymvppn` governs **`timeoutMs` / `abort()` together** — and `abort()` is not a field of anyone's, least of all M13's — so the phrase cannot be read as a claim about type home; it names the concern and its outcome, which is M13's. M13 itself never claims the field (it disclaims it explicitly for `idleTimeoutMs`, pointing at `8do90d06`), and M01 says *"Type home is here."* Nothing is misattributed; a redirect pass would rewrite idiom. Entry 3 rewrites one of these sentences for a different reason and takes the opportunity to make the reference precise there; that is a by-product, not a policy.

**M01 `u39gu699` prose need not grow.** This was reported as the prose failing to match the criteria set, and the house style was measured rather than assumed, across all eighteen modules: **no module mirrors**. M17 has 11 prose situations against 3 edge criteria; M06 has 12 against 5; M15 has 12 against 5; M18, the closest of all, has 11 against 8. The criteria are consistently a curated subset, and in M01, M02, M04, M06, M15 and M18 individual edge criteria demonstrably ground themselves in prose **outside** `## Edge cases` — M02's in `0ebwiey1`, M18's in `1yllld10`. M01's three new clock criteria do exactly that: they ground in `8do90d06`, at length. The `## Edge cases` prose is never a `tagged_list` and never a register of the criteria set; it is a narrower narrative surface. Adding clock bullets to `u39gu699` would restate `8do90d06` in a second place on the same page — the one-home rule (2) forbids it, and the criteria are already at home. M01's mapping was partial before this change too: one of its two pre-existing edge criteria has no prose bullet, and one prose bullet has no criterion.

**M11 `fr2hhuye` is not this plan's problem — and it is not an undercount at all.** The change **did** reach it: the section now reads *"**The run's clocks are armed per `execute()` call, not per turn.** However many turns a streaming session delivers, one backstop and one idle clock span the whole of it… what arms them, what stops them and what each expiry costs are M01's (`8do90d06`)."* M11 states the arming unit and hands off correctly; there is nothing incomplete in it to repair. The concern underneath is real and is worse than reported: M01's outstanding-work enumeration has exactly five members — an unmatched `tool_use`, an open subagent, an unsettled background task, an unanswered `user_input_request`, a nested consumer-started turn — and a streaming session waiting for the consumer's next push is **none of them**, while `8do90d06` states as negative scope that *"a pause with nothing outstanding is idleness however short it is."* By the letter of the rule the idle clock advances through a healthy inter-push gap and kills a parked streaming session. That the same section carves the gap out explicitly for the **backstop** (*"runs through the idle gaps between pushes"*) and not for the idle clock shows the case was in view and the enumeration simply does not cover it. **That is a hole in the outstanding-work model, not a question of this change's reach**, it is repaired only by amending the enumeration in `8do90d06`, and the enumeration belongs to `close-two-holes-in-the-idletimeoutms-outstanding-work-model-m01-l1-m17.md`. Recorded here as a finding and a **dependency**: if that plan adds a sixth member, nothing in this plan changes; if it instead decides the gap is genuine idleness, M11 `fr2hhuye` will owe a sentence saying so, and that sentence is that plan's to place.

---

<!-- anchor: h00tphfc -->
## Seen, not planned

- **`adapters/A01-claude-code.md` `677rc2wh`, `A02` `26dlg7ut`, `A03` `d9ugsejh`, `A04` `99avio4b`** — every adapter's `## Edge cases` maps `timeoutMs` → `AdapterTimeoutError` and `abort()` → `AdapterAbortError` and says nothing about the idle clock, though M13's dependency row makes mapping SDK failures onto the hierarchy each adapter's job and M01 states all four clocks are adapter-side. Extending the clock to four adapters is implementation reach and needs per-SDK judgement; it is not an enumeration made stale.
- **`ac-for-claude-code-timeoutms-yields-adapte`, `ac-for-codex-plan-mode-forces-sandbox-read`, `ac-for-opencode-a-resumesessionid-not-foun`** — the entity twins of those four lines. A04 has no twin at all, which is a quieter pre-existing gap.
- **`modules/M13-errors-resilience.md` `br8rzz4u`** — M13's dependency table has no M01 row, though `8q9q7ty7` and `1vd9sye5` both point at `8do90d06`. A missing dependency record, pre-existing, and the `module-dependency` type is inactive in this project so it cannot be checked from here.
- **`ac-a-held-run-that-the-engine-resumes-is-nev`** carries `kind: requirement` under an `m17-edge` tag. Noticed while editing its title in entry 4; left alone.
- **The `## Purpose` / `## Cel` heading variance, layer files naming modules, and dependency tables where records belong** — corpus-wide style matters, explicitly out of scope.

<!-- anchor: wag26f4d -->
## Not investigated

- Whether the four adapters *can* implement an outstanding-work-aware idle clock on their SDKs — no adapter source was read, and the specification does not answer it.
- The `module-dependency` graph in either direction: the type is inactive in this project, so every dependency statement above rests on the prose tables alone.
- `index.md` beyond the scout's sweep — it names single error classes but enumerates neither the hierarchy nor the clocks, so it carries no undercount.
