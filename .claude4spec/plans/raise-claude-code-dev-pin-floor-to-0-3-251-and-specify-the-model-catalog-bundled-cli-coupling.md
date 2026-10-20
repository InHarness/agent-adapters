---
type: plan
title: >-
  Raise claude-code dev-pin floor to 0.3.251 and specify the model-catalog /
  bundled-CLI coupling
created_at: '2026-09-07T15:34:52.220Z'
created_by: agent
applied: false
---
# Raise claude-code dev-pin floor to 0.3.251 and specify the model-catalog / bundled-CLI coupling

<!-- anchor: xhfoe3ii -->
## Context

Reported drift: the dev-pin floor in `adapters/A01-claude-code.md` <section_ref anchor="49zu34oc"/> reads *latest 0.3.x at brief time, minimum `^0.3.210`*, while the model catalog <section_ref anchor="9gu9zp7z"/> ships the alias `fable-5.1` → `claude-fable-5-1`. The Claude Code CLI bundled in SDK 0.3.210/0.3.220 rejects that resolved id with `API Error: 400 Claude Code 2.1.220 does not support this model; version 2.1.251 or newer is required`.

Evidence supplied by the reporter (published tarballs unpacked): SDK `0.3.N` bundles CLI `2.1.N` — verified for 0.3.220 → 2.1.220, 0.3.251 → 2.1.251, 0.3.263 → 2.1.263. Therefore the real floor is `0.3.251`, and the latest 0.3.x at planning time is `0.3.263`.

The underlying gap is not the number. It is that **the model catalog is canon over an alias whose usability depends on a version stated in a different file**, and nothing in the spec says the two are coupled. Raising the number without stating the rule leaves the same drift free to recur on the next model release.

Owning slices: <section_ref anchor="49zu34oc"/> (A01's L7 slice — the floor and the log), <section_ref anchor="d0npth7e"/> (the L7 slice schema — what every consumer's L7 section must state), <section_ref anchor="9rpzxpiw"/> (M02 — catalog canon), <section_ref anchor="agvf1tok"/> (M12 — the spec-first bump workflow).

<!-- anchor: hwok3gkx -->
## Decision required before step 1

**Is the bundled-CLI model gate an out-of-range hard fault or in-range degradation?**

<section_ref anchor="d0npth7e"/> declares *declared range == verified range* and two regimes: outside the declared range is a non-suppressible init `error`; inside it, defensive reads plus L2 degradation. A01 currently declares `>=0.3.0 <0.4.0`. With the coupling stated, the catalog promises an alias that the low end of the declared range cannot serve — a consumer on 0.3.153 resolving `fable-5.1` gets a 400 from the engine, not an init error and not a degraded run.

Two coherent answers, and the plan below writes only the floor until one is chosen:

- **(A) Dev-pin only.** The declared range stays `>=0.3.0 <0.4.0`; only the dev-pin floor moves to `^0.3.251`. Consequence: the spec must say that alias availability is *not* uniform across the declared range, i.e. the model catalog is canon over *ids*, not over *reachability on every in-range SDK*. This is the smaller edit and the honest description of today's code.
- **(B) Narrow the declared range** to `>=0.3.251 <0.4.0`, making the version gate refuse the SDKs on which the newest aliases are unusable. This is a semver-significant `peerDependencies` narrowing owned by M12 <section_ref anchor="agvf1tok"/> and is breaking for consumers pinned below it — a release-brief decision, not a quiet edit.

The steps below are written for **(A)**, which is the minimal reading of the report. If the user picks (B), step 2 also rewrites the *Supported peer-SDK range* bullet and step 5 grows a second AC about the gate.

<!-- anchor: 0r3z2q49 -->
## Steps

1. **Confirm the decision above** with the user, plus the two smaller calls in step 4 (what happens to the superseded `0.3.210` pending row) and step 6 (whether M12 gains the new bump trigger). No page is touched until these are answered — the floor number is settled, its consequences are not.

2. **A01 <section_ref anchor="49zu34oc"/> — raise the floor and state the coupling.** Two edits inside the *Supported peer-SDK range* bullet:
   - `minimum ^0.3.210` → `minimum ^0.3.251`, and the justification sentence changes with it: the reason is no longer "consumers already run 0.3.210", it is that the bundled CLI below 2.1.251 refuses the catalog's newest resolved ids. Keep the existing clause that the exact pin is the implementer's resolution at bump time; name `0.3.263` as the latest 0.3.x at brief time.
   - Add one new bullet — **Bundled-CLI coupling** — immediately after the range bullet, stating the mechanism as a fact of this SDK: the `@anthropic-ai/claude-agent-sdk` tarball ships a Claude Code CLI executable whose version tracks the SDK's patch (`0.3.N` bundles `2.1.N`, verified by unpacking 0.3.220 / 0.3.251 / 0.3.263), the CLI validates the model id before the request leaves the machine, and an unrecognised id comes back as `API Error: 400 … version 2.1.251 or newer is required` — a runtime 400, not an init fault. Record the concrete case: `claude-fable-5-1` requires CLI ≥ 2.1.251, hence SDK ≥ 0.3.251. The bullet records **one** floor — the newest alias's — rather than a per-alias table: the older 1M aliases (`claude-fable-5`, `claude-sonnet-5`, `claude-opus-5`) have been in the catalog long enough that a floor above 2.1.220 would already have surfaced as a 400 in use, so the newest alias is the binding one and a per-alias column would be mostly empty. If a future run contradicts that, the bullet grows the exception rather than the table.
   This bullet is the **one home** for the mechanism. M02 and L7 point at it; neither restates it.

3. **L7 <section_ref anchor="d0npth7e"/> — make the floor check a schema requirement, generically.** The layer file is thin and owns rules about *filling* a consumer's L7 section, so the rule enters as a requirement on an existing field rather than as new prose. Extend the **Known schema-drift points** bullet (or add one field-level clause to **Supported peer-SDK range**, whichever reads cleaner against the neighbouring bullets at edit time) with: a consumer whose peer-SDK *bundles an executable runtime* states that coupling and the version relation between the two, because the runtime — not the SDK's TypeScript surface — is what validates model ids and tool names; where such a coupling exists, a change to the model catalog is a trigger for re-checking this consumer's dev-pin floor. No claude-code specifics here: A02/A03/A04 fill the same schema and the layer must stay true if A01 were deleted.

4. **A01 <section_ref anchor="49zu34oc"/> — the verified-pin log.** The log is append-only and its newest row's dev-pin must equal the pin named in the range bullet, so the bump is two row operations, not one:
   - The existing `| — | 0.3.210 | targeted live probes only — full suite pending verification |` row **stays** (append-only), but it is now superseded before its suite ever ran. Its `findings` cell is amended to say so honestly — the probe results it records remain valid, the full-suite run is abandoned rather than pending. *This is the decision flagged in step 1: the alternative is to leave it marked pending, which would leave two rows claiming an in-flight bump.*
   - **Append a new newest row**: date `—`; dev-pin `^0.3.251` (matching the range bullet exactly — the implementer replaces it with the exact resolved pin, expected `0.3.263`); verified by `targeted evidence only — full suite pending verification`; findings carrying the tarball evidence (`0.3.N` bundles CLI `2.1.N`, checked on 0.3.220/0.3.251/0.3.263) and the observed 400 on 2.1.220 for `claude-fable-5-1`.
   - **How the row gets completed is already specified** and this plan adds no new mechanism: <section_ref anchor="agvf1tok"/> owns the spec-first order — spec edit first, release brief carries the bump, the implementer updates `devDependencies`, runs the full `test:e2e:claude:*` suite (× the model scripts, which is where `fable-5.1` gets exercised — and, being parametrized over the catalog, where the older aliases stop being an assumption), and writes date, exact resolved pin and findings back into the pending row through the patch-feedback channel. A row never completed is an unfinished bump. The plan's only job here is to leave the row in the shape that workflow expects.

5. **M02 <section_ref anchor="9rpzxpiw"/> — state the trigger where the catalog is edited.** The canon paragraph already says every new model release is edited here first and propagated to `src/models.ts`. Add one sentence: for architectures whose adapter wraps an SDK that bundles a runtime, an added or changed alias is canon only once that adapter's L7 dev-pin floor is confirmed to accept the resolved id — with a `section_ref` to <section_ref anchor="49zu34oc"/> for the claude-code case. Sentence only: the mechanism lives in A01 per step 2, and restating it here would give one fact two homes.

6. **M12 <section_ref anchor="agvf1tok"/> — name the new bump trigger.** *Peer-SDK bump workflow (spec-first)* currently describes the order but not what starts it. Add a clause naming the catalog as a trigger: a model alias whose resolved id needs a newer bundled runtime forces a dev-pin bump through this same workflow. One clause, no restated mechanism. *Skip this step if the user judges the trigger sufficiently covered by steps 3 and 5 — it is the most duplicative of the six.*

7. **Add one `ac` entity.** Text: *"An alias in the claude-code model catalog whose resolved id the bundled CLI rejects is accompanied by a dev-pin floor at or above the SDK release bundling a CLI that accepts it."* One observable thing; verifiable by reading the catalog against the L7 floor. Tag `m12`, matching its neighbours `ac-a-peer-sdk-dev-pin-bump-appears-in-the-s` and `ac-every-l7-consumer-section-contains-a-ver`, which are the existing pin-invariant criteria; `kind: requirement`. It surfaces automatically in M12's `<tagged_list type="ac" tags="m12"/>`. Confirm the field set with `describe_entity_type("ac")` before writing.

<!-- anchor: jpig8rma -->
## Explicitly not in scope

- **Other `0.3.x` mentions stay.** `pages/modules/M04-mcp-integration.md` <section_ref anchor="wxyessab"/>, `pages/modules/M16-task-tracking.md` <section_ref anchor="ncle4lvp"/> and `pages/modules/M17-background-tasks.md` <section_ref anchor="q9u5sbot"/> cite 0.3.153/0.3.210 as *the pin a behaviour was measured on*, not as a floor. Those are dated observations and remain accurate after the bump.
- **A02/A03/A04 L7 sections** carry their own independent pins for other SDKs and are untouched. Only step 3's generic schema clause reaches them, and it asks them for a statement, not a number.
- **No code, no `package.json`.** The `devDependencies` and `peerDependencies` edits are the implementer's, downstream of a release brief — this plan changes the spec only.

<!-- anchor: vl23mut5 -->
## Open questions

1. The regime question in **Decision required** — dev-pin only (A) or narrow the declared range (B). This is the one that changes what the version gate does.
2. Is `0.3.263` the intended pin for the next brief, or does "latest 0.3.x at brief time" resolve later? Affects only the wording of the new log row, not the floor.
3. *Resolved.* The older 1M aliases are taken to sit below the 2.1.251 floor on **field evidence — absence of reported 400s over their time in the catalog — not a probe**, and the plan writes it that way. L7 requires findings to be recorded honestly, so nothing in the coupling bullet or the log row may read as "verified" for them; the full-suite run in step 4 is what turns the assumption into a finding.
