---
type: plan
title: M17 hold cap re-arms on tracked-subagent lifecycle
created_at: '2026-09-23T13:56:09.630Z'
created_by: agent
applied: true
---
# M17 hold cap re-arms on tracked-subagent lifecycle

<!-- anchor: 1p8zskck -->
## Intent

Read as: the control-channel hold holds for two kinds of work, but its hard cap only listens
to one of them. A backgrounded subagent that is visibly working — emitting `subagent_progress`
against a live run — is cut at the cap with a terminal hold-expiry error, because nothing in the
cap's re-arm vocabulary belongs to a subagent. You want the cap's vocabulary to match what the
hold actually tracks. A silent held subagent and a backgrounded `sleep 3600` are still cut;
`subagentTimeoutMs` stays the per-subagent cap. Confirmed by a real consumer incident at
`claude_backgroundHoldCapMs=300000`.

**This is not a widening of a consistent rule — it is the removal of a contradiction the spec
already carries.** Two sentences already say a subagent re-arms this cap:

- M17 `q9u5sbot`, "Deciding whether to hold": *"A `taskId` that has already been marked finished
  and then sees a second `task_started` **re-enters** the set and **re-arms both bounds**"* — and a
  re-entry that re-uses its `task_id` is, per A01 `mn3ytsj4`, a **subagent** re-entry.
- A01 `677rc2wh`: *"the entry re-enters the in-flight set, both hold bounds re-arm"* — in the same
  file whose `sw3cwrsm` says the cap moves on the `background_task_*` family *"and by nothing else"*.

So M17 and A01 each contradict themselves today, two bullets apart. Three active criteria
(`ac-a-settled-taskid-that-sees-a-second-t`, `ac-a-taskid-re-entering-the-in-flight-se`,
`ac-a-taskid-re-entering-the-in-flight-se-2`) assert the re-entry side, so the narrow rule is the
half that is already falsified by the spec's own acceptance criteria.

This is an **inconsistency report** (plan workflow, Step 3). Both sides were read; so were M13,
M12 and the acceptance-criteria set, which v1 had not reached.

<!-- anchor: cdqu39i3 -->
## How to read the quotes in this plan

Every `<section_ref anchor="…"/>` appearing inside a **Today** or **Proposed** block is *page text*,
to be written to the page exactly as printed — **unbackticked**. It is not a reference belonging to
this plan. v1 printed several of them inside backticks; copied literally, that would have written
four embeds that render as code instead of chips.

<!-- anchor: i4e0us8q -->
## What the specification says today

| Address | What it says |
| --- | --- |
| M17 `01or0cpk` — control-channel hold bullet | The hold is kept open "for background work *or* for a subagent that outlives the turn" |
| M17 `01or0cpk` — `backgroundTasks` bullet | "Subagents *do* hold the session — that is the control-channel hold's job, and it holds for both kinds" |
| M17 `q9u5sbot` — cap bullet | The cap is "re-armed by every `background_task_started` / `_progress` / `_completed` belonging to a task the adapter tracks" — subagent events absent |
| M17 `q9u5sbot` — "Deciding whether to hold" | A re-entering `taskId` "re-arms both bounds" — **contradicts the bullet above** |
| M17 `q9u5sbot` — "cap re-arms, not a heartbeat" | "a backgrounded `sleep 3600` … is still cut at the cap, while a build reporting progress for twenty minutes is not" |
| M17 `52ymvppn` — Hold-bound levers | "the cap is silence **from a tracked task** while something is still unsettled" |
| M01 `8do90d06` — six clocks | The hard cap "is re-armed by the tracked task's own lifecycle events"; the enumeration of closed vocabularies **already lists both** "the lifecycle events of that one subagent, the lifecycle events of that one background task"; and the gate "A bound may rest only on a signal whose per-adapter inequality some capability matrix already declares" **already names both matrices** (M06 `1zx424gy`, M17 `ujhcafnf`) |
| M06 `4b8iv50p` — `subagentTimeoutMs` bullet | Already states the whole rule for the sibling cap: "returned to its full value by that subagent's own lifecycle events — its `subagent_started`, a re-entry's `resumed: true` start included, and every `subagent_progress` carrying its `taskId`", and "What re-arms it is a closed vocabulary … because subagent lifecycle is a signal whose per-adapter inequality is already declared" |
| M06 `1zx424gy` — Subagent support matrix | "canonical home — adapters link here"; declares the per-adapter inequality of subagent lifecycle (`✅ native task_*` / `⚠️ synthesized`) |
| A01 `sw3cwrsm` — "Holding is not reporting" | "The tracked set drives the **hold** for both kinds — a subagent holds the session exactly as a backgrounded command does" |
| A01 `sw3cwrsm` — hold-bounds bullet | cap "re-armed by every `task_started` / `task_progress` / `task_notification` … routed into a tracked task's `background_task_*` family and by nothing else" |
| A01 `677rc2wh` | "the engine's background work stalled and is abandoned unfinished" |
| M13 `8q9q7ty7` | "a hold-cap expiry says the *engine's* background work stalled and some of it was abandoned unfinished" |
| M12 `agvf1tok` | The behavioral-hardening rule: a change that "alters runtime behavior a consumer already relies on" without moving a signature ships **minor with an explicit CHANGELOG note** |
| `index.md` `vancl72m` | Already declares the edge: "M06 Subagents ── re-entry holds via ──> M17 Background tasks (a resumed subagent re-enters the in-flight set; the hold re-arms)" |

**The contradiction, in the spec's own terms.** The hold tracks two kinds of unit; the cap's stated
vocabulary bounds one, while two other sentences in the same two files already move it on the
second. The intended rule satisfies M01's gate on re-arm signals without amending it: subagent
lifecycle carries a declared capability-matrix row, which M01 already cites.

<!-- anchor: 3ywkc77r -->
## The decision this plan rests on — rule 2, one fact one home

The cap's re-arm vocabulary is enumerated in four places today. Rather than widen all four in
parallel (v1's shape, which makes every future extension a four-way synchronized edit), **M17
`q9u5sbot` becomes the canonical home** — the pattern the spec already uses at M06 `1zx424gy`
("canonical home — adapters link here"). M01, M06 and A01 stop enumerating the families and point
here, keeping only what is genuinely theirs: M01 the clock taxonomy, M06 the sibling cap, A01 the
SDK-frame routing and the 90s constant.

This is why entries 5–7 are *smaller* than v1's: three of them shrink text rather than adding it.

<!-- anchor: r0gfgdfz -->
## Entries, in execution order

<!-- anchor: 4zmegmzr -->
### 1. M17 — the cap bullet (canonical home + the normative rule)

- **Address:** `modules/M17-background-tasks.md`, `q9u5sbot` (Edge cases), the "Work that never
  settles / a wake-up that never arrives" bullet, its `cap` sub-bullet.
- **Placement:** no layer schema asks for it — edge cases are one of the module's three
  fixed-subject sections (`Cel`, edge cases, acceptance criteria), so it stays where it is. Rule 2
  decides the *canonical-home* half.
- **Today:**

  > a hard **cap** on unsettled work, for a task that is still running and may never finish. It is **re-armed by every `background_task_started` / `_progress` / `_completed` belonging to a task the adapter tracks**, and expires only after that many milliseconds in which no such event arrived while something was still unsettled.

- **Proposed:**

  > a hard **cap** on unsettled work, for a unit that is still running and may never finish. **What re-arms it is stated here and nowhere else; M01, M06 and A01 point at this bullet rather than restating the list.** It is **re-armed by the lifecycle events of any unit the hold tracks** — every `background_task_started` / `_progress` / `_completed` of a background task the adapter tracks, and every `subagent_started` / `subagent_progress` / `subagent_completed` of a subagent it tracks (M06 — <section_ref anchor="0f6287ae"/>), a re-entry's `resumed: true` start included — and expires only after that many milliseconds in which no such event arrived while something was still unsettled. The hold holds for both kinds (<section_ref anchor="01or0cpk"/>), so the cap listens to both: a bound that heard only one of them would cut a held subagent that was visibly working.

- **Unchanged, deliberately:** the next two sentences — the transport-frame exclusion and the
  release-on-continuation clause — stay exactly as written.

<!-- anchor: jjjb1dxe -->
### 2. M17 — "The cap re-arms, and that does not make it a heartbeat"

- **Address:** same page, `q9u5sbot`, the bullet of that name.
- **Edit A — Today:**

  > What moves this cap is a **closed vocabulary attached to one unit of work** — the `background_task_*` family of a task this adapter is tracking, whose per-adapter inequality *is* declared (<section_ref anchor="ujhcafnf"/>).

  **Proposed:**

  > What moves this cap is a **closed vocabulary attached to one unit of work** — the `background_task_*` family of a task this adapter is tracking, whose per-adapter inequality *is* declared (<section_ref anchor="ujhcafnf"/>), and the `subagent_*` family of a subagent it is tracking, whose inequality is declared just as plainly (M06 — <section_ref anchor="1zx424gy"/>). Two families, one rule: each event belongs to one named unit the hold is waiting on, and neither family is the stream at large.

- **Edit B — Today** (append to the discriminating example, same sentence's register):

  > a backgrounded `sleep 3600` says nothing about itself and is still cut at the cap, while a build reporting progress for twenty minutes is not, because the first is merely present and the second is visibly working.

  **Append:**

  > The same line runs through held subagents: one emitting `subagent_progress` keeps re-arming the bound for as long as it reports, while one that has gone silent is cut exactly like the `sleep`.

  (v1 wrote "is never cut by this bound", which overstates — a subagent that reports and then falls
  silent *is* cut. The bound is on silence, not on having once spoken.)

<!-- anchor: 8t3z88mo -->
### 3. M17 — "Deciding whether to hold": no edit, stated out loud

- **Address:** same page, `q9u5sbot`, the re-entry sentence.
- **No change.** It already says a re-entering `taskId` re-arms both bounds, and after entries 1–2
  it stops contradicting the cap bullet. The apply turn **says this in its summary** rather than
  touching it: it is the evidence the change is a repair, and rewriting it would erase that.

<!-- anchor: lk2rambk -->
### 4. M17 — Hold-bound levers

- **Address:** `modules/M17-background-tasks.md`, `52ymvppn` (Configuration & Extensibility L3).
- **Schema field:** L3's `## Module slice schema`, capability-module bullet — the `architectureConfig`
  keys the module declares, *"ArchOption: key name, type, default, validation"*. The edit stays inside
  the prose for `claude_backgroundHoldCapMs` and adds no key, so the ArchOption entry itself is
  untouched.
- **Today:**

  > grace is engine silence once everything tracked has settled, the cap is silence **from a tracked task** while something is still unsettled. Neither is the length of the parked stretch — a task that keeps reporting extends that stretch without limit and neither bound objects.

  **Proposed:**

  > grace is engine silence once everything tracked has settled, the cap is silence **from the tracked unit** — a background task or a held subagent alike — while something is still unsettled. Neither is the length of the parked stretch — a tracked unit that keeps reporting extends that stretch without limit and neither bound objects.

<!-- anchor: 0mhayrnl -->
### 5. M01 — the six-clocks paragraph (one clause, not two edits)

- **Address:** `modules/M01-unified-core.md`, `8do90d06` (Unified Contract L1 — implementor).
- **Schema field:** L1's `## Module slice schema`, implementor bullet — *"in how-mode: what each
  variant means and which invariants hold across all adapters"*. The six-clock taxonomy is exactly
  that invariant; the edit does not add a variant.
- **Today:**

  > The hold's **hard cap** is armed at a held `result`, bounds the parked stretch, is re-armed by the tracked task's own lifecycle events, and its expiry is a terminal error; both of those belong to M17 (<section_ref anchor="q9u5sbot"/>).

  **Proposed:**

  > The hold's **hard cap** is armed at a held `result`, bounds the parked stretch, is re-armed by the tracked unit's own lifecycle events — a background task's or a held subagent's alike — and its expiry is a terminal error; both of those belong to M17 (<section_ref anchor="q9u5sbot"/>).

- **v1's Edit B is dropped.** It proposed appending to the closed-vocabulary enumeration. That
  enumeration — *"the matching `tool_result` for that call, the lifecycle events of that one subagent,
  the lifecycle events of that one background task"* — **already lists both**, because it enumerates
  the vocabularies of all six clocks, not of the hold cap alone. Appending "and for the hold's cap,
  whichever of those two" would restate here what entry 1 makes canonical in M17, which is the
  duplication this plan is removing. The trailing pointer to `q9u5sbot` already carries the reader.
- **Untouched:** the capability-matrix gate sentence already names both matrices and licenses the
  rule as written. The apply turn **says so in its summary** instead of re-touching it.

<!-- anchor: bgbs0eji -->
### 6. M06 — the `subagentTimeoutMs` bullet (one clause, pointer only)

- **Address:** `modules/M06-subagents.md`, `4b8iv50p` (Edge cases), the `subagentTimeoutMs` bullet.
- **Today** (note: **not bold** in the source — v1 quoted it bolded, and an exact-string edit built
  on that quote would fail):

  > Absent, no subagent carries a cap and an open one is bounded by `timeoutMs`, the hold cap or `abort()` alone.

  **Proposed:**

  > Absent, no subagent carries a cap and an open one is bounded by `timeoutMs`, the hold cap or `abort()` alone — and the hold cap bounds that subagent's *silence*, not its length, on the same closed-vocabulary rule as this one (M17 — <section_ref anchor="q9u5sbot"/>).

- **Why this is shorter than v1.** v1 restated that the subagent's lifecycle events re-arm the hold
  cap "exactly as they re-arm `subagentTimeoutMs`". Two problems: the sentence two lines above
  already states the re-arm rule and its matrix citation in full, so the restatement is the
  duplication rule 2 forbids; and "exactly" is false — M06's list for `subagentTimeoutMs` is
  `subagent_started` / `resumed: true` / `subagent_progress`, while the hold cap's list also carries
  `subagent_completed` (one subagent finishing while another is still unsettled re-arms the hold).
- **Unchanged:** `subagentTimeoutMs` remains the per-subagent cap; the four-trigger list and the
  synthesized `subagent_completed { status: 'aborted' }` path are untouched.

<!-- anchor: ttejfef6 -->
### 7. A01 — the hold-cap lines

- **Address:** `adapters/A01-claude-code.md`, `sw3cwrsm` (Per-capability consumption). L3's slice
  schema puts adapter-consumed keys here by name — *"an adapter documents the keys it consumes
  inline in `## Per-capability consumption`"* — so this is the right home and no L3 section is owed.
- **Edit A — Today:**

  > The cap default is **90s**, and what it bounds is a stretch in which a tracked task said nothing at all — a task that reports progress re-arms it, so the constant is sized against a *silent* task rather than against a long one.

  **Proposed:**

  > The cap default is **90s**, and what it bounds is a stretch in which nothing the hold tracks said anything at all — progress from either family re-arms it, so the constant is sized against a *silent* unit rather than against a long one.

- **Edit B — Today:**

  > a **cap** on silence from the tracked work, re-armed by every `task_started` / `task_progress` / `task_notification` the adapter routes into a tracked task's `background_task_*` family and by nothing else

  **Proposed:**

  > a **cap** on silence from the tracked work, re-armed by every `task_started` / `task_progress` / `task_notification` the adapter routes into a tracked unit's family — `background_task_*` or `subagent_*`, by the `task_type` map above — and by nothing else, the vocabulary itself being M17's (<section_ref anchor="q9u5sbot"/>)

  The `task_type` split is not asserted here from memory: this same section already specifies it
  (*"`task_type` capture & routing"*), and M06 `70dpqgcb` fixes it as the module boundary. The
  following clause about `system/status` / `background_tasks_changed` moving the grace stays.

<!-- anchor: eiep70ed -->
### 8. A01 — the hold-cap edge case

- **Address:** `adapters/A01-claude-code.md`, `677rc2wh` (Edge cases), the hold-cap bullet.
- **Today:**

  > the budget was not too small and nobody aborted — the engine's background work stalled and is abandoned unfinished

  **Proposed:**

  > the budget was not too small and nobody aborted — the engine's tracked work stalled and is abandoned unfinished

- v1 did not reach this line. It is the same narrowing as M13's, in the adapter that ships the bound.

<!-- anchor: c5jw96lt -->
### 9. M13 — the error's own prose

- **Address:** `modules/M13-errors-resilience.md`, `8q9q7ty7` (Unified Contract L1), the
  "Every terminal condition gets its own class" bullet.
- **Schema field:** L1's capability-module bullet — the payload variants the module contributes,
  *"each stated with the guarantee that field carries"*.
- **Today:**

  > a hold-cap expiry says the *engine's* background work stalled and some of it was abandoned unfinished

  **Proposed:**

  > a hold-cap expiry says the *engine's* tracked work — a background task or a held subagent — stalled and some of it was abandoned unfinished

- **This is the only sentence in M13 that needs to move.** The rest of the module already speaks of
  "the control-channel hold's hard cap" in neutral terms, and
  `ac-adapterbackgroundholdexpirederror-nam` asserts only that the error names its config key, which
  stays true. The class name does not change.
- **Also:** add a row to M13's `## Dependencies` table — `M17 | Arms and expires the control-channel
  hold's cap; this module owns the class its expiry raises (<section_ref anchor="q9u5sbot"/>).` M13
  cites `q9u5sbot` twice and declares no edge to M17. A pre-existing gap, closed here because this
  plan edits the very sentence that leans on it. (`module-dependency` is **not an active type** in
  this project — dependencies are table rows, so this is a page edit, not an entity write.)

<!-- anchor: scuv1bcv -->
### 10. M12 — the semver category

- **Address:** `modules/M12-conformance-release.md`, `agvf1tok` (Public API & Packaging L4), the
  worked case "the run-bound additions are a minor, and one of them still owes a note" — which
  already names "a hold cap that now re-arms".
- **Append to that bullet:**

  > Widening what re-arms that cap to a held subagent's own lifecycle (M17 — <section_ref anchor="q9u5sbot"/>) rides the behavioral-hardening rule from the other side: nothing is renamed, no signature moves, and a consumer setting no new field sees a *longer*-lived run rather than a different API — but a held subagent that used to be cut at the cap while visibly working now runs on, so it ships **minor with a CHANGELOG note** naming the widened vocabulary.

- **Why this entry exists at all:** M12 owns "a surface that keeps its name and its type while its
  meaning changes", and this change is exactly that shape. Leaving it unstated would ship a
  behavioural change to a lever consumers tune, with no note. v1 did not reach M12.
- **Owed before writing:** read `layers/L4-public-api-packaging.md` `## Module slice schema` and name
  the field this bullet answers, the way entries 4–7 do. Not read in this turn.

<!-- anchor: 32qhcajh -->
### 11. Acceptance criteria — mirror, do not amend

v1 amended `ac-a-parked-stretch-in-which-no-backgrou` to speak of "any tracked unit". **Reversed.**
The existing pair states the background half and stays literally true after this change; a criterion
states one observable thing, and a generic "any tracked unit" phrasing is harder to verify than two
concrete ones. The spec's existing shape is a pair, so the change adds the matching pair.

- **Unchanged:** `<inline_mention type="ac" slug="ac-a-background-task-emitting-background"/>` and
  `<inline_mention type="ac" slug="ac-a-parked-stretch-in-which-no-backgrou"/>` — both remain
  accurate, and their historical slugs stay put. (`slug` is absent from the type's `updateSchema`,
  so it is immutable after creation and a title change could never have re-slugged them; v1's
  concern was unfounded either way.)

- **Create** — the progress twin:

  > A held subagent emitting subagent_progress re-arms the hold cap and is never cut short by it.

  `kind: requirement`, `status: active`, `tags: ["m17"]`. Mirrors
  `ac-a-background-task-emitting-background` word for word in shape. The "and" is the twin's own
  phrasing and is one observable thing — the non-cutting *is* the re-arm's consequence.

- **Create** — the silence twin (the gap the sweep confirmed: no criterion today says a silent held
  subagent is cut):

  > A parked stretch in which no subagent_* event arrives for a tracked held subagent ends at the cap with AdapterBackgroundHoldExpiredError.

  `kind: edge-case`, `status: active`, `tags: ["m17", "m17-edge"]`.

- **Create, recommended** — the conjunction neither pair states:

  > A parked stretch in which one tracked unit stays silent while another keeps reporting does not end at the cap.

  `kind: edge-case`, `status: active`, `tags: ["m17", "m17-edge"]`. This is the one observable the
  two pairs cannot express separately, and it is the behaviour the consumer incident actually hit.

- `tags` is a field of `createSchema`, so all three are created tagged in one call — no separate
  `tag_entity`. M17 `02okhxqj` carries `<tagged_list type="ac" tags="m17"/>` and
  `<tagged_list type="ac" tags="m17-edge"/>`, so the new criteria surface with **no page edit**.

<!-- anchor: pgfow7lb -->
## Checks the apply turn owes

1. **No dependency-entity work exists to do.** `module-dependency` is not an active type here;
   `describe_entity_type` reports `ac` as the only active type. M17's `## Dependencies` table already
   carries an M06 row ("Sibling family"), and `index.md` `vancl72m` already declares the M06→M17
   edge. The only dependency work in this plan is the M13 table row in entry 9.
2. **Read `layers/L4-public-api-packaging.md` `## Module slice schema`** before entry 10 and name the
   field, as entries 4–7 do for L1 and L3.
3. **Re-read M17's `Cel`** (`c9orks2t`) after entry 1: "it is not a subagent (M06 …)" defines what a
   *background task* is, not what the *hold* bounds, so it should still read true. Confirm rather
   than assume.
4. **Write `<section_ref/>` unbackticked** in every Proposed block — see "How to read the quotes".
5. **Carry `expectedHash` per page** — six are touched: M17, M01, M06, A01, M13, M12.
6. **`check_consistency`** after the writes, for the new `section_ref` targets (`0f6287ae`,
   `1zx424gy`, `q9u5sbot`).

<!-- anchor: skfuvsxn -->
## Seen, not planned

- **Three re-entry criteria stay as written.** `ac-a-settled-taskid-that-sees-a-second-t`,
  `ac-a-taskid-re-entering-the-in-flight-se` and `-se-2` speak of a `taskId` re-entering the
  in-flight set. In this adapter a held subagent's id *is* that `taskId`, so all three are already
  true of subagents and need no edit; spelling "or subagentTaskId" into them is a legibility pass of
  its own, not part of this repair.
- **M13's `## Dependencies` still lacks an M06 row, and M06's lacks M13** — after this change a
  silent held subagent (M06) raises an M13 class through M17's cap. The chain M06→M17→M13 is
  declared at every hop, so nothing dangles, but neither table names the far end. Pre-existing.
- **A01 `sw3cwrsm` states the cap default as 90s** while the reported incident ran at
  `claude_backgroundHoldCapMs=300000`. A consumer-set lever value, not a contradiction — but if 90s
  is stale against what the adapter ships, that is a separate edit.
- **M17 `q9u5sbot` names the cap's error only as "a typed hold-expiry error (M13 — `8q9q7ty7`)"**
  while the criteria and A01 both spell `AdapterBackgroundHoldExpiredError`. Consistent, and the
  class name deliberately lives in one place; noted so a future reader does not "fix" it.
- **M06 `4b8iv50p` notes the deliberate asymmetry with M17** — no `background_task_completed` owed
  after termination, but a synthesized `subagent_completed` is. Untouched, and it explains why the
  two families can share one cap without sharing their termination contracts.
