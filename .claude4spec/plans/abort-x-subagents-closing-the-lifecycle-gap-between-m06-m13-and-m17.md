---
type: plan
title: 'Abort x subagents — closing the lifecycle gap between M06, M13 and M17'
created_at: '2026-08-26T21:43:23.248Z'
created_by: agent
applied: true
---
# Abort × subagents — closing the lifecycle gap between M06, M13 and M17

**Status: revised after review, ready to apply.** Option **B (flush)** is the path. `subagent_completed.status` becomes a **closed, spec-declared four-member vocabulary** — `'completed' | 'failed' | 'aborted' | 'stopped'` — that adapters MUST map onto, with the field staying `string` in the contract. The mapping is total **and ordered**: a cancellation-shaped SDK spelling maps to `'aborted'`, and only a spelling that fits no shape at all falls to `'failed'` plus one `warning` per run. Eighteen steps below, in order.

**What changed in v6.** A three-pass review (facts / conventions / adversarial, the last one reading `src/`) found four defects that would have been written into M06 and A01 as canon and then handed to an implementer. All four are fixed in place, not deferred:

1. The open set is `inFlight`, **not** the `Map<task_id, task_type>` routing map — the old step 11 named a structure that never removes entries, which specifies a double-emission bug the plan's own owed assertion would not catch. An at-most-once invariant is now stated in step 2.
2. "Before the terminal `error`" is **unsatisfiable** on a real abort path — M13 Edge cases (<section_ref anchor="1vd9sye5"/>) says `abort()` ends in `AdapterAbortError` **or natural iterator completion**. The rule and the AC are now worded over the end of the stream.
3. The flat `'failed'` fallback **misroutes the one unknown status the codebase already knows about** — `cancell?ed`. The mapping is now ordered so a cancellation shape reaches `'aborted'`.
4. M06 owes a `## Testing & Conformance (L5)` section by L5's own module-slice schema (M18 is the precedent); no step created one. Step 6 does.

Three arguments were removed rather than repaired: the `splitBySubagent` attribution (false — see the discovery note), the "merging prices a future major" semver claim (refuted by this plan's own step 12), and the assertion that `'stopped'` can only originate engine-side (unevidenced; now an open probe).

<!-- anchor: nffu6oxg -->
## What was checked (discovery)

Queried the graph rather than reasoning from memory:

- `M06` — Purpose, Unified Contract (L1), Subagent definition envelope, Capability & Degradation (L2), Dependencies, Edge cases, Acceptance criteria. M06's section list is `Purpose / Dependencies / L1 / L2 / L4 / Edge cases / Acceptance criteria` — **no L5 section today**, which step 6 corrects.
- `M13` — Unified Contract (`8q9q7ty7`, the stay-apart discipline), Edge cases (`1vd9sye5`, the abort-outcome bullet), Acceptance criteria; 10 active `ac` entities tagged `m13`.
- `M17` — Unified Contract (L1), **Configuration & Extensibility (L3)** (`52ymvppn`, the Stop lever), Dependencies, Edge cases (`q9u5sbot`); the AC `ac-when-abort-or-timeoutms-fires-with-bac` (`kind: edge-case`, tags `m17`, `m17-edge`).
- `M12` — e2e scenario catalog (L5) and Public API & Packaging (L4: semver + the contract-extension checklist).
- `M01` — Unified Contract (L1) — implementor, the `UnifiedEvent` taxonomy.
- `M09` — Unified Contract (`diq2em77`), for what `splitBySubagent` actually claims.
- `M18` — the deny-propagation precedent, including its own L2 support matrix (`1yllld10`) and its `## Testing & Conformance (L5)` section, which is the template for step 6.
- `A01` — Event mapping (`mn3ytsj4`), Per-capability consumption (`sw3cwrsm`, which holds the *Known gaps* sub-block), L7 (`49zu34oc`, which holds the *Verified-pin log* sub-block), e2e coverage (`a01e2ecv`), Edge cases (`677rc2wh`); `A02` — capability rows; `A03` — Event mapping (`83wdcw1d`), Edge cases (`d9ugsejh`); `A04` — Event mapping (`mlo3qpng`), Edge cases (`99avio4b`). Section listings for all four adapters confirm **only A01 has an `e2e coverage` section**.
- A regex sweep for `status` across every page, and a second for `stopTask`.
- Tags: 12 active ACs under `m06` (co-occurring: `m06-edge` ×3, `m15` ×2); `a01` / `a01-edge` exist and are the established adapter-AC naming.

**Code-verified facts** (recorded because most of this plan's decisions rest on them, and the spec assistant does not edit `src/`):

- `status` is typed `string` at `types.ts:203`; `warning` is a real member of the taxonomy (`types.ts:326`, M01's misc row), so the fallback has an event to ride on.
- `'completed'` / `'failed'` are emitted by opencode (:696/:725) and gemini (:805); claude-code passes the SDK's own status through unvalidated (`claude-code.ts:1907`).
- The SDK types `task_notification.status` as the closed union `'completed' | 'failed' | 'stopped'` (`sdk.d.ts:4463`), and documents exactly one producer of `'stopped'`: `sdk.d.ts:2559` — *"Stop a running task. A task_notification with status 'stopped' will be emitted."* The plan's gloss for `'stopped'` is therefore the SDK's own semantics, not an invention.
- **The open set is `inFlight`, not the kind map.** `claude-code.background-hold.ts:136` documents that the `task_id → task_type` map's *"entries are never removed"*; `:149` `inFlight` is *"ids started but not yet settled by their `task_notification`"*, and `settle()` (`:200`) deletes from `inFlight` alone. A01 already describes this as adapter-side in-flight tracking.
- **`cancell?ed` is already observed.** The adapter's own terminal-status test on `task_updated.patch.status` is `/^(completed|failed|stopped|cancell?ed)$/` (`claude-code.ts:1925`), and `sdk.d.ts:6909` `TerminalReason` carries `aborted_streaming` / `aborted_tools`. The engine's task-status vocabulary is wider than the typed `task_notification` union, and the extra values are cancellation-shaped.
- **Hold-cap expiry is the same terminal path.** `claude-code.ts:1279` funnels `timedOut`, `abort()` and `backgroundHoldExpiredAfterMs` through one abort controller and one terminal error, so a flush written at the abort branch fires on cap expiry too. A01 records that the hold tracks *both* kinds, a late-settling subagent included.
- **The terminal `error` is not guaranteed.** `claude-code.ts:2066` deliberately does not gate the terminal error on `signal.aborted`, so an `abort()` racing a stream close exits with no `error` at all — matching M13's own "or natural iterator completion".
- **gemini already ships the B-minus defect.** `gemini.ts:798` maps a subagent thread's `agent_end` to `'failed'` only when `reason === 'failed'`, and to `'completed'` otherwise — so `reason: 'aborted'` is reported today as a **success**, and the thread is deleted from `activeSubagents` at `:801`, leaving the step-18 flush nothing to close.
- **`splitBySubagent` does not pair or count.** `utils.ts:95` partitions a stream and returns after it ends; it cannot hang on an unclosed pair. M09 (`diq2em77`) claims only that it *"partitions parent vs. per-subagent streams"*. The genuine hanging-helper case is `takeUntilResult()` in the M17 family — this family has none, and the plan no longer claims otherwise.
- opencode closes the spawned server in the run's `finally` (`opencode.ts:854`) and the abort path returns from inside the `try`, so A03's Edge cases are accurate as written.

**Confirmed gap.** No page and no AC states what the `subagent_*` family owes when a run-level termination fires with subagents in flight.

- M06 Edge cases covers concurrency, validation, tool/model/skill inheritance and path-scope — never termination.
- M13 Edge cases covers `abort()` mid-run, `timeoutMs`, the parked-`user_input_request` case and the M17 hold cap — always at the level of *the run*, never per event family.
- M17 states the rule for its own family (`no background_task_completed is owed after termination`) and separately states that subagents hold the session but are **never** listed in `result.backgroundTasks` — so M17 deliberately hands the subagent case back, without naming who takes it.

<!-- anchor: 4e01uqcb -->
## Decision 1 — which module owns the rule: **M06**

M06, not M13. Three reasons, in the project's own terms:

1. **One-home rule.** M06 owns the `subagent_*` family, its support matrix and its degradation. What the family owes on abnormal termination is a property *of the family*, not of the abort mechanism.
2. **Precedent already set by M17.** The analogous rule lives in M17 and its AC is tagged `m17`/`m17-edge` — the family-owning module took it, not M13.
3. **Layer-purity of M13.** M13's substance is the *terminal condition*: error class, phase, `name`, no dangling subprocess. It stays accurate if M06 is deleted. A per-family close rule inside M13 does not.

**M13's share is one dependency row, not a rule.** No new M13 edge-case bullet, no new `m13` AC: M13 already asserts `no dangling SDK process` and that is the whole of its claim here.

<!-- anchor: b9rq3ttd -->
## Decision 2 — the `status` vocabulary: closed, four members, declared in M06

**The specification never declared which values `status` admits** — not for `subagent_completed`, not for `background_task_completed`. M01's taxonomy spells the background payloads inline but names the subagent family with no payload at all; M06's L1 is the only place the payload is written; the `status` sweep across all 30 pages returns no enumeration anywhere. The only enumerated vocabulary in either family is M17's `taskType`.

**The drift is already live, which is what settled closed-vs-open.** Because `types.ts` types the field `string` and claude-code forwards the SDK's value unvalidated, a fourth value — `'stopped'` — already reaches consumers today on a surface where opencode and gemini only ever produce `'completed'` / `'failed'`. Not a future risk to manage; an unspecified value in production. Closing the set is corrective, not speculative.

**The field stays `string` in the contract.** The closed set is a spec-declared vocabulary the adapters MUST produce, in the same discipline as M17's `taskType` — a rule about what adapters emit, not a compiler-enforced union. No `types.ts` signature change, no compiler-visible break, no consumer's fixtures stop typechecking. Tightening `string` into a union stays a separate, later, major-shaped decision (out of scope below).

<!-- anchor: 4c157hg3 -->
### Who owns the addition — M06, with M01 untouched

The spec has exactly one precedent for a lifecycle-payload vocabulary, and it is M17's `taskType`: **M01 declares the field's existence on the event type; the owning module declares the value vocabulary and what each value means.** So the vocabulary lands in M06's L1 (`0f6287ae`), M01's taxonomy line needs **no edit** (it does not spell subagent payloads at all), and `types.ts` JSDoc follows through a release brief.

<!-- anchor: 9v2xkr4t -->
### Why four members and not three — one surviving argument

The decision brief proposed folding SDK `'stopped'` into `'aborted'`. The merge is **rejected, but on one argument rather than four** — the review killed two of the original three and the remaining one is sufficient.

**The argument that decides it: M13's stay-apart discipline, applied one level down.** M13's Unified Contract (<section_ref anchor="8q9q7ty7"/>) spends a whole bullet on why every terminal condition gets its own class: *"a consumer's correct reaction differs in each"*, and collapsing two of them *"forces the consumer to parse a message string to tell them apart"*. The same test decides this. `'aborted'` means **the whole run ended** — the stream is about to close and the consumer tears everything down. `'stopped'` means **one subagent ended and the run continues** — the other subagents still live, the model still produces. Merged, the only discriminator left is correlation with a later terminal event, which is exactly the shape M13 refuses. And `sdk.d.ts:2559` proves the second state is real rather than hypothetical: `stopTask()` exists and documents that it emits `'stopped'`.

**Two arguments withdrawn, recorded so they are not re-run.**

- *"Merging now prices a future major, because un-merging is a rename."* **Wrong, by this plan's own step 12**: a new value of an existing declared vocabulary is additive and therefore minor. Introducing `'stopped'` the day `stopTask()` is surfaced would be a minor plus a behavioral note — the same shape as this change. The merge was never priced the way the v5 text claimed.
- *"`'stopped'` can today only originate with the engine stopping a task on its own."* **Unevidenced.** The SDK documents `stopTask()` as a producer and says nothing about engine-initiated stops, nor about what `Query.interrupt()` emits for in-flight tasks. This matters: if an interrupt settles in-flight tasks as `'stopped'`, then on a single `abort()` the adapter would emit `'stopped'` for the tasks the SDK reported and `'aborted'` for the ones it flushed, and the discriminator above would be false within one run. It is now an **open probe** on A01's next pin verification (step 17), not a stated fact.

**A value not every adapter can produce is already normal here.** M17's `taskType` carries `'monitor'` and `'workflow'`, which not every adapter emits. The L2 matrix is the instrument for that.

**On the name.** `'stopped'` matching the SDK's own spelling is a coincidence of vocabulary, not a pass-through, and the JSDoc must say so: the mapping stays explicit and total, so an unrecognized SDK value is a mapping decision and never a forward.

<!-- anchor: 7pq3mn8w -->
### The total mapping — ordered, with `'failed'` as the last resort

A closed set needs a total mapping, so the spec must say what happens when a peer-SDK bump adds a fifth spelling. **v5 said "map it to `'failed'`". That is wrong for the most likely fifth spelling, and the fix is to make the mapping ordered rather than flat.**

**Why flat fails.** The adapter's own terminal-status test already accepts `cancell?ed` on the sibling `task_updated` channel (`claude-code.ts:1925`), and `TerminalReason` carries `aborted_streaming` / `aborted_tools`. So the engine's task-status vocabulary is already wider than the typed union, and the values it is wider *by* are cancellation-shaped — precisely the case this plan invents `'aborted'` for. A flat fallback would route a cancelled subagent to `'failed'`, bypassing the plan's own new value, and the "safe direction" defence evaporates: a subagent cancelled by a termination reported as `failed` is not conservatively safe, it is a second wrong answer.

**The ordered rule.**

1. An SDK spelling the adapter recognizes maps to its declared counterpart.
2. An unrecognized spelling that is **cancellation-shaped** — `cancelled` / `canceled`, or an `aborted*` reason — maps to `'aborted'`.
3. Anything else maps to `'failed'` and raises a `warning`.
4. Never `'completed'`. Mapping an unknown ending onto success is the B-minus defect in miniature: it tells the consumer the delegated work finished when nobody knows that it did, and a consumer acting on a false success releases resources, commits results or reports completion upstream on the strength of a value the adapter invented. The reactions `'failed'` triggers — retry, surface, investigate — are harmless when wrong; the reactions a false `'completed'` triggers are not.

**The `warning`'s scope is stated, not implied.** **At most one per run**, however many unrecognized statuses arrive. v5 wrote "one-shot" and left the scope open, which no conformance test can be written against. And the qualifier matters for a second reason: every other "one-shot `warning`" in this spec (M01, L2, M15, A02, A03, A04) is the **L2 degradation** shape — emitted at startup because a consumer requested an unsupported feature. This one is neither: nothing was requested and refused, and it fires mid-stream. It is a **drift signal**, and saying so keeps M06 from appearing to declare a degradation with no capability flag behind it.

**The accepted cost, recorded rather than glossed.** Under a new SDK wording that is not cancellation-shaped, a subagent that actually *succeeded* is reported as `'failed'`. That is a false negative, chosen deliberately over a false positive, and the `warning` fires alongside it so the misreport arrives with its own explanation. The alternative — a fifth `'unknown'` member — was rejected: it costs every consumer a branch they will almost never take, and puts a permanent member in the vocabulary to describe a transient state of our own mapping.

<!-- anchor: 6xk3wm2p -->
### Why the unmapped pass-through is a latent surface

A01 records `Query.stopTask()` among its unused SDK controls (the *Known gaps* sub-block inside Per-capability consumption, `sw3cwrsm`). So nothing this library does causes `'stopped'` today — it arrives, if at all, from a cause no page documents, on a field no page specifies, through a path no test exercises. That is why an unvalidated forward is dangerous rather than merely untidy. Steps 2, 13 and 15 close all three: the field gets specified, the mapping gets a home in A01's Event mapping, and the drift point gets recorded in A01's L7 alongside its defensive read.

<!-- anchor: m8yd5lwh -->
### Semver under L4 / M12 — minor + a mandatory behavioral note

- **Minor, by the additive rule** — "additive `UnifiedEvent`/param changes are minor, removals/renames are major". Declaring a vocabulary and naming an abort value removes nothing and renames nothing, and with the field staying `string` there is no signature to change at all.
- **The behavioral CHANGELOG note is mandatory, and the free-form typing is *why*.** Because `status` is a `string` rather than a union, a consumer's exhaustive `switch` gets **no compiler warning** when a new value starts arriving. The note is the only signal they get. That, plus events now arriving after an abort where previously none did, is M12's behavioral-hardening clause exactly — same shape as the M15 path-scope reference case.
- Suggested note: *"abort/timeout/hold-cap now closes open subagent lifecycle pairs; `subagent_completed.status` is a declared vocabulary (`completed` / `failed` / `aborted` / `stopped`) that adapters map onto — claude-code no longer forwards the SDK's raw status, and gemini no longer reports an aborted subagent thread as `completed`."*
- **Two clauses of that note are behavioral changes to shipped output, not just documentation.** claude-code forwards `'stopped'` today, so obliging it to map changes what anyone branching on the forwarded value sees; gemini reports an aborted thread as `'completed'` today (`gemini.ts:798`), so step 18 changes a value consumers already receive on a path that looks successful. Still minor — nothing is removed from a declared surface, because the surface was never declared — but this is exactly what the note exists to announce.

<!-- anchor: 2xborp63 -->
### What M12's contract-extension checklist obliges

| Checklist item | What B owes | Note |
| --- | --- | --- |
| `types.ts` + JSDoc | JSDoc naming the four values, which adapters emit which, "map, never forward", the ordered fallback, and the at-most-once invariant; the `string` type itself is unchanged | code, via brief |
| every adapter | claude-code maps + flushes; gemini maps per thread + flushes; opencode flushes its single tracked subagent; codex already documents no subagent concept | see below |
| `shared.ts` assertions | the pairing invariant and its at-most-once half | **step 6** records it on the page; the brief carries the code |
| per-adapter e2e case | the abort × subagent leg | steps 11, 16 |
| new real-model scenario? | **no** — a leg on the existing `abort` row, so the catalog row is *edited*, not added | the clause is conditional and does not fire |
| coverage rows + AC entities | A01 coverage row; seven `ac` entities | steps 7, 16 |
| capability matrix | the new L2 row, plus a correction to the row above it | step 5 |
| version bump | minor + the behavioral note | above |

**Two notes on how literally to read the checklist.**

- The checklist's own grammar nests "record it in each covering adapter's e2e coverage list, and add its AC entity" inside the *"if it introduces a new real-model scenario"* conditional. This plan does both anyway — AC coverage is independently required — but the checklist should not be cited as literal authority for it.
- **v5 claimed codex was an exception. It is not.** A02 already documents subagents as unsupported with a warning and states that no lifecycle events are produced, so the "document-unsupported" item is **satisfied, not departed from**. No A02 edit is owed, and the paragraph arguing for a departure is withdrawn.

<!-- anchor: sfuhr0t7 -->
## Decision 3 — the honesty clause and its placement

The earlier caveat about opencode's `abort()` not reaching the server is **withdrawn**: `opencode.ts:854` closes the spawned server in the run's `finally` and the abort path returns from inside the `try`, so A03's Edge cases are accurate as written. No A03 correction is owed by this plan.

The caveat rests instead on the limitation the spec already half-states: attribution on opencode is **ordering-based under a single-active assumption** (M06's L2 matrix: `⚠️ ordering-based (single active)`; A03's Event mapping: "nested tasks would require a stack"). A flush there closes **at most the one subagent the adapter has open**; a nested or concurrent `task` was never opened as its own pair. This is a limitation of *tracking*, which is what the flush reports on, not of *teardown*, which the flush was never about.

**Placement is a three-way split, following the M18 deny-propagation precedent**: the adapter-agnostic *rule* in M06's Edge cases, the per-adapter *strength* in an L2 matrix, the *mechanism* in the adapter file. One correction to how v5 stated that precedent: for M18 the strength lives in **M18's own** L2 matrix (`1yllld10`), not in M06's. Here the strength lives in M06's matrix, because M06 owns this capability (step 5).

<!-- anchor: 42crwyuz -->
## Step-by-step — definitive ordered list

Eighteen steps. Steps 1–9 are M06 and its entities; 10 is M17; 11–12 are M12; 13–16 are A01; 17–18 are A03 and A04. Nothing here touches `src/`.

<!-- anchor: 614itavy -->
### 1. M06 — Dependencies (`7tmzge8v`): one row

Two-column table (`Module / Layer | Relation`), keeping the existing order (layers first, then modules ascending):

| `M13` | A run-level termination — `abort()`, `timeoutMs`, or a hold-cap expiry — ends a run with subagents in flight; what the lifecycle family owes at that moment is stated here. |

<!-- anchor: 6h8siwye -->
### 2. M06 — Unified Contract (L1) (`0f6287ae`): declare the `status` vocabulary

Beside the existing payload line, in the shape M17 uses for `taskType`. Three paragraphs — the vocabulary, the mapping, the pairing invariant:

> `subagent_completed.status` is a **unified** vocabulary of four values: `'completed'` for a subagent that ran to its own end, `'failed'` for one that ended in error, `'aborted'` for one closed by a run-level termination (see Edge cases), and `'stopped'` for one ended individually by a stop control while the run continued — the per-task lever M17 reserves (<section_ref anchor="52ymvppn"/>). `'aborted'` and `'stopped'` are deliberately not one value: the first says the run is over, the second says one delegation ended while the run keeps producing, and a consumer's correct reaction differs in each (M13 — <section_ref anchor="8q9q7ty7"/>). Adapters **map** their SDK's own spelling onto these names and never forward it — the wire values may differ, may coincide, and MUST NOT be matched against this set directly.

> The mapping is **total and ordered**. A spelling the adapter recognizes maps to its counterpart. An unrecognized spelling that is **cancellation-shaped** — an SDK's way of saying the work was stopped by a termination — maps to `'aborted'`. Only a spelling that fits no shape at all maps to `'failed'`, and raises a `warning`, at most one per run however many unrecognized statuses arrive. Never `'completed'`: a value that claims success the adapter cannot vouch for is the one error a consumer acts on irreversibly. This `warning` is a **drift signal, not an L2 degradation** — nothing was requested and refused; a status arrived that the pinned SDK range never declared.

> **At most one `subagent_completed` per `subagent_started`.** A subagent that has reported its own end is closed; the termination flush applies only to those still open. An adapter that tracks started ids and settled ids in the same structure cannot satisfy this — the open set must be the one the settle path empties.

<!-- anchor: unmg8caf -->
### 3. M06 — Edge cases (`4b8iv50p`), first bullet: the rule

Compressed to M06's own register — its Edge cases are single-arrow bullets with at most one "because" clause, not M17's paragraph-arguments. The comparative reasoning stays in this plan's "Why B, recorded" section, where it belongs.

> - **A run-level termination fires with subagents in flight** — `abort()`, `timeoutMs`, or a hold-cap expiry (M13 — <section_ref anchor="1vd9sye5"/>) → every subagent the adapter still has open is closed with a `subagent_completed` carrying `status: 'aborted'` before the stream ends, whether it ends with a terminal `error` or by natural iterator completion. A consumer pairing lifecycle events live cannot otherwise tell an aborted run from one still producing, so its "clean up when every subagent is closed" step never fires. This is the *opposite* of M17's rule for `background_task_*`, deliberately: a background task outlives the run and only the engine can honestly report its completion, while a subagent ends with the run, so the adapter is the one party that can.

Two wording choices are load-bearing. **"Before the stream ends", not "before the terminal `error`"** — M13 records that an abort may end in natural iterator completion with no `error` at all, and an AC anchored to an event that need not exist is unfalsifiable on exactly the branch where the pair is most likely unmatched. **"A run-level termination", not "`abort()` / `timeoutMs`"** — the hold cap aborts down the same path, so a flush written at the abort branch fires there whether or not the spec admits it.

<!-- anchor: fdh63ml1 -->
### 4. M06 — Edge cases (`4b8iv50p`), second bullet: the honesty clause

Also compressed, and stripped of the M18 analogy — the analogy is an argument about why the clause exists, not a fact a reader of M06 needs:

> - **The flush reports on the adapter's tracking, not on the subagent.** A synthesized `subagent_completed` says *this run stopped tracking that subagent*; it does not say the helper agent's own execution ended. Where attribution is ordering-based rather than id-carried, only the single active subagent can be closed at all, and a nested or concurrent delegation was never opened as its own pair — so there is nothing to close and nothing is claimed about it (see the matrix above). Consumers may use the flush to close their own bookkeeping; they may not read it as evidence that every delegated task stopped.

<!-- anchor: vpgvvnj7 -->
### 5. M06 — Capability & Degradation (L2) (`1zx424gy`): one new row **and one correction**

Five columns, order `Behavior | claude-code | codex | gemini | opencode`. The new row:

| Behavior | claude-code | codex | gemini | opencode |
| --- | :---: | :---: | :---: | :---: |
| Lifecycle closed on run-level termination | ✅ flushed from the in-flight id set | ❌ no subagent concept | ✅ flushed from the active-thread set | ⚠️ single active only (ordering-based) |

**The correction is not optional and belongs in the same edit.** The existing `Lifecycle events` row gives codex `⚠️ synthesized`, which the new row's `❌ no subagent concept` contradicts one line below it. A02 sides with the new row: it states that `subagents` is ignored with a warning, that no lifecycle events are produced, and that `subagentTaskId` is never populated. So the **existing** codex cell is the wrong one — change it to `❌`, and leave a reader two rows that agree.

The opencode cell states the *tracking* limitation, the same cause the `subagentTaskId` row already reports as `⚠️ ordering-based (single active)`, which is what makes the column readable.

**This row is the only per-adapter *strength* statement this plan adds** — the adapter files carry *mechanism* (steps 13–18), which is the three-way split of Decision 3, not a contradiction of it. Section listings for A02, A03 and A04 confirm none has an `e2e coverage` section; that shape exists in A01 alone, so the L2 matrix is where per-adapter strength lives.

<!-- anchor: fbr8mqel -->
### 6. M06 — new section `## Testing & Conformance (L5)`

**New in v6, and mandatory rather than optional.** L5's module-slice schema says a module touches L5 when it contributes an invariant to the shared assertion toolkit, *"in which case its `## Testing & Conformance (L5)` section names the assertion and what it checks"*. M18 is the worked precedent — its L5 section names its two invariants and what each catches. This plan commissions a cross-adapter `shared.ts` assertion, so leaving it to the release brief would make a machine-checked contract invisible to the next reader of M06.

Placement follows the module template's layer order: after Capability & Degradation (L2), before Public API & Packaging (L4). Content — two invariants, because one alone is satisfiable by the bug:

> **Lifecycle pairing.** Every `subagent_started` is matched by a `subagent_completed` before the stream ends, on every terminal path including abort, timeout and hold-cap expiry. This is the assertion the termination rule exists to make provable.
>
> **At most once.** No `subagent_started` is matched by two `subagent_completed` events. The pairing assertion alone does not catch a flush that closes already-settled subagents a second time — it passes either way — so the two are asserted together or the first one certifies the defect.

The second invariant is the direct product of the review: the v5 text told an implementer to walk a structure that never forgets an id, and the only assertion it commissioned would have gone green on the resulting duplicate stream.

<!-- anchor: ddui06o4 -->
### 7. AC entities — seven new

Created through the entity tools. Five under `m06` + `m06-edge`, one under `a01`, one under `a04` (verify the `a04` / `a04-edge` pair exists at apply time, as `a01` / `a01-edge` does; create it by tagging if not).

1. *When a run-level termination ends a run, every subagent the adapter still has open is closed by a synthesized `subagent_completed` before the stream ends.* — `kind: edge-case`
2. *A `subagent_completed` synthesized on run-level termination carries `status: 'aborted'`.* — `kind: requirement`
3. *A subagent that already reported its own `subagent_completed` is not closed a second time by the termination flush.* — `kind: edge-case`
4. *An SDK task status the adapter does not recognize, and which is cancellation-shaped, maps to `subagent_completed.status: 'aborted'`.* — `kind: edge-case`
5. *An SDK task status the adapter recognizes as neither declared nor cancellation-shaped maps to `subagent_completed.status: 'failed'` and raises at most one `warning` per run.* — `kind: edge-case`
6. *(a01) The claude-code adapter maps the SDK's task status onto the unified `subagent_completed.status` vocabulary rather than forwarding it.* — `kind: requirement`
7. *(a04) A gemini subagent thread whose `agent_end` carries `reason: 'aborted'` is reported with `status: 'aborted'`, not `'completed'`.* — `kind: requirement`

**What changed from v5's five.** AC 1 is re-anchored to the end of the stream (see step 3). AC 3 replaces v5's honesty-clause criterion — *"reports that the adapter stopped tracking the subagent, without asserting that the subagent's own execution ended"* — which was not observable: there is no assertion to write against "the adapter did not claim X", the corpus contains no criterion of that shape, and the honesty clause already has its one home in step 4's prose. The new AC 3 is the at-most-once invariant, which a test can check directly. AC 4 and 5 split the ordered mapping into its two branches, since collapsing them would hide the branch that exists precisely because the flat version was wrong. AC 7 is new because gemini's current `'completed'`-on-abort is a live defect this plan changes, and an unasserted behavior change on a path that looks successful is how it survives.

AC 1 is worded over "every subagent the adapter still has open" rather than "every subagent": that keeps it true on opencode's single-active tracking and vacuously true on codex. The degradation is the matrix's job to state, not the criterion's job to hide. `verifies` stays empty, as it is on 11 of the 12 existing `m06` ACs (`ac-the-claude-code-e2e-subagents-scenari` is the one exception — v5's claim that it is empty on *every* m06 AC was wrong).

<!-- anchor: 26i6jrra -->
### 8. M06 — Acceptance criteria (`o0e0wak5`): the lead sentence

The section already embeds `<tagged_list type="ac" tags="m06"/>`, so the new entities surface without a list edit. Only the lead sentence changes — and it must **keep all three clauses it already has**. The current sentence reads that the criteria verify lifecycle observability, that the optional `subagentTaskId` is always safe to read, and that a definition's context is derived from its parent. v5's instruction said to add termination "as a third thing alongside lifecycle observability and definition-context derivation", silently dropping the `subagentTaskId` clause. Add termination as a **fourth** clause; drop nothing.

<!-- anchor: v5a4ro1h -->
### 9. M06 — Acceptance criteria (`o0e0wak5`): the *Real-model proof* sentence

**New in v6.** M06 has no L5 e2e section (step 6's L5 section is about assertions, not scenarios); the module-wide habit is to name the real-model proof inside the AC section, and M06 already does — its *Real-model proof* sentence names the `subagents` e2e scenario. But this plan deliberately routes the new leg onto the **`abort`** scenario (step 11), so without this edit M06's own pointer omits the leg that proves its own new AC.

> …and the abort × subagent leg on the `abort` scenario (M12 — <section_ref anchor="xe2ecat1"/>).

<!-- anchor: xby32oaj -->
### 10. M17 — Edge cases (`q9u5sbot`): one clause on the cap bullet

**New in v6.** M17's cap bullet ends: *"any remaining task is abandoned with its completion never to be reported."* After this plan, a cap expiry — which M17 itself says *"interrupts and aborts the session, down the same path `abort()` uses"* — **does** close open subagents. A01 records that the hold tracks both kinds, so this is not hypothetical. One clause, keeping M17's own asymmetry argument intact:

> …any remaining **background** task is abandoned with its completion never to be reported. Open **subagents** are the other half of that asymmetry and are closed rather than abandoned: a subagent ends with the run, so the adapter can report its end honestly where it cannot report a background task's (M06 — <section_ref anchor="4b8iv50p"/>).

<!-- anchor: xzuntf74 -->
### 11. M12 — e2e scenario catalog (`xe2ecat1`): the `abort` row grows the leg

Two columns (`Scenario | What it proves (real-model)`). The leg goes on the **`abort`** row, not the `subagents` row: the catalog is a vocabulary of what a suite can prove, and abort semantics proved in one place beat abort semantics split across two scenarios. An edited row, not a new scenario — which is why the checklist's catalog clause does not fire.

> | `abort` | `abort()` mid-stream ends the run cleanly (`AdapterAbortError`, channel closed); and, with a subagent in flight, the lifecycle family is closed before the stream ends rather than left as an unmatched `subagent_started` (M06 — <section_ref anchor="4b8iv50p"/>). |

The `section_ref` is **bare, not backticked** — v5 wrapped it in backticks here and in step 14, which would render the reference as literal inline code instead of a resolvable chip. House habit, confirmed in A01 and M17, is bare.

<!-- anchor: 2uyi0dtz -->
### 12. M12 — semver bullet (`agvf1tok`): the value-level clause

M12's additive rule is written over *events and params* only, and this case proved it: "is a new value of an existing field additive?" had to be answered from the nearest neighbouring rule rather than from one that names it.

> A new **value** of an existing declared vocabulary is additive and therefore minor, on the same footing as a new event or param. Where the field is typed loosely enough that a consumer's exhaustive `switch` gets no compiler warning, the behavioral CHANGELOG note above is not optional — it is the consumer's only signal.

The second sentence is the part worth having: it ties the note's necessity to the *type's* looseness rather than to the author's judgement, so the next such change is not argued from taste. This clause is also what retires the "merging prices a future major" argument in Decision 2 — the rule is now written down, so the next reader does not have to re-derive it.

<!-- anchor: 3kqfad9t -->
### 13. A01 — Event mapping (L1) (`mn3ytsj4`): the status mapping

**New in v6 — this content was in v5's step 11, in the wrong section and at the wrong length.** The adapter template names Event mapping as *"table mapping SDK events → `UnifiedEvent`, plus normalization specifics"*, and A01's section already carries exactly this shape for the sibling case: the `task_type` capture into a `Map<task_id, task_type>` because `task_progress` / `task_notification` do not carry it. A `status` normalization is the same kind of fact, and putting it beside its sibling is what lets it stay short — in Edge cases it had no adjacent normalization to abbreviate against, so it re-derived M06's whole rule and broke the one-home rule doing it.

Appended after the existing `task_type` paragraph:

> `task_notification.status` is a closed union of its own (`completed` / `failed` / `stopped`) and is **mapped** onto the unified vocabulary (M06 — <section_ref anchor="0f6287ae"/>), never forwarded; `stopped` maps to unified `'stopped'`. A status outside that union is handled by the ordered rule there — the engine's wider task vocabulary is already visible on the sibling `task_updated` channel, whose terminal test accepts `cancelled` / `canceled`, and those are cancellation-shaped. `Query.stopTask()` is unused here (*Known gaps* — <section_ref anchor="sw3cwrsm"/>), so no call of ours produces `'stopped'` today.

Note what this does **not** repeat: why `'stopped'` is not `'aborted'`, and why an unknown value never becomes `'completed'`. Both are M06's, and the ref carries a reader there.

<!-- anchor: ucrrxxzw -->
### 14. A01 — Edge cases (`677rc2wh`): the flush, and only the flush

One bullet, not two — the mapping moved to step 13. **The structure named here is the correction the review forced:**

> - A run-level termination with subagents in flight → the interrupt, the controller abort and the input-channel close happen as for any abort, and in addition the adapter walks its **in-flight task-id set** — the ids started but not yet settled by their `task_notification` — and emits a `subagent_completed` (`status: 'aborted'`) for each before the stream ends (M06 — <section_ref anchor="4b8iv50p"/>). The `Map<task_id, task_type>` that routes subagent kinds away from M17 is **not** that set: it never removes entries, so walking it would re-close every subagent the run ever started.

v5 named the kind map as "what makes the open set knowable". It is the opposite — `background-hold.ts` documents that its entries are never removed, while `settle()` empties the in-flight set alone. An implementer following v5 would have emitted a duplicate `subagent_completed` for every already-finished subagent, and the pairing assertion v5 commissioned would have passed on the duplicated stream. Naming the wrong structure *and* omitting the at-most-once invariant is why both step 2 and step 6 now carry the invariant explicitly.

<!-- anchor: fcpzgwjy -->
### 15. A01 — SDK compatibility & schema drift (L7) (`49zu34oc`): the drift point

**New in v6.** v5 argued no L7 edit was needed because the `warning` "lands in the Verified-pin log". It does not: L7 defines that log as append-only rows recording pins the consumer has been **verified against** — an e2e run or documented live use, written by the implementer at bump time. A `warning` in someone's production run is neither. L7's schema has two bullets that *are* the home for this — *Known schema-drift points* and *Defensive-read / in-range degradation strategy*, the latter being explicitly about "how the consumer keeps working across that drift … so a renamed field is never a silent no-op".

Under **Known schema-drift points**:

> `task_notification.status` — a closed union today (`completed` / `failed` / `stopped`), while the sibling `task_updated.patch.status` already shows a wider engine vocabulary including `cancelled` / `canceled`. A peer-SDK bump inside the declared range can widen the notification union to match.

Under **Defensive-read strategy**:

> An unrecognized `task_notification.status` is never forwarded: cancellation-shaped spellings map to `'aborted'`, anything else to `'failed'` with one `warning` per run (M06 — <section_ref anchor="0f6287ae"/>). The `warning` is what turns an in-range widening into something the next pin verification has to look at.

**Also here — the open probe from Decision 2:** whether `Query.interrupt()` settles in-flight tasks as `'stopped'` is unverified, and the answer decides whether a single `abort()` can produce both `'stopped'` and `'aborted'` in one run. Record it as a question for the next pin verification, not as a finding.

<!-- anchor: go2eocks -->
### 16. A01 — e2e coverage (L5) (`a01e2ecv`): the row's status

Three columns (`Scenario | Owning module | Status`). From `✅ covered` to `⚠️ partial`, worded the way the `subagents` row already words its missing leg:

> | `abort` | M13 | ⚠️ partial — abort mid-stream is covered; the subagent leg (a run-level termination with a subagent in flight closes the lifecycle pair, exactly once) is not implemented yet |

<!-- anchor: 0kb4wekz -->
### 17. A03 — Edge cases (`d9ugsejh`): the opencode mechanism

Extends the existing abort bullet — currently *"`timeoutMs` / `abort()` → `AdapterTimeoutError` / `AdapterAbortError` (runtime phase); the spawned server is always closed in `finally`"* — rather than sitting apart from it. Nothing here corrects A03, and no coverage row is added (see step 5):

> - …with a `task` subagent in flight, the tracked `subagentTaskId` is closed with a synthesized `subagent_completed` (`status: 'aborted'`) before the stream ends. Because attribution here is ordering-based under a single-active assumption (see Event mapping above), the flush closes exactly the one subagent the adapter was tracking — a nested or concurrent `task` was never opened as its own pair, so there is nothing to close and nothing is claimed about it.

<!-- anchor: ikzt5bgv -->
### 18. A04 — Edge cases (`99avio4b`): the gemini mapping **and** the flush

**Two bullets in v6, not one.** v5 specified only the flush, hung off the main agent's `agent_end` `reason: 'aborted'`. That misses the defect: on a subagent thread, gemini today maps `agent_end` to `'failed'` only when `reason === 'failed'` and to `'completed'` otherwise — so an aborted thread is reported as a **success**, and it is removed from the active set at the same moment, leaving the flush nothing to close. The flush alone would change nothing on the path that matters.

> - A subagent thread's `agent_end` maps by `reason`: `'failed'` → `'failed'`, `'aborted'` → `'aborted'`, otherwise `'completed'`. The reason is native here, so the abort case is reported rather than inferred — reporting it as `'completed'` would claim a success the adapter can see did not happen (M06 — <section_ref anchor="0f6287ae"/>).
> - `abort()` / `timeoutMs` with subagent threads in flight → on the run's `agent_end` `reason: 'aborted'`, each thread still in the active set is closed with a synthesized `subagent_completed` (`status: 'aborted'`) before the stream ends (M06 — <section_ref anchor="4b8iv50p"/>). This is the backstop for threads that never receive their own `agent_end`; a thread that did is already closed and is not closed twice.

<!-- anchor: 403cxvea -->
## Why B, recorded

Kept as the rationale of record now that the decision is made. M17's own reasoning is the argument: that module exists because a consumer waiting for an event that never arrives is the failure mode worth spending a whole module on, and it binds *the library's own helpers* to the rule ("`takeUntilResult()` and the conformance suite included"). The asymmetry between the two families has a principled basis rather than a stylistic one: the engine alone can report a background completion; the adapter alone can report a subagent's end.

**One argument for B is withdrawn as false, and the honest version is weaker.** v5 claimed `splitBySubagent` (M09) counts `subagent_started` against `subagent_completed` and would therefore hang on an aborted run. It does not: it partitions a stream and returns once the stream ends, so it cannot hang, and M09 claims nothing more than partitioning. So this family has **no shipped helper** that commits M17's canonical bug — the exposure is a hand-rolled consumer pairing lifecycle events live, which is a real but smaller claim than "our own helper breaks". Recording the weaker version matters because the false one was heading verbatim into M06's Edge cases, where nothing would ever have re-checked it. It also settles a placement question by disappearing: had the claim been true, it would have belonged in M09, not M06, and this plan edits neither.

**Where B stays honestly limited.** The guarantee is not uniform across the matrix — full on claude-code and gemini, single-subagent on opencode, vacuous on codex. That is degradation by the book, and it is why AC 1 is worded over *what the adapter has open*.

**The alternatives, recorded and closed.** *A* (terminal `error` closes the pairs, no adapter work) was the honest interim if the adapter work could not be scheduled; A → B would have stayed additive. *B-minus* (flush reusing `'completed'`) lost its only advantage once `'aborted'` was known to cost nothing at the type level, leaving just the defect — and gemini ships that defect today, which is what step 18 fixes. *The three-member set* (SDK `'stopped'` folded into `'aborted'`) was rejected on M13's stay-apart discipline alone, the other two arguments having failed. *A fifth `'unknown'` member* was rejected as the fallback in favour of the ordered mapping.

<!-- anchor: d5mtxh63 -->
## Explicitly out of scope

- **`src/` — untouched.** The code this implies — the flush in claude-code, gemini and opencode, claude-code's status mapping replacing the pass-through at :1907, gemini's per-thread reason mapping at :798, and the two `shared.ts` assertions — flows through a release brief to the implementer, downstream of this spec edit.
- **Tightening `types.ts` `status: string` into a union.** A separate, later decision, and a major if taken (reads stay safe; code that *constructs* a `UnifiedEvent` — fixtures, mocks, replay harnesses — would newly fail to typecheck). Every edit in this plan is compatible with the field staying `string`.
- **Surfacing `Query.stopTask()` as a consumer-facing lever.** M17's L3 reserves it; step 2 only reserves the *value* its use would produce.
- **An M09 note on `splitBySubagent`'s pairing behavior.** The claim that made one seem necessary was false, so there is nothing to record. If M09 later gains a helper that *does* pair lifecycle events, the note is owed there, not in M06.
- **An A02 edit.** A02 already documents subagents as unsupported with a warning and no lifecycle events; only its L2 cell in *M06's* matrix is wrong, and step 5 fixes it there.
- **An `e2e coverage` section for A02 / A03 / A04.** None of the three has one. Creating that shape for them is a real and possibly worthwhile change to the adapter template, but it is a structural decision about the adapter artifact kind, not a consequence of this rule.
- **index.md's Key relations diagram.** It does not gain the new M06 → M13 edge. The diagram is already not a strict mirror of the Dependencies tables (M06's M09 row is missing from it too), so adding one edge would be a partial fix to a separate drift.

<!-- anchor: vn2kdqul -->
## What is settled and what leaves this plan

Settled: the owning module (M06), the flush (B), the vocabulary (closed, four members, field stays `string`), the mapping (ordered — cancellation-shaped → `'aborted'`, otherwise `'failed'` + one `warning` per run), the pairing invariant (at most one completion per start), the scope of "run-level termination" (abort, timeout **and** hold-cap expiry), and the three-way placement split. The eighteen steps can be applied in order.

Three things deliberately leave this plan rather than being resolved inside it:

- The **release brief** carrying the `types.ts` JSDoc, the three adapters' code changes and the two `shared.ts` assertions to the implementer.
- The **`⚠️ partial` coverage row** from step 16, which the e2e leg closes when it lands.
- The **open probe** from step 15 — whether `Query.interrupt()` settles in-flight tasks as `'stopped'`. If it does, a single `abort()` can produce both `'stopped'` and `'aborted'` in one run, and step 2's discriminator needs a sentence. The answer comes from a pin verification, not from this plan.
