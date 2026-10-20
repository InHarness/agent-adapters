---
type: plan
title: Luki kontraktu usage zgłoszone przez claude4spec
created_at: '2026-09-24T19:21:59.803Z'
created_by: agent
applied: false
---
# Usage-contract gaps reported by claude4spec

<!-- anchor: bu2i2jbj -->
## Intent

A consumer (claude4spec App Spec, on 0.9.6, reading the `UnifiedEvent` stream) persists token usage for main turns, subagent delegations (native Task and programmatic `subagents`) and background tasks. A consultation showed six places where the specification does not say what a persisted number means or how the numbers compose. Without those answers the consumer cannot tell if summing two numbers double-counts, or what the right table key is. Every entry below closes one gap, so that each usage-bearing event says **whose** tokens it carries, **when** it is populated, and **how it composes** with `result.usage`.

Consumer's interim posture (recorded so that the resolution can confirm or overturn it): delegation usage is shown as separate values and is never added to the turn's usage.

Status: **reported, not decided.** Several entries need a measurement against the live SDK before the prose can be written. Where that is so, the entry names the probe. Nothing here is applied until the decisions are made.

<!-- anchor: jqwd2zg4 -->
## Entries (execution order)

<!-- anchor: 509tid6x -->
### 1. Does the parent `result.usage` include subagent tokens? Per-adapter answer plus a summation rule

- **Address:** M08 Unified Contract (L1), `modules/M08-token-usage.md#jng2uu2p`. Per-adapter facts go to each adapter's Usage bullet: A01 `adapters/A01-claude-code.md#sw3cwrsm`, A03 `adapters/A03-opencode.md#3iaufx4q`, A04 `adapters/A04-gemini.md#oirynpg7`. codex is n/a: it has no subagent concept (`modules/M06-subagents.md#1zx424gy`).
- **Gap:** M08 Purpose (`#isl5vi9a`) claims ownership of "aggregation across turns and subagents". L1 does not say whether `result.usage` already contains the subagents' tokens (including a subagent running on its own model). So it does not say whether a consumer may add `subagent_completed.usage` to it.
- **Change:** add an L1 bullet with the unified rule: either "`result.usage` is inclusive; `subagent_completed.usage` is a breakdown, never an addend", or "exclusive; the run total is the sum". If adapters cannot agree, the rule names the adapter-level flag or event that tells the two apart. Each adapter's Usage bullet states its own fact.
- **Evidence required first:** a live probe per adapter. claude-code: compare `SDKResultMessage.usage` on a delegating turn against the sum of `task_notification.usage`. opencode: check whether `step-finish` frames inside a `task` window are counted. gemini: check whether per-`threadId` `usage` events are folded into the run.
- **L1 schema fields:** read `layers/L1-unified-contract.md#yc5ftl18` at apply time and answer the fields it names for event payload semantics.
- **Entities:** new `ac` tagged `m08`: "the parent `result.usage` is inclusive/exclusive of subagent usage as the L1 rule states". Extend the claude-code e2e `usage`/`subagents` scenario (`modules/M12-conformance-release.md#xe2ecat1`, `adapters/A01-claude-code.md#a01e2ecv`) with a leg that asserts the rule.

<!-- anchor: 83583o30 -->
### 2. Meaning and source of `background_task_completed.usage`, per `taskType`

- **Address:** M17 Unified Contract (L1), `modules/M17-background-tasks.md#01or0cpk`. The composition rule is cross-referenced from M08 L1 `#jng2uu2p`. The wire source is in A01 `#mn3ytsj4` / `#sw3cwrsm` (`task_notification.usage?`).
- **Gap:** the field exists, but the specification does not say:
  - when it is populated;
  - whose consumption it holds for `'shell'` / `'monitor'` / `'workflow'`;
  - whether it is disjoint from every `result.usage`.
- **Change:** a per-`taskType` statement. For each type, say whether usage is populated. For `workflow`, say whether it holds the orchestration's model tokens. For `shell` and `monitor`, a process consumes no model tokens: say whether the field is always absent or is populated. Then state the disjointness rule: the tokens of the model's post-wake-up continuation belong to the **next** `result`, which M08 L1 already states, and are never repeated in `background_task_completed.usage`.
- **Evidence required first:** live probe of `task_notification.usage` for `local_bash` and for a `workflow` kind on the current peer range.
- **Entities:** new `ac` tagged `m17`: "`background_task_completed.usage` is absent for `taskType: 'shell'`" (or its measured opposite), plus one `ac` for the disjointness rule.

<!-- anchor: co5qxwsx -->
### 3. `usage` on `subagent_completed` — a row in the M06 support matrix, plus the synthesized-abort rule

- **Address:** M06 Capability & Degradation (L2), `modules/M06-subagents.md#1zx424gy` (the matrix), and M06 Edge cases `#4b8iv50p` (the synthesized-abort bullet).
- **Gap:** the matrix has no row for whether `subagent_completed.usage` is populated per adapter. The synthesized `subagent_completed { status: 'aborted' }` rule says nothing about `usage`.
- **Change:**
  - Add the matrix row "`usage` on `subagent_completed`": claude-code (from `task_notification.usage`, conditions as measured), codex (❌, no lifecycle), gemini and opencode (as measured; lifecycle is synthesized there, so usage is probably absent).
  - Extend the edge-case bullet: a synthesized closing `subagent_completed` carries **no** `usage`, because the adapter has no measurement to report and a fabricated zero is exactly what M08's "absent, not zero-faked" rule (`modules/M08-token-usage.md#6kzt7gmh`) forbids.
- **L2 schema fields:** read the L2 layer's `## Module slice schema` at apply time and fill the degradation fields it names for the new row.
- **Entities:** new `ac` tagged `m06`: "a synthesized `subagent_completed { status: 'aborted' }` carries no `usage`".

<!-- anchor: 64fttise -->
### 4. `UsageStats` carries no model and no cost — an explicit out-of-scope statement

- **Address:** M08. The out-of-scope statement goes into `## Domain` if the module gains one (boundary shape), otherwise into M08 L1 `#jng2uu2p`. It is also noted in M08 Public API & Packaging (L4) `#zqm60jzu`, because it is a statement about what the exported type will not grow.
- **Gap:** no `model`, `costUsd`, `total_cost_usd` or `modelUsage` exists anywhere in the specification, and the specification does not say whether that is a decision or an omission.
- **Change:** a boundary statement with its reason. `UsageStats` is tokens only: no model attribution, no per-model breakdown, no currency. Pricing is consumer-side. A subagent's model is known to the consumer from its own `SubagentDefinition.model`, which M06 passes through verbatim (`modules/M06-subagents.md#7tmzge8v`). This entry records the consumer's requested decision. If the maintainers would rather add the fields, this entry becomes an L1 contract change owned by M01 (`modules/M01-unified-core.md#8do90d06`) and must be re-planned.
- **Entities:** none required. Optionally an `ac` tagged `m08`: "`UsageStats` declares no cost or model fields".

<!-- anchor: x2a9i46p -->
### 5. Where the consumer gets the cumulative total that `priorUsage` needs

- **Address:** M08 Edge cases `modules/M08-token-usage.md#6kzt7gmh` and A02 Usage bullet `adapters/A02-codex.md#rdl4n5wk`. If the resolution adds a field, it also touches M01 (`#8do90d06`), which owns the `result` shape, and M08 L4 `#zqm60jzu`.
- **Gap:** `priorUsage` must be the prior **cumulative** codex total, but `result.usage` carries a **delta**. The specification does not say how a consumer obtains the cumulative figure across processes.
- **Options to decide between:**
  - (a) The library exposes the cumulative total, for example as an optional field on codex's `result` or through an exported helper. This is an additive L1 change.
  - (b) The contract states that the consumer sums the session's deltas and passes that sum as `priorUsage`. The rule must also say that the sum is only correct if no `execute()` of the thread went unrecorded.
- **Change:** write the chosen option into A02 and M08 Edge cases. Under (a), also M01 and L4.
- **Entities:** new `ac` tagged `m08` for the chosen mechanism, for example: "a resumed codex run seeded with the sum of prior `result.usage` deltas reports a first delta equal to that turn's own cost".

<!-- anchor: lupgvhqk -->
### 6. Re-entry semantics: continuation or new instance, `toolUseId` presence, delta or cumulative usage per segment

- **Address:** M06 Unified Contract (L1), `modules/M06-subagents.md#0f6287ae`. The claude-code wire facts are in A01 `#sw3cwrsm` (Re-entry bullet). The per-adapter `toolUseId` source goes to the M06 matrix `#1zx424gy`.
- **Gap:**
  - (i) L1 says "`taskId` identifies the agent", but it does not say in so many words that a re-entry is a **continuation of the same agent with its context**, rather than a new instance.
  - (ii) The `subagent_started` shape lists `toolUseId` without `?`, but the specification never says how the synthesizing adapters (gemini per-`threadId`, opencode `task` part) populate it.
  - (iii) The specification does not say whether `usage` on each `subagent_completed` is the delta of that segment or cumulative for the `taskId`.
- **Change:**
  - (i) An explicit continuation statement, grounded in A01's measured `Resuming agent` / `resumedAgentId` and the unchanged `parent_tool_use_id`.
  - (ii) A matrix row "`toolUseId` on `subagent_started`" with its source per adapter, or `?` on the field if some adapter cannot supply it. The latter is a type change and needs an M12 semver note.
  - (iii) A delta-per-segment or cumulative rule, in the same "never a running total" spirit as M08 L1. If the SDK reports it cumulatively, the adapter subtracts, as codex does for `result`.
- **Evidence required first:** a claude-code probe of `task_notification.usage` on the first and the re-entered cycle of one `task_id`. This is the same run the unimplemented `sdk-surface-probe` leg (2) sets up (`adapters/A01-claude-code.md#a01e2ecv`).
- **Entities:** new `ac` tagged `m06`: "`toolUseId` is present on every `subagent_started`" (or the per-adapter variant), and one `ac` for the usage-per-segment rule.

<!-- anchor: w9ffurp4 -->
## Seen, not planned

- M08's own layout does not follow this style's module shape: `## Purpose` instead of `## Cel`, and a `Dependencies` markdown table instead of `module-dependency` records (`modules/M08-token-usage.md#isl5vi9a`, `#twe74trq`). The purpose sweep will silently miss it. Outside this intent.
- M08 Dependencies names `NormalizedMessage.usage` as optional, and no adapter bullet says which adapter populates it. This is a neighbouring usage gap that the consumer did not report.
- A02 `#rdl4n5wk` carries an open TODO on sandbox composition, which is unrelated.
