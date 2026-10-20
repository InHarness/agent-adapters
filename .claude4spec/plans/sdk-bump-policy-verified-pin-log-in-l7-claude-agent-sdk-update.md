---
type: plan
title: SDK bump policy — verified-pin log in L7 + claude-agent-sdk update
created_at: '2026-07-28T15:25:46.035Z'
created_by: agent
---
# SDK bump policy — verified-pin log in L7 + claude-agent-sdk update

<!-- anchor: j5xn6zay -->
## Context & user need

The spec assistant's test bed (this repo) dev-pins `@anthropic-ai/claude-agent-sdk` at `^0.3.153`, while the consuming app (app-spec) already runs `^0.3.210` — a version with a known regression history around `task_*` / background wakeup. Nothing in the spec today records **which exact SDK pin was verified when, and what was found**; the L7 layer records only the *range*. The user wants: (1) the spec to record the SDK version we work against, (2) a changelog of verified versions, (3) a planned bump of the dev-pin — explicitly **without** a multi-version test matrix mechanism.

Version disambiguation (three distinct numbers, never conflated):
- `@inharness-ai/agent-adapters` library: **0.9.1**
- this repo's dev-pinned SDK (what e2e verifies): **^0.3.153**
- app-spec's installed SDK: **^0.3.210**

Existing spec homes (discovered, not invented):
- `layers/L7-sdk-compatibility.md` — owns *declared range == verified range* and the per-consumer slice schema (anchor `qno516sg`, schema at `d0npth7e`).
- `adapters/A01-claude-code.md` → `## SDK compatibility & schema drift (L7)` (anchor `49zu34oc`) — dev-pin currently narrated as `^0.3.153`; e2e coverage section (anchor `a01e2ecv`) repeats the pin.
- `modules/M12-conformance-release.md` — owns semver decisions and the release pipeline (narrowing peerDependencies already routed through M12).
- Pattern precedent: M02 model catalog — *spec is canon, `src/`/`package.json` is a mirror*.

<!-- anchor: skjp187b -->
## Phase 1 — L7 slice schema: add the **Verified-pin log** field

Edit `layers/L7-sdk-compatibility.md`, `## Module slice schema` (anchor `d0npth7e`): add one field to the consumer slice schema (a *filling* rule, so it lives in the schema per the two-disciplines test):

- **Verified-pin log** — a table `| date | dev-pin | verified by | findings |` recording every dev-pin the consumer has actually been verified against (e2e run or documented live use). Rules baked into the field: the newest row **must equal** the current dev-pin named in *Supported peer-SDK range* (same-edit sync, like the index tables); findings are recorded honestly (`none observed` allowed); rows are append-only — history is the point.

No new layer, no new module — this is one schema field on an existing thin layer.

<!-- anchor: cbaeu9dp -->
## Phase 2 — A01: bump narrative + seed the log

Edit `adapters/A01-claude-code.md`, L7 section (anchor `49zu34oc`):

1. Update *Supported peer-SDK range* narrative: dev-pin target becomes **latest 0.3.x at brief time, minimum ^0.3.210** (range stays `>=0.3.0 <0.4.0`; the pin is what moves). Exact final pin is the implementer's resolution at bump time.
2. Seed **Verified-pin log**:
   - `^0.3.153` — verified (current CI/e2e baseline; `local_bash` task_type spelling, empty `background_tasks` report, MCP form-elicitation refusal all measured on this pin).
   - `0.3.210` — observed live in app-spec, **not yet verified here**; known regression history around `task_*` / background wakeup (adapter-side mitigations exist); row completed by the implementer after the bump's e2e run.
3. Same-edit sync: the e2e coverage section (anchor `a01e2ecv`) currently says "Verified against the dev-pinned SDK `^0.3.153`" — rewrite to point at the Verified-pin log instead of hard-coding the pin twice (one-home: the pin lives in the L7 section).

<!-- anchor: zzj7d9mv -->
## Phase 3 — remaining L7 consumers: seed single-row logs

For schema conformance (every consumer fills every schema field), seed a one-row Verified-pin log in:
- `adapters/A02-codex.md` — `^0.120.0`
- `adapters/A03-opencode.md` — `^1.4.6`
- `adapters/A04-gemini.md` — `^0.38.0`
- `modules/M04-mcp-integration.md` — `^1.29.0`

Each row: current dev-pin, `verified by: CI e2e baseline`, `findings: none recorded retroactively`. No pin changes for these — log seeding only.

<!-- anchor: qec3ksns -->
## Phase 4 — M12: the SDK-bump workflow (spec-first)

Edit `modules/M12-conformance-release.md`: add a short **Peer-SDK bump workflow** statement in its release-process area, mirroring the M02 canon rule:

> A peer-SDK dev-pin bump is edited **spec-first**: the consumer's L7 section (pin + Verified-pin log row with `pending verification`) changes first, then a release brief carries the bump; the implementer updates `devDependencies`, runs the full e2e suite for that adapter (`test:e2e:<adapter>` × model scripts where applicable), and writes the findings back into the log row via the patch-feedback channel. No multi-version test matrix — one verified pin at a time.

<!-- anchor: el138sdh -->
## Phase 5 — AC entities (impact-checked)

1. `list_tags` + `list_entities(type: ac)` filtered by the L7/A01/M12 tags to confirm slug/tag conventions before creating anything (protocol: resolve before mutate).
2. Create ~2 `ac` entities (kind `requirement`), tagged per convention, e.g.:
   - "Every L7 consumer section contains a Verified-pin log whose newest row equals the dev-pin named in its Supported peer-SDK range."
   - "A peer-SDK dev-pin bump appears in the spec (L7 pin + log row) before the corresponding `devDependencies` change ships in a release brief."
3. Embed via the module/adapter pages' existing `tagged_list` AC embeds (verify which tags those lists filter on before tagging).

<!-- anchor: x9o1xjrg -->
## Phase 6 — drift check & handoff

1. `check_consistency` after edits; grep spec for stray hard-coded `0.3.153` mentions outside the log (found earlier in `M17-background-tasks.md:78` and A01 task_type note — those are *measurement provenance*, they stay as-is; verify no others read as "current pin").
2. Handoff note: the actual `package.json` bump + e2e run is **implementer work downstream of a release brief** — out of scope for the spec assistant, per CLAUDE.md.

<!-- anchor: 2t74lj62 -->
## Explicitly out of scope

- Multi-SDK-version e2e matrix (user decision: not needed).
- Any edit to `src/`, `package.json`, test configs (brief → implementer pipeline).
- App-spec's subagent behavior (TaskCreate/ToolSearch retry discipline) — belongs to the app-spec peer project, not this spec.
