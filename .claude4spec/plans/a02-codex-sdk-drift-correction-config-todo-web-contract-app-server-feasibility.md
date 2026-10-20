---
type: plan
title: >-
  A02 codex — SDK drift correction, config/todo/web contract, app-server
  feasibility
created_at: '2026-09-22T16:44:14.686Z'
created_by: agent
applied: false
---
# A02 codex — SDK drift correction, config/todo/web contract, app-server feasibility

Read-only plan (2026-09-22). Nothing in the specification or the code is changed by this plan.
Evidence base: code repo `@inharness-ai/agent-adapters` 0.9.11, pinned `@openai/codex-sdk` 0.120.0, registry latest 0.155.1.

<!-- anchor: 3u9ka5jh -->
## Intent (Step 1 of the plan workflow)

Read as: the specification's canon about the Codex adapter has drifted away from the code in two
directions at once. In places canon asserts an **SDK absence** where the pinned SDK in fact has the
primitive and only the adapter does not use it (task tracking, dynamic MCP, config passthrough); in
one place canon asserts an **adapter behaviour** the code deliberately does not have (plan mode
producing a read-only sandbox). The goal is to make canon describe today's code exactly, and to keep
every proposed capability — SDK upgrade, config passthrough, todo/web/schema, app server — visibly
separate from that correction, so nothing reads as approved work.

Three hard constraints carried from the evidence and honoured below:
- **Do not relax M18.** Fail-closed stays until policy composition is proven against a live model.
- **Do not change the billing cumulative→delta behaviour** of M08/A02 on this round.
- **Do not promise app-server production support**; the upstream docs call it experimental.

<!-- anchor: 9a6gd09x -->
## Current picture (addresses first)

- `adapters/A02-codex.md` — `b914jrkn` (L7) declares range `>=0.120.0 <0.121.0` **and** calls the
  narrowing a future semver decision in the release brief; `rdl4n5wk` (per-capability consumption)
  names only `codex_reasoningEffort`, `codex_apiKey`, `codex_sandboxMode`; `dmy7oxr7` (L2) fixes
  warn-and-ignore *before `adapter_ready`*; `26dlg7ut` carries the plan-mode refusal edge case.
  The page has **no Dependencies section** and no L3 section (correct per L3's adapter clause:
  adapters document consumed keys inline in `rdl4n5wk`).
- `modules/M16-task-tracking.md` — `3dln3isl` matrix row: *codex — SDK exposes no task-tracking tool*;
  `1kbztqb4` edge case repeats it.
- `modules/M08-token-usage.md` — `6kzt7gmh` bullet 4: `contextSize` unavailable from an SDK →
  reported as undefined, never conflated with billed tokens; bullets 1–2 own the codex cumulative→delta rule.
- `modules/M04-mcp-integration.md` — `fv7bhx0s` matrix: dynamic config from `mcpServers` = ❌ for codex,
  warn one-shot + skip; `wxyessab` edge case; **no AC** backs the codex row.
- `modules/M18-tool-gating.md` — `1yllld10` matrix (shell/file-read/delegation = none → throw),
  composition note for A02, `pj0py9m4` records the config-key quoting blocker.
- `layers/L7-sdk-compatibility.md` — `d0npth7e` schema: *Supported peer-SDK range* (declared == verified,
  forbidding a wide declaration), *Version gate (HARD)*, *Version-acquisition*, *Availability probe*,
  *Known schema-drift points*, *Verified-pin log* (append-only, newest pin == declared pin,
  `pending verification` allowed for a spec-first bump), *Defensive-read strategy*.
- `index.md` — `0aj92zki` Open questions, 9 numbered items; `5uvpqu1k` adapter table.

Impact check on the one entity this plan rewrites: `ac-for-codex-plan-mode-forces-sandbox-read` is
surfaced by exactly **one** reference — the `tagged_list type="ac" tags="a02"` embed at
`adapters/A02-codex.md` `e4m8i9ie` (line 88). No page names it in prose, no other entity points at it.
A retitle and a sibling AC therefore change one rendered list and nothing else.

<!-- anchor: 09yrxroa -->
## P0 — Corrections to present behaviour (canon is wrong about today's code)

<!-- anchor: jozwqj5h -->
### P0.1 Rewrite the stale plan-mode AC, and split the timeout assertion out of it

- **Entity op — update `ac` `ac-for-codex-plan-mode-forces-sandbox-read`**: new title asserting the
  code's actual behaviour — *"For codex, `planMode: true` refuses the run before dispatch, because the
  preset's `shell` deny has no primitive on this adapter."* Keep `kind: edge-case`, keep tags
  `a02`, `a02-edge`, keep the slug (the slug is stale wording but renaming it buys nothing and the
  embed is tag-driven).
- **Entity op — create `ac`** (one observable thing each, so this is a second record):
  *"On codex, `timeoutMs` and `abort()` surface as `AdapterTimeoutError` / `AdapterAbortError` in the
  runtime phase."* `kind: edge-case`, tags `a02`, `a02-edge`.
- **Entity op — create `ac`**: *"On codex without a tool-gating request, the sandbox posture is
  `codex_sandboxMode`, defaulting to `workspace-write`."* `kind: requirement`, tags `a02` — this is the
  only true half of the old title and it would otherwise be lost.
- Consistency: the rewritten criterion now agrees with `ac-on-codex-requesting-shell-or-file-rea`
  (tag `m18-edge`) instead of contradicting it. No page edit needed — both are reached by tag.

<!-- anchor: fbrwi4fy -->
### P0.2 M16 — "no task-tracking primitive" is false for the pinned SDK

- **Address** `modules/M16-task-tracking.md` `3dln3isl`, the codex row of the support matrix.
- Replace *"SDK exposes no task-tracking tool"* with the distinction the evidence forces: the pinned
  0.120 SDK **does** emit a `todo_list` item (`TodoListItem` in the shipped declarations); the adapter
  **drops it** and emits no `todo_list_updated`. The absence is an adapter gap, not an SDK absence.
  Keep the "never a silent pretense" sentence; the row's `source` column stays `—` while nothing is emitted.
- Keep the closing paragraph's claim about A04 gemini untouched — it was not measured on this round.
- **Address** `modules/M16-task-tracking.md` `1kbztqb4` — amend the edge case the same way: no
  `todo_list_updated` on codex today, and the reason is the adapter, not the SDK.
- **Entity op — create `ac`**: *"A codex run emits no `todo_list_updated` event even when the SDK
  reports a `todo_list` item."* `kind: edge-case`, tags `m16`, `a02-edge` — canon currently asserts this
  absence with no criterion behind it, and P1.3 needs a criterion to supersede.
- Placement: matrix row, not `Domain` — rule 2, the support matrix is M16's declared home for
  per-adapter sourcing ("adapters link here, one-home rule").

<!-- anchor: v9rqmgr9 -->
### P0.3 A02 — name the pinned-SDK options the adapter does not expose

- **Address** `adapters/A02-codex.md` `rdl4n5wk`, as new bullets in the existing per-capability list
  (L3's adapter clause: an adapter documents keys it *consumes* here, and declares no L3 section —
  so nothing moves into `layers/L3-…`).
- Record, as present-tense adapter gaps against the **pinned 0.120** surface: `CodexOptions.config`,
  `CodexOptions.env`, `CodexOptions.codexPathOverride`, `TurnOptions.outputSchema`,
  `ThreadOptions.skipGitRepoCheck`, `ThreadOptions.networkAccessEnabled`, `ThreadOptions.webSearchMode`
  — all typed in-range, none exposed by the adapter. Web search is reachable **only as a deny** through
  M18's `web` group; there is no way to turn it on.
- Record two stream-level gaps in the same section (they are consumption facts, not L1 vocabulary
  changes): `item.updated` is ignored, and `todo_list` / `web_search` items are dropped.
- **Entity op — create `ac`**: *"The codex adapter passes no consumer value into `CodexOptions.config`,
  `env`, `codexPathOverride`, `TurnOptions.outputSchema` or the `ThreadOptions` sandbox/web toggles."*
  `kind: requirement`, tags `a02` — asserting the gap is what keeps P1 from being read as shipped.

<!-- anchor: 434japct -->
### P0.4 A02 L7 — the peer range is already narrow; the drift watch is the new fact

- **Address** `adapters/A02-codex.md` `b914jrkn`, the *Supported peer-SDK range* bullet.
- Drop the sentence deferring the narrowing to a release brief: `package.json` and `src/sdk-version.ts`
  already carry `>=0.120.0 <0.121.0`, so *declared == verified* holds today and L7's own prohibition is satisfied.
- Under *Known schema-drift points*, replace *"none identified in-range yet"* with the out-of-range
  observation, labelled as such: registry latest is **0.155.1** (alpha 0.157.0-alpha.8), still an
  `exec --experimental-json` wrapper with the same `ThreadEvent`/`ThreadItem` union — no interactive
  callback, no `pushMessage`. Typed deltas observed: `CodexOptions.configOverrides?: string[]`,
  `ThreadOptions.threadSource`, `ModelReasoningEffort` gains `max`/`ultra`/`persistent`, `Usage` gains
  `cache_write_input_tokens` and `reasoning_output_tokens`, MCP result gains `_meta`, plus changed
  runtime executable discovery. State explicitly that these are **out-of-range facts recorded for the
  upgrade round**, so the version gate keeps hard-failing on them.
- **Verified-pin log**: append no row. A row is written when the 0.155 line is actually dev-pinned
  (P1.1), with `findings: pending verification` at the earliest — the log is append-only and the newest
  row must equal the declared pin, which it does today.

<!-- anchor: rfn6brjp -->
### P0.5 M04 — "cannot accept servers dynamically" is too strong

- **Address** `modules/M04-mcp-integration.md` `fv7bhx0s`, codex row and the codex degradation bullet.
- Separate the two claims: the SDK exposes **no dedicated `mcpServers` API** (true, and the reason the
  adapter warns and skips), but its `config` passthrough **can serialize `mcp_servers` and
  `developer_instructions`**, so a categorical impossibility is not what the specification should assert.
  Behaviour is unchanged on this round: warn one-shot + skip stays, because the passthrough is unverified.
- Do **not** claim embedded in-process MCP instances work through this path — they do not; say so.
- **Address** `modules/M04-mcp-integration.md` `wxyessab` — leave the edge case as-is; it describes the
  behaviour, which does not change.
- **Entity op — create `ac`**: *"Passing `mcpServers` to codex emits exactly one warning for the run and
  ignores every entry."* `kind: requirement`, tags `m04`, `a02` — the reader found this assertion carried
  by prose alone.

<!-- anchor: mtxb4gq3 -->
### P0.6 M18 — record the key-quoting status without relaxing anything

- **Address** `modules/M18-tool-gating.md` `pj0py9m4` (A02's config passthrough mangles keys).
- Add one sentence: the raw `configOverrides` array in the **out-of-range** 0.155 line removes the
  mechanical quoting blocker, and removing that blocker proves **nothing** about shell gating or a
  filesystem-policy guarantee. Fail-closed for `shell` / `file-read` / `delegation` stands until policy
  composition is verified against a live model.
- No change to `1yllld10`, to the matrix, or to any `m18` AC. This entry exists so a later reader does
  not infer permission from the upstream changelog.

<!-- anchor: vzxc6wea -->
### P0.7 Code defects — routed out of the specification, deliberately

None of these four is a spec edit; each is a place where the code fails an assertion canon already
makes. They belong in a code patch / draft PR, and this plan records the canon address each one owes:

1. `src/adapters/codex.ts:234` sets `codexOptions.baseURL` while the SDK reads `baseUrl` — the override
   is silently inert. Canon address: `adapters/A02-codex.md` `6wdgh63l` (auth model).
2. MCP degradation warns via `console.warn` instead of emitting a `warning` event before `adapter_ready`
   — a direct violation of `ac-the-codex-adapter-degrades-mcp-subagent` and of `dmy7oxr7`. Canon is
   right; the code is wrong. Do not weaken the AC to match the code.
3. `src/adapters/codex.ts:602` reports `contextSize` from the per-execute billing delta
   (input + output), against `modules/M08-token-usage.md` `6kzt7gmh`: unavailable → **undefined**, never
   conflated with billed tokens. A tool-using turn issues several model requests, so the billing delta is
   not the final context occupancy under any reading.
4. The cumulative→delta billing behaviour itself is **correct and stays** — `priorUsage`, the 256-entry
   LRU, the documented first-resume artifact. No change without fresh upstream runtime evidence.

Only one small spec edit falls out of (3), and it is a clarification of an existing rule rather than a
new one: in `6kzt7gmh`, extend bullet 4 to say why a billing delta cannot stand in for occupancy
(several model requests per turn). Optionally add an `ac` tagged `a02`, `m08`:
*"A codex run reports `contextSize` as undefined."*

<!-- anchor: ods48clr -->
## P1 — Proposed future work (verified SDK upgrade and the config contract)

Every entry here is a **proposal**. None of it is present behaviour, and the specification must not read
as though it were until the verification named in each entry has run.

<!-- anchor: 4385u4bt -->
### P1.1 Staged upgrade to the 0.155 line — an `index.md` open question, not a spec change yet

- **Address** `index.md` `0aj92zki`, new item **10** (items 1–9 exist).
- Content: the upgrade is a **CLI-compatibility + real-model verification** exercise, not a relaxed
  version gate. Named preconditions: bundled-CLI compatibility across the range, the changed runtime
  executable discovery, the typed deltas listed in P0.4, and a fresh e2e pass. Its output is an L7
  edit at `b914jrkn` (range + verified-pin row) owned by a release brief (M12), because narrowing
  `peerDependencies` is semver-significant and L7 forbids editing config here.
- Explicitly out of the upgrade's scope: nothing in the 0.155 line introduces an interactive callback or
  `pushMessage`, so M11's `midTurnPush: false` for codex is unaffected by it.

<!-- anchor: uav0tpnz -->
### P1.2 A support contract for the config passthrough — specified before any code change

- **Address** `adapters/A02-codex.md` `rdl4n5wk` (consumption) and `b914jrkn` (drift points), as a
  clearly-labelled *proposed* block; the L3 keys it would introduce (e.g. `codex_config`,
  `codex_env`, `codex_cliPath`, `codex_webSearch`) are declared by M01 per L3's implementor slot, so
  M01's `## Configuration & Extensibility (L3)` section gains the ArchOption rows.
- The validation checklist the contract owes before any AC is written as `active`: CLI versions that
  accept each key; escaping of arbitrary server keys (absolute paths, globs, reserved tokens);
  stdio vs HTTP transport mapping; precedence between passthrough, `~/.codex/config.toml` and
  `configOverrides`; secret redaction (M14) over serialized config; inheritance from external config;
  MCP reconnect/resume semantics across `resumeThread`.
- `TurnOptions.outputSchema` is a separate decision from the rest: it is a **contract** question
  (structured output in the unified result) before it is a passthrough question, and it touches L1.
  Park it as its own line in the open question rather than folding it into the config block.

<!-- anchor: k7ohsox8 -->
### P1.3 Project the SDK's `todo_list` into `todo_list_updated`

- **Address** `modules/M16-task-tracking.md` `3dln3isl` — the codex row would move from honest absence to
  a third positive projection, with a `source` value to be decided (`model-tool` is the closest existing
  value; the todo list arrives as an item, not a tool call, so the choice needs stating).
- Snapshot semantics to decide: wholesale replace vs per-item merge, measured against what the SDK
  actually emits across a multi-step turn.
- Supersedes the P0.2 absence AC once verified — deprecate it, do not delete it.

<!-- anchor: ledn60nk -->
### P1.4 Usage fields the 0.155 line adds

- **Address** `modules/M08-token-usage.md` — `UsageStats` is M08's shape, so mapping
  `cache_write_input_tokens` and `reasoning_output_tokens` is an M08 decision, not an A02 one.
  Deferred to after P1.1: the fields are out of range today and mapping them now would declare a
  surface the gate rejects.

<!-- anchor: 8owjt75t -->
### P1.5 Web search as a positive capability

- **Address** `adapters/A02-codex.md` `rdl4n5wk` + `modules/M18-tool-gating.md` `1yllld10`.
  Today `web` is deny-only. Enabling it means `ThreadOptions.webSearchMode` becomes a consumer-facing
  key, which reopens the "documented value missing from the SDK's type" note in `pj0py9m4`.
  Proposal only; no matrix cell changes on this round.

<!-- anchor: hxsk293a -->
## P2 — Codex App Server: an opt-in second backend, feasibility first

<!-- anchor: bg39t3sa -->
### P2.1 Open question in `index.md`

- **Address** `index.md` `0aj92zki`, new item **11**.
- Framing, in the user's own terms: a **staged** path — P0/P1 harden the SDK backend, then an **opt-in**
  App Server backend is prototyped for bidirectional product integration. Not a silent replacement of
  the SDK backend, and not the OpenAI Agents SDK.
- Upstream position to record: the official docs recommend the SDK for CI and the App Server for rich
  clients; the App Server's command/WebSocket surface is documented as **experimental and unsupported
  for production**, and dynamic tools are experimental.
- Surfaces the study would map against our modules — `item` / `agentMessage` / `delta` (L1, M09),
  `turn/steer` (M11 mid-turn — the only credible route to `midTurnPush: true` on codex), approval
  requests and `item/tool/requestUserInput` (M18's parked `'ask'` mode, open question 6), MCP
  elicitation and `collabToolCall` (M04), `model/list` (M02), `skills/list` and extra roots (M05, M15),
  compaction (M07).
- Deliverable of the study is a **pinned stdio feasibility / protocol note with maturity checks** —
  not a production guarantee, and not a new module until the study returns. If it returns positive, the
  likely shape is a second codex backend behind an explicit opt-in, with its own L2 degradation matrix.

<!-- anchor: c7rhk65e -->
### P2.2 OpenAI Agents SDK — a separate line in the same item

An application-owned agent loop with its own tools, handoffs and tracing. It is a **distinct adapter
candidate**, not a codex backend, and it is only worth a module if that product direction is wanted.
One sentence in the open question; no module number reserved.

<!-- anchor: 5kkmler7 -->
## Execution order

1. P0.1 (entity ops only — no page edit, the embed is tag-driven).
2. P0.2, P0.3, P0.4, P0.5, P0.6 — page edits, each with its own `update_sections` batch.
3. The `6kzt7gmh` clarification and optional AC from P0.7.
4. P1.1 and P2.1 — `index.md` `0aj92zki` items 10 and 11, written in one edit.
5. P1.2 M01 L3 rows, only if the config contract is approved as a direction.
6. P1.3–P1.5 and P2 stay unwritten until their verification runs.

<!-- anchor: az2z6krp -->
## Seen, not planned

- `adapters/A02-codex.md` has **no Dependencies section**, while M04/M08/M16 carry one — the adapter
  pages appear to be a family of their own, and settling that is a structural question, not this intent.
- The corpus uses English section headings (`## Purpose & SDK identity`, `## Dependencies`) where the
  writing style's purpose sweep matches `## Cel`; every module drops out of that sweep silently.
  A known failure mode, outside this intent.
- The `module-dependency` entity type reports **inactive** in this workspace, so no dependency record
  could be read or proposed for any entry above.
- `.claude/skills/codex-sdk/SKILL.md` in the code repo is stale on mirroring, images, resume
  `sessionId` and `xhigh` — implementation guidance, not specification. Refresh it separately, and do
  not let a guidance refresh overwrite implementation.
- `modules/M16-task-tracking.md` `3dln3isl` makes the same "SDK exposes no task-tracking tool" claim
  about **A04 gemini**. It was not measured on this round; if the gemini SDK has a primitive too, the
  row carries the same defect.
