---
type: plan
title: '0.9.12 follow-ups — contradictions, AC visibility, inherited drift'
created_at: '2026-09-22T15:51:43.254Z'
created_by: agent
applied: false
---
# 0.9.12 follow-ups — contradictions, AC visibility, inherited drift

Follow-up plan for what release **0.9.12** (plan `sendmessage-amp-listagents-subagent-re-entry-delegation-gating-peer-messaging-boundary`, E1–E28) left behind. Every item below was re-verified against the live pages; the reported items that did not survive verification are listed in **§7 Rejected**, which is part of the result.

**Method note.** The applied plan is not attached to this thread, so `get_plan` returns `null` and its §6 "Seen, not planned" could not be read directly. Its content was reconstructed from the 0.9.12 release description and re-verified page by page. Where a reported address turned out to be wrong, the corrected address is given.

**Intent.** 0.9.12 landed a large, genuinely good change. It also (a) asserted as present-tense fact three things that are not true at this pin, (b) tagged four new criteria in a way that makes them render nowhere, and (c) surfaced older drift. Rounds 1–3 are independent of each other and can be executed by separate threads; Round 4 must be answered by the user before anything in it moves; Round 5 is code, not spec.

---

<!-- anchor: xl2e3412 -->
## Execution order and blocking

| Round | Scope | Blocked by |
| --- | --- | --- |
| **R1** | Contradictions introduced by 0.9.12 | — (do first) |
| **R2** | Acceptance criteria that render nowhere | R2.3 blocked by **D3**; R2.2-A04 blocked by **R1.1** |
| **R3** | Inherited drift, revealed in passing | — (independent of R1/R2) |
| **R4** | Decisions for the user | — (answer before executing) |
| **R5** | Code, not spec | C3 blocked by **R1.1** |

R1 first for one reason: R2's prose and R5's C3 both describe the delegation posture, and until R1.1 settles what that posture *is* at this pin, both would be written against a statement the spec itself contradicts.

---

<!-- anchor: s4ckk92e -->
## R1 — Contradictions introduced by 0.9.12

<!-- anchor: 2ssu85b8 -->
### R1.1 — Gemini `delegation` is claimed as gated and is not

**Addresses:** `adapters/A04-gemini.md#s7prl2pn` (L2) · `adapters/A04-gemini.md#oirynpg7` (Per-capability consumption) · `modules/M18-tool-gating.md#1yllld10` (M18 L2 matrix + escape surfaces)

**What is today.** `#s7prl2pn` states, present tense: *"`toolGating: true` for all five groups, `delegation` included, at `soft` strength: exclusion happens in the tool registry, so a denied tool is never registered and never reaches the model"*. `#oirynpg7` on the same page states that the `delegation` group's members here — `codebase_investigator`, `cli_help`, `generalist`, `confucius` — are *"named by no group in the adapter's mapping today"*, and calls this *"a **live defect**, not an unfilled cell"*. Verified in code: `GEMINI_TOOL_GROUPS` (`src/adapters/gemini.ts:210`) defines only `shell`/`file-read`/`file-write`/`web`, and none of the four names appears anywhere under `src/`.

M18's matrix row for gemini reads `| **gemini (A04)** | ✅ | soft ⚠ | soft | soft | soft | soft | …` — the `delegation` cell is a plain `soft`, with no `⚠`. The escape-surface list below it has a bullet **A04 `shell`** and **no** mirrored **A04 `delegation`** bullet.

**What it should be.** Denying `delegation` on gemini today excludes nothing, so `soft` overstates it. Three coordinated edits:

1. `#s7prl2pn` — stop asserting the five-group claim as fact. State that `delegation`'s members are unmapped at this pin and point at `#oirynpg7` for the defect.
2. `#1yllld10` — the A04/`delegation` cell becomes `none ⚠` (recommended) or at minimum `soft ⚠`; add the mirrored escape-surface bullet **A04 `delegation`**.
3. The same section's own rule decides the marker: *"Every known way a denied group can still be reached is listed below… **A group with a known escape surface is never reported `hard`.**"* A documented live laundering route is exactly such a surface.

**Why.** This is the sharpest contradiction 0.9.12 introduced: one page asserts the gate works, the same page calls its absence a live defect, and a third page's matrix reports the clean value. A consumer reading the matrix to decide whether to dispatch gets the wrong answer.

**Entity consequence.** `ac-denying-delegation-on-gemini-excludes` ("Denying delegation on gemini excludes the subagent tool names, so a denied read cannot be laundered through a spawned agent", tags `a04`, `m18`, kind `requirement`) asserts behaviour that does not happen. The corpus already has a convention for this: `ac-claude-code-e2e-sdk-version-gate` ends *"Intended behavior; the version gate is not yet implemented in code."* Follow that precedent rather than deleting the criterion.

**Decision embedded here (small, recommend deciding inline):** `none ⚠` vs `soft ⚠` for the cell. Recommendation: **`none ⚠`** — `soft` in this matrix means "the tool is removed from the model's catalog", which is precisely what does not happen for these four names.

<!-- anchor: diyxhjcw -->
### R1.2 — M12 carries neither semver classification that 0.9.12 promised it

**Address:** `modules/M12-conformance-release.md#agvf1tok` (Public API & Packaging (L4))

**What is today.** `#agvf1tok` classifies: the generic additive/removal rule, the behavioral-hardening rule (worked case: M15 path-scope), and a worked case *"M18 tool gating is a major"* covering the `allowedTools` → `autoApproveTools` rename and the plan-mode hardening. It says nothing about either of the two things 0.9.12 pointed at it.

Two pointers dangle:

- `modules/M18-tool-gating.md#4j6f86yq` — the `delegation` group definition ends: *"Semver: widening a normative union type is **minor** for producers, but consumers exhaustively switching on `ToolGroup` break, so M12 classifies it."*
- `adapters/A01-claude-code.md#sw3cwrsm` — *"**Semver — this narrows, it does not add.** The gate removes something a run could previously do, so it is not an additive change… and M12 carries the release classification."*

**Address correction.** The reported item placed the `canUseTool` note in M18. It is not there — `canUseTool` does not occur in M18 or M12 at all. It is in A01 at `#sw3cwrsm`. The gap is real; the source address was wrong.

**What it should be.** Two new classification entries in `#agvf1tok`:

1. **`ToolGroup` union widening** — minor for producers, breaking for consumers exhaustively switching; state which side the release takes.
2. **Security-default narrowing** — the `crossSessionInbound: 'refuse'` pin and the outbound `canUseTool` predicate confining `SendMessage`. A01 explicitly calls this a **narrowing, not an addition**, so it does not fit the existing additive-minor rule and does not obviously fit behavioral-hardening-minor either, because a capability is removed rather than tightened.

**Why.** Rule "one fact, one home": M18 and A01 both delegate the classification to M12, and M12 does not have it. Two pointers into an empty slot.

<!-- anchor: st451di6 -->
### R1.3 — L5's scenario vocabulary does not know `sdk-surface-probe`

**Address:** `layers/L5-testing-conformance.md#ye2ecov1`

**What is today.** A parenthetical enumeration: *"The named behaviors a suite can exercise (simple text, thinking, tool/MCP, subagents, plan mode, path-scope, tool-gating, resume, todo, user-input, image, mid-turn, background-tasks, abort, unknown-model, usage) are a cross-cutting vocabulary…"* — `sdk-surface-probe` is absent. The authoritative catalog is `modules/M12-conformance-release.md#xe2ecat1`, which does carry it.

**What it should be.** **De-enumerate the parenthetical** rather than adding the name to it.

**Why, and why not the reported fix.** The report suggested replacing the list with a cross-reference. That would make it worse: L5 is a layer file, and rule 2a forbids `section_ref` anywhere in one. De-enumerating removes the whole drift class at its source — the sentence's point is that the vocabulary is cross-cutting and owned elsewhere, which it can make without listing sixteen names that must be maintained in two places. M12's own contract-extension checklist (`#agvf1tok`) requires a new scenario to be added to the catalog and to each adapter's coverage list; it does **not** require updating this list, which is exactly why this list drifted.

---

<!-- anchor: nue0q33b -->
## R2 — Acceptance criteria that render nowhere

<!-- anchor: xw3jnbrc -->
### R2.1 — Four criteria from 0.9.12 carry no parent tag (the actual defect)

**Addresses:** entities only — no page edit required.

**What is today.** Measured, not inferred:

| Tag | records | also carry parent tag | invisible |
| --- | --- | --- | --- |
| `m06-edge` | 8 | 5 | **3** |
| `a01-edge` | 6 | 5 | **1** |

The four that render nowhere, all created by 0.9.12, all tagged **only** with the `-edge` tag:

- `ac-a-run-terminated-between-a-subagent-s` — tags `["m06-edge"]`
- `ac-an-agent-team-teammate-emits-no-subag` — tags `["m06-edge"]`
- `ac-a-cross-session-peer-emits-no-subagen` — tags `["m06-edge"]`
- `ac-an-inbound-turn-from-another-local-se` — tags `["a01-edge"]`

Every pre-existing sibling carries **both** tags, e.g. `ac-no-subagent-started-is-ever-closed-by` → `["m06","m06-edge"]`. `modules/M06-subagents.md#o0e0wak5` embeds `<tagged_list type="ac" tags="m06"/>` and `adapters/A01-claude-code.md#e3az4o5i` embeds `<tagged_list type="ac" tags="a01"/>` — neither names an `-edge` tag, so a record without the parent tag is surfaced by nothing.

**What it should be.** `tag_entity` the four with `m06` / `a01` respectively. Four retags, no page edits, immediately visible.

**Why.** The root cause is a **tagging** omission, not a missing embed. 0.9.12 applied M17/M18's two-embed tagging convention on pages that use the single-embed convention. See **D3** for the standing inconsistency this exposes — but R2.1 is correct under either convention's eventual outcome and should not wait for it.

**Correction to the report.** The reported counts (8 invisible on M06, 6 on A01) are overstated: the correct figures are **3** and **1**.

<!-- anchor: qtqx8yyn -->
### R2.2 — The "why" prose beside the embeds does not name what 0.9.12 added

**Addresses:** `modules/M06-subagents.md#o0e0wak5` · `adapters/A01-claude-code.md#e3az4o5i` · `adapters/A04-gemini.md#7y3bfakm`

**What is today.**

- M06 `#o0e0wak5`: *"These verify lifecycle observability, that the optional `subagentTaskId` is always safe to read, and that a definition's context is derived from its parent…"* — re-entry, `resumed`, and `taskId` identity are named nowhere, though the release's headline contract correction is exactly that.
- A01 `#e3az4o5i`: *"These verify the reference mappings and the two capabilities unique to this adapter (subagent definition, mid-turn push)."* — names neither the cross-session boundary nor tool gating, though five new `a01` criteria cover them.
- A04 `#7y3bfakm`: *"These verify thought-summary replace semantics, threadId-synthesized subagent lifecycle, multi-transport MCP, the output-token estimate fallback, and the required-API-key init failure."* — does not name delegation.

**What it should be.** One clause added to each lead-in, naming the topic the new criteria cover.

**Blocked by R1.1** for the A04 edit only: the sentence must not claim delegation is gated if R1.1 concludes it is not.

**Why.** The lead-in is the only prose that tells a reader what the rendered list is *for*; a list whose framing predates a third of its contents mis-describes it.

<!-- anchor: 9vloa7f0 -->
### R2.3 — M01 and M17 render their edge criteria twice *(new finding, not in the report)*

**Addresses:** `modules/M01-unified-core.md#a7kxmtyl` · `modules/M17-background-tasks.md#02okhxqj`

**What is today.** Both sections embed the parent tag **and** the `-edge` tag, and their edge records carry both tags: `m01-edge` ∩ `m01` = 5 of 5; `m17-edge` ∩ `m17` = 3 of 3. So those 5 and 3 criteria render **twice** on their pages. M18 is the only page where the two-embed form is coherent: `m18-edge` ∩ `m18` = **0 of 10**.

**What it should be.** Settled by **D3**. Listed here so the decision is costed against the full picture rather than against M06/A01 alone.

---

<!-- anchor: lbwqjafv -->
### R2.4 — The abort-scenario criterion covers one of the two criteria it links

**Address:** entity `ac-the-claude-code-e2e-abort-scenario-ab`

**What is today.** Its `verifies[]` links **both** `ac-a-subagent-still-in-flight-when-abort`
and `ac-no-subagent-started-is-ever-closed-by`. `analyze_ac_against_entities` reports a
`missing-coverage` issue at **confidence 0.6**: *"The title only describes observing 'the
lifecycle pair close' (singular pairing), which maps to criterion (1) but does not
semantically cover the dedup/double-closure guarantee in criterion (2)."*

**What it should be.** Either widen the title to name the double-closure guarantee, or drop
the second `verifies[]` entry and let a separate scenario criterion carry it.

**Why.** The complaint is not a missing link — the link exists. It is that the criterion's
*title* promises less than its `verifies[]` claims to prove, so the coverage the field
asserts is not readable from the criterion itself.

**Reproduction caveat.** The finding is **non-deterministic**: it surfaces only under
`scope_tag: "m06"`, and not in a full-corpus run nor in a single-`ac_slug` run, both of
which return `issues: []` for this criterion. Verdict counts (12 analyzed / 227 `no_verifies`)
are stable; the `issues` set is not. Do not treat a clean run as refutation.

**Correction to this plan.** An earlier revision rejected this item in §7 as a "stale
finding", reasoning that the `verifies[]` link already existed. That reasoning was **wrong** —
it answered a different complaint than the one the analyzer makes. The item is live and is
planned here.
<!-- anchor: ox4ekgb7 -->
## R3 — Inherited drift, revealed in passing

Independent of R1 and R2; executable in any order among themselves.

<!-- anchor: il37pekt -->
### R3.1 — M17 edge-case list is split into two markdown lists

**Address:** `modules/M17-background-tasks.md#q9u5sbot`

**What is today.** A blank line in the raw markdown between *"…otherwise grace arms inside the re-entered cycle."* and the following `- \`shell\` denied under M18…` bullet, breaking one bullet run into two lists.

**What it should be.** Remove the blank line. Purely mechanical.

<!-- anchor: j8s9mk3m -->
### R3.2 — M17's dependency row on M06 points only at the module

**Address:** `modules/M17-background-tasks.md#8qbvk9c5`

**What is today.** The row reads: `| M06 | Sibling family: \`subagent_*\` is real subagents only; background shell work routes here instead. |` — no anchor. M17 now leans on the re-entry identity guarantee, which lives at `modules/M06-subagents.md#0f6287ae` (Unified Contract (L1)) and states *"`taskId` identifies the agent; `toolUseId` identifies the invocation"*, the `resumed?: boolean` marker and the ordering guarantee.

**What it should be.** Add a `<section_ref anchor="0f6287ae"/>` to the row and name the guarantee M17 depends on.

**Scope note.** Under rule 3a a module-to-module dependency is a **record**, not a table row — this whole section is a rule-3a symptom. That cannot be repaired today: see **D5**. R3.2 is the best available fix within the table form and does not conflict with a later migration.

<!-- anchor: irwflaa7 -->
### R3.3 — M18's Purpose section: over length, self-naming, and silent on the fifth group

**Address:** `modules/M18-tool-gating.md#f361hqgc` *(merges reported items 3 and 12)*

**What is today.** Measured body **1589** characters against the style's 1200-character `Cel` convention. Contains `M18` ×2 ("M18 owns the group vocabulary", "M18 fixes the group vocabulary"), `M15` ×2, `M04` ×1, and one `<section_ref anchor="0aj92zki"/>`.

**What it should be.** One rewrite handling all three: cut to the convention's length, drop the self-naming, and — while rewriting — let the motivating example admit delegation. It currently reads *"research this, but no shell and no filesystem"*, which frames the module as filesystem-and-shell only.

**Corrections to the report.** (a) The measured length is **1589**, not 1605. (b) The 1200 limit is a convention of the writing style, not a rule written anywhere in this spec — a corpus-wide grep for "1200" returns nothing. (c) The report's premise that *"the other four groups are named and `delegation` is not"* is **false**: of the five group tokens only `shell` appears in this section; `file-read`, `file-write`, `web` and `delegation` are all absent. So the fix is not "add the missing name" — it is a rewrite, which is why this is merged with the length item rather than filed as a one-word insertion.

<!-- anchor: 638gxh2m -->
### R3.4 — M06's Purpose names its own module

**Address:** `modules/M06-subagents.md#70dpqgcb`

**What is today.** Body is **1169** characters (31 below the 1200 convention, so any addition requires a prior cut — which is why this is filed before any future work on the section). `M06` ×2 in the opening paragraph, `M17` ×2 in the second.

**What it should be.** Remove the self-naming; the `M17` mentions are a legitimate cross-link under rule 9 but read as a boundary statement and can be tightened.

**Correction to the report.** The `M17` occurrences are in the **second** paragraph, not the opening one.

<!-- anchor: 12wanpkm -->
### R3.5 — M09's Purpose names its own module and its own layer

**Address:** `modules/M09-stream-consumption.md#s2qlzexy`

**What is today.** *"…without hand-writing `for await` loops and type guards. **M09** owns these consumption utilities. It reads the **L1** stream; it adds no new events."* — one self-module token, one own-layer token (`L1` is also the label of this module's own "Unified Contract (L1)" heading).

**What it should be.** Rephrase without naming itself.

---

<!-- anchor: ip8al60i -->
## R4 — Decisions for the user

Nothing in this round is executed until answered. Each carries a recommendation and a cost.

<!-- anchor: 0tbn357o -->
### D1 — Heading language for the whole corpus

**Finding (measured across all 29 pages in `modules/`, `adapters/`, `layers/`):**

- `## Purpose` (or `## Purpose & SDK identity`): **22 / 29**. `## Cel`: **0**.
- `## Dependencies`: **18 / 29** (all modules; no adapter, no layer). `## Zależności`: **0**.
- `## Domain`: **0 / 29** — no page in the corpus has one.

**Concrete harm, not aesthetics.** The writing style's own cross-cutting purpose sweep matches on `^## Cel$`. Against this corpus it returns **zero modules** — and the style documents this exact failure as silent: *"a module that names that section anything else drops out of the result silently — no error, no empty row."* The prescribed repair is to rename while **keeping the existing anchor**, so every address already handed out stays valid.

**Options.** (a) Rename to `## Cel` / `## Zależności` across 22 and 18 pages, anchors preserved. (b) Keep English and accept that the style's sweep protocol does not work here. (c) Rename `Cel` only (restores the sweep at a third of the cost).

**Recommendation:** **(c) then (a)** — `Cel` first, because it alone restores the broken protocol; `Zależności` is cosmetic by comparison. `## Domain` is a separate question: the style says a module with nothing of its own **omits** the section rather than stubbing it, so 0/29 is not automatically a defect and should not be bulk-added.

**Cost:** 22 + 18 section-heading rewrites, mechanical but touching nearly every page; a rename batch that drops an anchor is refused wholesale by `update_sections`, so the risk is low and visible.

<!-- anchor: uoyx6pk1 -->
### D2 — `verifies[]` across the `ac` corpus

**Finding.** **`ac` is the only active entity type in this project.** `describe_entity_type()` with no argument returns exactly one type; `module-dependency` is defined but **inactive**; `module`, `adapter`, `layer` are not types at all. Of **239** `ac` records, **12** have a non-empty `verifies[]` — all twelve are A01 claude-code e2e scenario criteria pointing at other `ac` records.

**Consequence.** The item as reported — "populate `verifies[]` so `analyze_ac_against_entities` stops skipping everything" — is **not achievable**, because there is no entity of any other type to verify against. `verifies[]` here can only ever link criterion→criterion, which is what the existing 12 do (an e2e scenario criterion naming the criteria it exercises).

**Options.** (a) Accept that `analyze_ac_against_entities` is largely inapplicable to this specification and stop reading `no_verifies` as a defect. (b) Adopt the existing 12-record pattern deliberately — scenario criteria link the criteria they prove — and populate only there; a bounded set, not 227 records. (c) Activate a second entity type, a project-configuration change outside spec authoring.

**Recommendation:** **(b)**, scoped to e2e scenario criteria only. It matches the one pattern already in the corpus and is bounded by the size of the scenario catalog. **(a)** is the honest fallback; **(c)** should not be undertaken as a side effect of this round.

<!-- anchor: 9yz96jor -->
### D3 — One convention for edge-case criteria

**Finding.** Three mutually inconsistent states coexist:

| Page(s) | Embeds | Edge records carry parent tag | Result |
| --- | --- | --- | --- |
| M18 | `m18` + `m18-edge` | 0 / 10 | correct — each renders once, with its own framing |
| M01, M17 | parent + `-edge` | 5/5, 3/3 | **renders twice** |
| M06, M09, M12, A01, A04, and the rest | parent only | yes | renders once, no edge-specific framing |
| the 4 from 0.9.12 | parent only | **no** | **renders zero times** |

There are 22 `*-edge` tags in the taxonomy; `<tagged_list_mixed>` is used nowhere in the corpus.

**Options.** (a) **Two-embed convention everywhere** (M18's shape): every page gains an `-edge` embed and every edge record **drops** the parent tag — gives edge cases their own framing, and M18's lead-in shows why that is worth having (*"deliberately including the documented holes… because an escape surface that no criterion names is indistinguishable from one nobody noticed"*). Cost: ~20 page edits plus ~72 retags. (b) **Single-embed convention everywhere**: drop the `-edge` embeds from M01/M17/M18, ensure every edge record carries its parent tag. Cost: 3 page edits + 10 retags, and M18 loses its framing. (c) Leave as-is and fix only R2.1.

**Recommendation:** **(c) now, (a) later as its own round.** R2.1 is correct under every option and should not be held hostage to this. Note the two conventions are genuinely incompatible — (a) requires removing parent tags, or M01/M17's double-render spreads corpus-wide.

<!-- anchor: 7xkfvevk -->
### D4 — Promote `<index>` Open question 9

**Address:** `index.md#0aj92zki`, item 9.

**What is today.** OQ9, written by 0.9.12, parks two sub-questions: (a) whether inbound peer turns should surface as a `UnifiedEvent` (*"most likely an `origin` discriminator on `user_message`"*), and (b) whether the pinned `'refuse'` should become a consumer-settable `claude_crossSessionInbound` ArchOption — *"which would make it an L3 key and a resume-immutable field (M07)"*. It states its own precondition: *"Probing the peer surfaces against a live second session is the precondition for either of the two."*

**Recommendation:** **keep parked.** The precondition is unmet, and A01's L7 discipline (*declared range == verified range*) forbids specifying an unprobed surface. Promoting (b) would add an L3 key and an M07 resume-immutable field on the strength of typed-but-unprobed SDK shapes. Revisit after the probe exists — which is **C1**, making this transitively blocked on code.

**Cost if promoted anyway:** new L3 key in A01/M18 config surfaces, an M07 immutability entry, an M12 semver classification, plus ACs.

<!-- anchor: ps3qasv2 -->
### D5 — `module-dependency` is inactive

**Finding.** `describe_entity_type('module-dependency')` → `INACTIVE_TYPE`. Rule 3a requires module-to-module dependencies to be **records** embedded as `<tagged_list type="module-dependency" tags="mXX"/>`, with the incoming half reachable by filter. Neither half is reachable today, which is why every `## Dependencies` section is a markdown table — a standing rule-3a deviation across all 18 modules, not a local defect.

**Options.** (a) Accept tables as this project's form and stop reporting it. (b) Activate the type and migrate 18 sections. (c) Leave inactive and record the deviation once in `<index>` so it stops being re-discovered every round.

**Recommendation:** **(c) now**, (b) only if incoming-edge tracing is actually wanted. This is the standing limit the applied plan already recorded; R3.2 is the best fix available under (a)/(c).

---

<!-- anchor: 4hwy9nqv -->
### D6 — Are the two peer-boundary criteria a duplicate or a correct split?

**Entities:** `ac-an-agent-team-teammate-emits-no-subag` ("An agent-team teammate emits no
subagent_* event on the unified stream.") · `ac-a-cross-session-peer-emits-no-subagen`
("A cross-session peer emits no subagent_* event on the unified stream.")

**Finding.** Identical sentence structure and identical asserted behaviour; only the subject
differs. Both came from splitting a single row of the applied plan's E23, deliberately, under
"one criterion = one observation". Both are also among the four retagged in **R2.1**.

**The question is whether "agent-team teammate" and "cross-session peer" are two distinct
mechanisms in this specification or one fact named twice.** `adapters/A01-claude-code.md#sw3cwrsm`
treats them as distinct — it describes `SendMessage` as one tool with three uses, of which
messaging teammates and messaging cross-session peers are separate — and `index.md#0aj92zki`
item 9 keeps the same separation.

**Recommendation: keep both.** The split follows the evidence on the page and the one-observation
rule; merging would re-create the compound criterion E23 deliberately broke up. Flagged as a
decision rather than a defect because the cost of being wrong is asymmetric: a redundant pair
is cheap, a merged criterion that hides one of two boundaries is not.

**Cost of merging instead:** one deletion plus a retitle, and the loss of the ability to say
which of the two boundaries a failing run violated.
<!-- anchor: shd0ij35 -->
## R5 — Code, not spec

**These are explicitly not specification edits.** They are listed because the spec now asserts behaviour the code does not implement, and each entry names the spec statement left unbacked. Route them through a release brief, not through page edits.

- **C1 — Implement the `sdk-surface-probe` scenario.** Specified at `modules/M12-conformance-release.md#xe2ecat1`; zero occurrences under `src/`. `adapters/A01-claude-code.md#a01e2ecv` already records it as *"❌ not implemented — three legs"*, so the spec is honest and only the code is missing. It is also the precondition for **D4** and the executable half of the inventory rule below.
- **C2 — Wire up `claudeCodeKnownBuiltins()`.** `src/adapters/claude-code.ts:207`; **zero call sites** repo-wide. Returns **24** names against a published catalog of 45. `modules/M18-tool-gating.md#4j6f86yq` states the gap as canon (*"a **29-name shortfall**"*) and `adapters/A01-claude-code.md#49zu34oc` calls the audit *"the executable half of M18's inventory rule… without it that rule is a sentence nobody can be held to"*. Whether to export it publicly (L4) is a **separate** question, not folded in here; it is already reachable via the `./claude-code` subpath export.
- **C3 — Add gemini's four delegation tool names to `GEMINI_TOOL_GROUPS`.** `src/adapters/gemini.ts:210`. The four (`codebase_investigator`, `cli_help`, `generalist`, `confucius`) are confirmed in the pinned SDK and absent from `src/` entirely. **Blocked by R1.1**, which decides what the spec claims in the meantime. Closing this is what would make R1.1's matrix cell legitimately `soft`.
- **C4 — A01's two security defaults are specified and unimplemented.** `crossSessionInbound` has zero occurrences under `src/`; the only `options.settings` write (`claude-code.ts:1336`) carries permissions only. `canUseTool` (`claude-code.ts:1483`) is installed **only** when a user-input handler exists and allows everything except `AskUserQuestion` — no `to` inspection. **Additional finding:** `SendMessage`/`ListAgents` are absent from `CLAUDE_CODE_UNGATED_BUILTINS` (`claude-code.ts:198`), which contradicts `#sw3cwrsm` and is asserted by the new criterion `ac-the-delegation-tools-are-present-in-t`.
- **C5 — opencode's per-tool primitive is unused.** The pinned SDK exposes `tools?: { [key: string]: boolean }`; the adapter sets only `agent.build.permission` (`src/adapters/opencode.ts:333`). Spec-relevant only if it would change A03's strength claim.
- **C6 — opencode version skew, with a spec half.** `package.json` dev-pins `^1.4.6`; the lockfile resolves **1.15.11**. `src/adapters/opencode.ts:110` says *"The names below are confirmed against opencode 1.4.6"* — so A03's `hard` strength rests on a verification ~11 minor versions stale. Per M12's **spec-first bump workflow** (`#agvf1tok`), `adapters/A03-opencode.md#gzef0pt9`'s pin and Verified-pin-log row change **before** `devDependencies`. This is the one R5 item with a mandatory spec edit; sequence it as spec → brief → code.

---

<!-- anchor: 6opkyp17 -->
## Seen, not planned

- `layers/L5-testing-conformance.md#ye2ecov1` and `layers/L7-sdk-compatibility.md#gxe5pr6r` both carry `M\d+` tokens (`M12`, `M02`, `M04`) and L5 carries a `<section_ref>` — rule 2a forbids both in a layer file. Corpus-wide across 7 layer files; outside this intent, and R1.3 deliberately avoids adding to it.
- `adapters/A01-claude-code.md#sw3cwrsm` has grown to a very large single section carrying twelve capability bullets, several with sub-bullets running to paragraph length. No rule is broken; it is the page's readability ceiling approaching.
- `modules/M18-tool-gating.md#1yllld10` holds the support matrix, the escape surfaces, the degradation rules and the composition mechanics in one section. Splitting is a structural question for a later round.
- `<tagged_list_mixed>` is used nowhere in the corpus, though the feature-slice groupings it exists for (the 22 `*-edge` tags, plus per-capability tags) are present.
- `ac-claude-code-e2e-sdk-version-gate`'s title carries implementation status (*"Intended behavior; the version gate is not yet implemented in code"*). Useful convention, applied inconsistently — R1.1 proposes reusing it, but whether status belongs in an AC title at all is unexamined.

---

<!-- anchor: 2ejnrndh -->
## §7 Rejected — reported items that did not survive verification

- **A01 bundled-CLI contradiction.** *Reported:* `#49zu34oc`'s *"tarball ships a Claude Code CLI executable"* conflicts with a new bullet saying `manifest.json` names a separately-fetched binary. *Verified:* both bullets are in the **same** section and describe the **same** artifact; the second opens *"The coupling above is read off `manifest.json`"* and is an explicit precision-correction of the first, not an independent claim. There is no bundled-vs-separate-artifact split. **Not a defect.**
- **`m09-edge`, `m14-edge`, `a04-edge` carry invisible records.** *Reported:* these tags exist and no embed selects them. *Verified:* true that no embed names them, but **every** record carries its parent tag — `m09-edge` ∩ `m09` = 2/2, `m14-edge` ∩ `m14` = 2/2, `a04-edge` ∩ `a04` = 3/3 — so all seven render via the parent embed. The same holds for `m13-edge` (3/3), `m15-edge` (5/5), `a02-edge` (3/3) and the rest. **Nothing is invisible here.** A sweep that counts embeds per tag without intersecting against the parent tag reports ~54 phantom invisible records; the true figure is the 4 in R2.1.
- **`missing-coverage` between the two abort criteria — RETRACTED, now planned as R2.4.**
  An earlier revision rejected this as a stale finding on the grounds that the `verifies[]`
  link already exists. It does exist, but that was never the analyzer's complaint: the issue
  is that the criterion's title covers only one of the two criteria it links. Confidence is
  **0.6**, not the reported 0.7, and the finding is non-deterministic (see R2.4). The rejection
  was wrong and is recorded here rather than removed.
- **M12 lacks a classification for the `canUseTool` gate — as addressed.** The **gap is real** and is planned as R1.2, but the reported source address was wrong: the "M12 classifies it" note for `canUseTool` is in `adapters/A01-claude-code.md#sw3cwrsm`, not in M18. `canUseTool` occurs in neither M18 nor M12.
- **M18 Purpose omits `delegation` while naming the other four groups.** Half rejected: `delegation` is indeed absent, but so are `file-read`, `file-write` and `web` — only `shell` appears. The premise is false, so the one-word fix is wrong; folded into R3.3 as a rewrite.
- **M18 Purpose is 1605 characters.** Measured **1589**. Also, no 1200-character limit is stated anywhere in this specification — it is a convention of the writing style. The section is over the convention either way; the number was wrong.
- **Move the "scenario may bypass the adapter" convention into the e2e-conventions bullet.** *Verified:* the convention is in `modules/M12-conformance-release.md#xe2ecat1` (catalog); `#n44tj2yh` carries only the generic conventions. **Recommend rejecting the move:** the convention is scenario-specific — it names `sdk-surface-probe` and ties the exemption to that consumer's L7 verified-pin log — so it belongs beside the catalog entry that triggers it, not in a generic bullet list. Filed as a rejected suggestion rather than a task.
- **opencode permission-schema catch-all.** Downgraded, not rejected: it is already documented as canon in `modules/M18-tool-gating.md#1yllld10` (*"A03 (all groups) — the permission schema ends in a catch-all…"*) and in `src/adapters/opencode.ts:104`. In the pinned SDK types the `permission` object has fixed keys; the catch-all index signature sits one level up on the agent config. Real, recorded, and not a spec gap.
