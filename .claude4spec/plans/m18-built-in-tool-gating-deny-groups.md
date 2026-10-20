---
type: plan
title: M18 — Built-in tool gating (deny-groups)
created_at: '2026-08-22T15:04:58.988Z'
created_by: agent
applied: true
---
> Spec-only plan. No `src/` edits — code follows via the release-brief → implementer pipeline (see CLAUDE.md).
>
> **Revision 4** — design settled and SDK facts verified. Decisions 6–9 add a strength axis, a residual-allow-list invariant, a warning on porous group combinations, and the `autoApproveTools` rename. The O1/O2/O4 verification then moved two cells of Table 1 (A02 `file-read` throws; A03 is version-gated `hard`) and rewrote the A01 composition rule. Ready to write — start at step 1.

<!-- anchor: k4dup9e1 -->
## Problem

Consumers can constrain **where** an agent may touch the filesystem (M15 `allowedPaths` / `disallowedPaths`) but not **which built-in tools** it may use at all. Concretely: "run this agent, but no shell, and no filesystem access."

Today four partial, unrelated mechanisms exist:

- `planMode: boolean` — a hardcoded per-adapter read-only preset with **no owning capability-module**. It lives as an M12 e2e scenario row (<section_ref anchor="xe2ecat1"/>) plus four independent adapter mechanics: A01 allow-list `tools` + `disallowedTools` (<section_ref anchor="sw3cwrsm"/>), A02 `sandboxMode: 'read-only'` (<section_ref anchor="rdl4n5wk"/>), A03 a `console.warn` no-op (<section_ref anchor="3iaufx4q"/>), A04 `excludeTools` (<section_ref anchor="oirynpg7"/>).
- M15 path-scope — confinement by path… **except it is not.** On A01, soft path-scope switches the run to `permissionMode: 'dontAsk'` and emits allow rules for `Read`/`Edit`/`Write` only, so `Bash`, `Grep`, `Glob`, `WebFetch`, `WebSearch` and `Agent` are already de-facto denied whenever path-scope is on. M15 is *already* a tool gate on A01; the two modules are not orthogonal.
- `RuntimeExecuteParams.allowedTools` — **a naming trap**: it means *auto-approve*, not *restrict*; only A01 reads it, and A02/A03/A04 ignore it **without a warning**, which itself violates the L2 degradation convention.
- Adapter-native primitives that the library never surfaces (opencode's `permission` buckets, codex's `config` passthrough, gemini's Policy Engine).

`spec/index.md` parks this work as Open Question 6 (<section_ref anchor="0aj92zki"/>): a *"low-level `onToolPermission`-style escape hatch for **non-path** policies … whether to build it as a sibling module (a future `M18+`, since `M16`/`M17` are taken) … is undecided; if built, it must be designed to run in parallel with M15 without conflict."*

Two notes on that mandate:
- OQ6 posits an **imperative hook**; this plan delivers a **declarative deny-list**. That is a deliberate departure and must be argued in the module, then OQ6 marked resolved (not merely reworded).
- **OQ7 (autonomous self-scheduling loop) also claims "M18+".** This plan takes M18 for OQ6; OQ7 must be re-pointed at M19 in the same edit.

<!-- anchor: 7rxv4z8e -->
## Approved decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | Contract shape | Deny-list of **unified tool groups**, plus library-built **presets** (`planMode` desugars into a deny-list) |
| 2 | Adapter cannot enforce | **Fail-closed — throw before dispatch** (this is a security control, not a best-effort hint) |
| 3 | Group interaction | **Independent** — denying `file-write` does *not* auto-deny `shell` |
| 4 | MCP tools (M04) | **Out of scope** — built-ins only |
| 5 | `planMode` semantics | Becomes a preset and **inherits fail-closed**; CHANGELOG names `disallowedToolGroups: []` as the opt-out |
| 6 | Honesty of the guarantee (R1/R2) | Fail-closed kept, paired with a per-group **`strength` axis** (`hard` / `soft` / `none`) and a canon list of **escape surfaces**. A group with a known escape surface is never reported `hard`. `toolGating` stays a bool meaning "a mechanism exists at all"; strength lives in M18's matrix, mirroring M15 |
| 7 | Porous combinations (R4) | Independence (#3) stands, but a one-shot L2 `warning` fires when `file-read` or `file-write` is denied while `shell` is not |
| 8 | Adapter-side mechanism (R3) | Consumer contract stays deny-shaped; the adapter maps it to a **residual allow-list** wherever the SDK supports one (A01 `tools`, A03 `permission` with a `'*'` default), deny-lists only as a backstop. A new SDK built-in must default to *blocked* |
| 9 | `allowedTools` (O3) | **Renamed `autoApproveTools`** in the same major, with a documented L2 degradation — a one-shot `warning` on the three adapters that ignore it |

<!-- anchor: lkeksiii -->
## Why decisions 6–9 look like that — the evidence behind them

Kept so the module argues these choices instead of asserting them.

**R1 — fail-closed alone produces false confidence.**
Fail-closed advertises the contract *"if it did not throw, the policy is enforced."* That contract is false on two of four adapters:

- A01 `shell`: will **not** throw (the mechanism "exists"), but does not enforce — a spawned `Agent`/`Task` subagent does not inherit `disallowedTools` (already recorded in <section_ref anchor="677rc2wh"/>), and SDK 0.3.220 ships `REPL` ("JavaScript code to execute … state persists across calls") plus `Workflow`.
- A01 `file-read`: the SDK itself documents that native builds may serve search via `Bash` `find`/`grep` instead of `Grep`/`Glob`.
- A04 `shell`: `run_shell_command` excluded, but `list_background_processes` / `read_background_output` remain registered and are absent from `ALL_BUILTIN_TOOL_NAMES`.

Without decision #6, M18 would **throw where it cannot enforce** and **silently fail to enforce where it thinks it can** — strictly worse than M15's honest `warn`. Escape surfaces are therefore canon, not a footnote, and M06 subagent propagation (see cross-module effects) is what closes A01's `shell` hole rather than papering over it.

**R2 — a flat bool cannot carry a security guarantee.**
M15 already carries a `Strength` column (`hard` / `soft` / `none`) in <section_ref anchor="8pg5iti3"/>, for a *weaker* guarantee than the one M18 claims. A01's `disallowedTools` removes a tool from model context (soft: model-level); A02's `read-only` is OS-level (hard). Collapsing both to one bool destroys exactly the distinction a security consumer needs — hence the split in #6: `toolGating` answers "does a mechanism exist", the matrix and `probeToolGating` answer "how strong, and where are the holes".

**R3 — a deny-list is fail-open by construction.**
A new SDK tool defaults to *allowed*. Not hypothetical: A01's shipped adapter already uses an **allow-list** as the primary gate (`options.tools = CLAUDE_CODE_READONLY_BUILTINS`) with `disallowedTools` only as a backstop, precisely because deny-lists rot. SDK 0.3.220 added `REPL`, `Workflow`, `Artifact`, `EnterWorktree`, `Cron*`, `Monitor`, `RemoteTrigger` relative to the state the repo skill describes. Decision #8 keeps the consumer-facing contract deny-shaped while making the adapter side allow-shaped — canonising deny-list-only would have been a regression against shipped behaviour.

**R4 — independence without a warning contradicts "security control".**
A `file-write` deny with a live shell is not a boundary. Decision #7 keeps the groups independent (they are orthogonal capabilities, and auto-denying `shell` would surprise consumers) but refuses to ship the porous combination silently.

<!-- anchor: m17dwcis -->
## Verification findings that rewrote the design

Recorded so the module is not re-derived from the wrong premises.

| Claim in revision 1 | Verdict | Evidence |
|---|---|---|
| M18 is the free number | **true** | `spec/modules/` holds M01–M17, no gaps, none retired. But OQ6 *and* OQ7 both claim "M18+". |
| "precedent `probePathScope`" | **half-false** | The function exists in `src/path-scope.ts`, but appears **nowhere in the spec**. M15 (<section_ref anchor="8pg5iti3"/>) only requires an unnamed *"probe / startup event"*, and index OQ5(c) holds its shape **undecided**. Naming `probeToolGating` in the spec silently resolves OQ5(c) — do it explicitly. |
| "register a new **error code** in M13" | **false** | M13 (<section_ref anchor="8q9q7ty7"/>) has no code table; it has an `AdapterError` class hierarchy, exported via L4 (<section_ref anchor="9dv305bn"/>). M18 needs a new **subclass**. |
| naming follows `disallowedTools` | **half-true** | `disallowedTools` in the codebase belongs to `SubagentDefinition`, not `RuntimeExecuteParams`. The convention argument rests on a field of a different type. |
| `allowedTools` = auto-approve, A01-only | **true** | Declared with no JSDoc; single consumer is A01; silently ignored elsewhere. |
| A01 evaluation order (hooks → deny → mode → allow → `canUseTool`) | **partly false** | O4: three links are evidenced, one is observation-only, and the chain itself is wrong — `dontAsk` inverts mode-vs-allow. The skill also mislabels `disallowedTools` as the "deny rules" that beat `bypassPermissions` (those are `Settings.permissions.deny`) and puts hooks before `disallowedTools`, which is mechanically backwards: a tool stripped from context emits no call for a hook to catch. |
| A03 has no `file-read` bucket | **false** | The running binary's schema carries `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `lsp`, `skill`, `webfetch`, `websearch`, `codesearch`, `external_directory` — each with a real call site. The pinned `.d.ts` types five keys and is a stale mirror. **A03 can enforce all four groups**, but the schema's catch-all swallows unknown bucket names silently. |
| A03 `tools: { bash: false }` | **deprecated** | Merged into `permission` as of opencode v1.1.1. Use `permission.bash: 'deny'` alone. |
| A02 `read-only` ⇒ file-write | **mis-scoped** | It is a whole-run posture: shell still executes (the repo's own e2e case is literally *"planMode=true allows listing files via read-only shell"*), reads are still permitted, and network is also constrained. |
| A02 has no tool-toggle config at all | **half-true** | `CodexOptions.config` is an arbitrary CLI-config passthrough and the reference documents `tools.web_search` / `tools.view_image`. But O2 showed `permissions.filesystem.deny_read` **does not exist**, and the real read-denial family is unreachable through the SDK's unquoted key flattener — so `file-read → throw` stands after all, for a better reason than revision 1 gave. |
| A04 tool names | **true** | `grep_search` (not `search_file_content`, which is a legacy alias), `google_web_search`, `replace` = the edit tool. |
| A04 `yolo` bypasses `excludeTools` | **false — the caveat holds** | Exclusion is applied in the tool registry, before the Policy Engine. `excludeTools` *is* `@deprecated Use Policy Engine instead`, which is the real L7 risk. |
| A04 mapping is complete | **false** | Omits `save_memory` — which the current adapter **already** excludes under `planMode`, so the revision-1 table was a regression against shipped behaviour — and omits the two background-process tools. |
| M15 and M18 are orthogonal | **false** | See **Composition with M15 and `allowedTools`**. |

<!-- anchor: ksr8gup9 -->
## Contract (L1) — the new field

Type home is **M01** (<section_ref anchor="8do90d06"/>, the paragraph that already declares M15's path fields — *"The type home is here; absent fields preserve today's behavior"*); semantics home is **M18**.

- `RuntimeExecuteParams.disallowedToolGroups?: ToolGroup[]`
  - Deny-only, additive. Absent field = today's behaviour, byte-for-byte.
  - Union with preset-derived groups; a preset can never be weakened by omission.
  - **Validation** (state it, it is currently unspecified): unknown group string → reject pre-dispatch with the same error class; duplicates collapse; empty array is a no-op; order is insignificant.
  - **`autoApproveTools` cannot widen it.** The field formerly named `allowedTools` means *auto-approve*, not *restrict*. Per decision #9 it is renamed in this same major, and M18 states that a deny outranks any `autoApproveTools` entry.
- `type ToolGroup = 'shell' | 'file-read' | 'file-write' | 'web'`
  - **shell** — executing an OS command in any form, *including* background-process inspection and any general-purpose code-execution tool.
  - **file-read** — reading / listing / searching files.
  - **file-write** — creating, editing, deleting files, and persisting memory.
  - **web** — fetching URLs and web search.
- **Adapter-side shape (decision #8).** The field is deny-shaped for the consumer, but each adapter derives a **residual allow-list** from it wherever its SDK supports one — A01 `options.tools`, A03 `permission` with a `'*'` default — and uses deny entries only as a backstop. The module states the invariant plainly: *a built-in that the library has never heard of is blocked, not allowed*. Adapters with no allow-list primitive (A04 `excludeTools`) are deny-only and are therefore capped at `soft`.
- Capability flag (M01 `capabilities.ts`, per <section_ref anchor="nbgtn5nk"/> which already names `pathScope` as the example): `architectureCapabilities(arch).toolGating: boolean` — "a gating mechanism exists at all".
- Runtime probe (M01 / M18): `probeToolGating(arch, requestedGroups)` → per requested group `{ group, enforceable, strength: 'hard' | 'soft' | 'none', escapeSurfaces: string[] }`, computed synchronously **pre-dispatch**. This resolves index OQ5(c) for the probe-vs-startup-event question — say so in `spec/index.md`.

<!-- anchor: wntdfrw8 -->
## Presets

Presets are library-built deny-lists so consumers don't hand-assemble them:

- `planMode: true` → `['file-write', 'shell']` (web + reads stay available — plan mode must still research).
- Preset table is canon in M18 (L3 — it is a registry, per <section_ref anchor="dyls74o5"/>), exposed as a named constant through **L4** so consumers can inspect and extend it.
- Every adapter's `planMode` handling is rewritten to go through the deny-group path — one code path, no per-adapter plan-mode special cases left. Consequence for the one-home rule: plan-mode prose **moves out** of the four adapter per-capability sections into M18; it is not duplicated.
- **Migration (decision #5, settled).** A preset behaves exactly like an explicit deny — one semantics, no special case for the path a consumer arrived by. Consequence to spell out in M12 and the CHANGELOG: `planMode: true` on A03 changes from a `console.warn` no-op to a throw, and the documented opt-out is `disallowedToolGroups: []`.

<!-- anchor: lfknlp37 -->
## Capability matrix and group → SDK mapping (canon lives in M18)

Two tables, following the M15 precedent. **Table 1 is row-per-adapter**, matching <section_ref anchor="8pg5iti3"/> so a reader compares adapters the same way in both modules. Table 2 is the mapping detail. Adapter files link here and name only their native mechanism — no duplicated table.

**Table 1 — capability & strength (M15 shape)**

| Adapter | toolGating | shell | file-read | file-write | web | Native mechanism |
|---|---|---|---|---|---|---|
| A01 claude-code | yes | soft ⚠ | soft ⚠ | soft | soft | residual `tools` allow-list + `disallowedTools` backstop |
| A02 codex | partial | **none → throw** | **none → throw** | hard (coarse) | hard (coarse) | `sandboxMode`, `web_search`, `config` passthrough |
| A03 opencode | yes | hard ⚠ | hard ⚠ | hard ⚠ | hard ⚠ | `permission` buckets, `'*'` default |
| A04 gemini | yes | soft ⚠ | soft | soft | soft | `excludeTools` (deprecated) → Policy Engine |

**Table 2 — group → native mapping**

| Group | A01 claude-code | A02 codex | A03 opencode | A04 gemini |
|---|---|---|---|---|
| shell | drop from residual `tools` allow-list; `disallowedTools: ['Bash','TaskStop','TaskOutput','REPL','Workflow']` as backstop. **Escape: `Agent`/`Task` subagents do not inherit deny** | ❌ no primitive (`ThreadOptions` has no shell toggle; `config` passthrough has no `tools.shell`) → **throw** | `permission.bash: 'deny'` (do **not** use the deprecated `tools` map) | `excludeTools: ['run_shell_command','list_background_processes','read_background_output']` |
| file-write | drop `Edit`,`Write`,`NotebookEdit` from the allow-list + deny backstop | `sandboxMode: 'read-only'` — **coarse**: a whole-run posture that leaves reads and shell live, and collides with `planMode` which already owns this field | `permission.edit: 'deny'` | `excludeTools: ['write_file','replace','save_memory']` |
| file-read | drop `Read`,`Grep`,`Glob` (+ the MCP-resource readers). **Escape: SDK documents `Bash` `find`/`grep` as a substitute** | ❌ **no reachable primitive → throw**. `deny_read` does not exist; the real mechanism is `default_permissions` + `[permissions.<name>.filesystem]` where `"deny"` is a *value*. The SDK's `config` flattener emits dotted keys **unquoted**, so paths, globs and `":workspace_roots"` mis-parse — and the docs forbid combining that family with `sandbox_mode`, which `planMode` already claims | a **set**, not one key: `permission.read/glob/grep/list/lsp: 'deny'` (+ `task`, or the run launders reads through a subagent). Cleanest shape is `{'*': 'deny', …allow-list}` | `excludeTools: ['read_file','read_many_files','list_directory','glob','grep_search','get_internal_docs']` |
| web | drop `WebFetch`,`WebSearch`. **Escape: a built-in MCP web-fetch identifier the deny mechanism does not reliably filter** | `web_search: 'disabled'`; `networkAccessEnabled: false` is broader than "web" (kills shell egress too) — **do not** map it to this group. Note `permissions.<name>.network.domains` explicitly does *not* restrict web search. Adapter currently sets none of these | `permission.webfetch/websearch/codesearch: 'deny'` | `excludeTools: ['web_fetch','google_web_search']` |

Notes that must land in the spec:

- **Escape surfaces are canon, not a footnote.** Every ⚠ above is a documented hole; `probeToolGating` reports them, and a group with a known escape surface is never `hard`.
- **A03's ⚠ is a silent-no-op risk, not a model-behaviour risk.** The permission schema ends in a catch-all, so an unknown, mistyped, or not-yet-supported bucket name is **accepted and ignored with no validation error**. Enforcement is hard only against a server version known to consume that bucket. M18 reports `hard` only for confirmed buckets, and L7 names the version skew: this repo pins `^1.4.6`, resolves the SDK to 1.15.11, and talks to a separately installed 1.4.6 binary — the SDK does not contain the server.
- **A03 stops widening.** The adapter unconditionally asserts `permission: { edit: 'allow', bash: 'allow' }`. It must stop asserting blanket allow and derive `permission` from the deny-groups, defaulting the rest via the `'*'` wildcard — supported both as a bucket key and, in the plain-string form `"permission": "allow"`, as shorthand. Deny is enforced server-side before execution, not as a prompt.
- **A04 drift.** `excludeTools` is deprecated in favour of the Policy Engine; the legacy-alias expansion means `search_file_content` and `grep_search` both resolve. Both go in M18's L7 section.
- **A02 is the degradation case:** `shell` and `file-read` throw; `file-write` and `web` are enforceable but coarse.

<!-- anchor: zbo8unp1 -->
## Composition with M15 and `allowedTools` (new — was missing)

The clean story "M18 gates *what*, M15 confines *where*" is false on A01 and unstable on A02. M18 must carry an explicit composition algorithm, and M15's edge-case section must be updated to match.

- **A01.** Four rule surfaces exist at once: the `tools` allow-list, `disallowedTools`, `settings.permissions.allow/deny`, and the OS-sandbox filesystem rules. Today, soft path-scope drops `bypassPermissions` for `permissionMode: 'dontAsk'` and emits allow rules for `Read`/`Edit`/`Write` **only** — so enabling path-scope already denies shell and web, and `autoApproveTools` is the only widener. The rule M18 must state: **an M18 deny rides `tools` (availability) and `disallowedTools` (removal from model context), never `settings.permissions`.** Reason, from the O4 verification: under `dontAsk` the SDK denies whatever is *not pre-approved*, and pre-approval comes from the allow channel — so a deny expressed as a settings rule sits on the same surface that M15 and `autoApproveTools` widen, and can be re-widened. `disallowedTools` cannot: it is documented to win "even if they would otherwise be allowed", and it strips the tool before the model ever sees it.
- **What A01's ordering may claim.** Evidenced on the pinned SDK: `disallowedTools` beats the allow channel; settings deny-rules beat `bypassPermissions`; `canUseTool` runs last. Observed-only (attribute to 0.3.220 in L7): hooks precede `permissionMode` and the allow channel. **Must not be written:** the single short-circuiting chain — `dontAsk` inverts the mode/allow steps, so no one order describes both it and `bypassPermissions`. Also do not call `disallowedTools` a "deny rule": the SDK reserves that phrase for `Settings.permissions.deny`, a different mechanism.
- **A02 — settled as unsupported.** The config reference forbids combining `default_permissions` / `[permissions.<name>]` with `sandbox_mode`, and `planMode` already claims `sandboxMode`. Combined with the flattener defect (see the matrix), M18 declares the permission-profile family **unreachable** on A02 and stays on `sandboxMode` + `web_search`. That is what makes A02 `file-read` a throw rather than a mapping.
- **`autoApproveTools`.** An M18 deny outranks it — evidenced, not assumed: the SDK documents `disallowedTools` as winning over the allow channel.
- **M15 edge case update.** <section_ref anchor="x2258xmh"/> currently reads *"Composes with `planMode` → … they sum, never cancel."* `planMode` is being redefined as a preset over deny-groups, so that sentence must be rewritten in this same change.

<!-- anchor: r1x7wlfn -->
## Degradation (L2) — fail-closed, honestly

M15 degrades with `warn`; M18 deliberately does not — asking to remove the shell and receiving a warning plus a live shell is a silent security failure. But per **R1**, fail-closed only earns its keep if the module is honest about what "enforced" means.

- Any requested group with **no** primitive on the target adapter → **throw before dispatch**, never mid-stream. No partial application: if the policy cannot be honoured, nothing runs.
- Any requested group that is enforceable but **`soft`** → runs, and the strength plus escape surfaces are reported through `probeToolGating` and a startup event. The module states plainly: `soft` is a model-behaviour gate, not a sandbox.
- Per **R4**: a one-shot `warning` event when `file-read`/`file-write` is denied while `shell` is not.
- The error is a new `AdapterError` subclass (**not** an error code — see **Verification findings that rewrote the design**), carrying adapter id, unenforceable groups, enforceable groups with their strength. Shape home is M13, declaration home is M18, export is L4.

<!-- anchor: pulpo18u -->
## Cross-module effects

- **M01** — type home for the field and the `ToolGroup` union (<section_ref anchor="8do90d06"/>); `toolGating` added to the capability list (<section_ref anchor="nbgtn5nk"/>); `probeToolGating` alongside the (spec-absent) path-scope probe.
- **M05 skills** — A01 whitelists the `Skill` tool even in plan mode (<section_ref anchor="sw3cwrsm"/>), and a skill can drive the shell. State whether `shell` deny suppresses `Skill`.
- **M06 subagents** — `SubagentDefinition` carries its own `disallowedTools`, and A01 subagents do not inherit the parent's. Either M18 propagates the deny-groups into every subagent definition, or A01 `shell` is holed by construction. **This is the fix for R1's first bullet.**
- **M07 session resume** — `disallowedToolGroups` is a `RuntimeExecuteParams` field, not an `ArchOption` key → added to `findResumeViolations` as always-immutable, extending the sentence at <section_ref anchor="sjvy01iz"/> that already designates M15's path fields.
- **M13 errors** — new `AdapterError` subclass in the hierarchy at <section_ref anchor="8q9q7ty7"/>.
- **M15 path scoping** — reciprocal cross-link plus the composition algorithm above; rewrite of the `planMode` edge case.
- **M17 background tasks** — background tasks *are* shell tasks. A `shell` deny must disable M17's capability for that run; say so in both modules.
- **M12 conformance & release** — new scenario-catalog row at <section_ref anchor="xe2ecat1"/>; per-adapter conformance cases; and an explicit citation of *which* M12 rule applies (<section_ref anchor="agvf1tok"/>: "removals/renames are major" vs the "behavioral-hardening note — minor + CHANGELOG" pattern used when M15 was tightened). Revision 1 asserted major without arguing it.
- **L3** — the preset registry and the resume-immutability flag (<section_ref anchor="dyls74o5"/>). Missing from revision 1.
- **L4** — export of the preset constant, the `ToolGroup` type, the probe, and the new error class. Missing from revision 1.
- **L5 testing** — conformance shape: "deny group G → G's tools are absent from the adapter's catalog, or the run throws", plus a negative case per documented escape surface. Note only A01 currently has a `## e2e coverage (L5)` section (<section_ref anchor="ye2ecov1"/>) — decide whether the other three gain one.
- **L7 SDK compatibility** — named drift surfaces: the pinned tool names; A04's deprecated `excludeTools`; A03's stale `.d.ts` mirror **plus** its silent catch-all and the pin/resolve/binary version skew; A02's unquoted config-key flattener and the `WebSearchMode` enum gap; and A01's evaluation order, which may only be stated in the evidenced/observed split of O4.
- **M04 MCP** — explicit out-of-scope statement + edge case: a filesystem-MCP server is *not* blocked by `['file-read','file-write']`.

<!-- anchor: 3prw97j3 -->
## Steps

0. **Done — O1 / O2 / O4 are closed.** Their outcomes are already folded into the matrix and the composition rules; carry them into M18's L7 section when writing it.
1. **Create `spec/modules/M18-tool-gating.md`** from `templates/module.md`: hook, purpose (the user need: "run an agent with no shell / no filesystem"), a Dependencies table with **layer rows in M15's form** (`| L1 | New optional field on RuntimeExecuteParams (type home: M01) |`) as well as module rows, then sections for **L1, L2, L3, L4, L5, L7** carrying the group definitions, the residual-allow-list invariant, the preset registry, both matrices, the escape-surface list, the composition algorithm, the fail-closed + strength rules, edge cases, and `<tagged_list type="ac" tags="m18"/>`. Budget check: this will approach the ~250-line limit — be ready to split into `modules/M18-tool-gating/` with `L1-unified-contract.md` extracted, filename matching `layers/L1-unified-contract.md`.
2. **M01** — field + `ToolGroup` at <section_ref anchor="8do90d06"/>; `toolGating` at <section_ref anchor="nbgtn5nk"/>; preset registry note at <section_ref anchor="dyls74o5"/>; `probeToolGating` with its per-group `strength` + `escapeSurfaces` return shape.
3. **`allowedTools` → `autoApproveTools` (decision #9)** — rename at the M01 type home, document the semantics it never had, and give the three adapters that ignore it a one-shot `warning` per the L2 convention. This is the rename that makes M12's "removals/renames are major" rule apply unambiguously.
4. **M13** — new `AdapterError` subclass at <section_ref anchor="8q9q7ty7"/>, exported per <section_ref anchor="9dv305bn"/>.
5. **M07** — `disallowedToolGroups` into the always-immutable designated set at <section_ref anchor="sjvy01iz"/>.
6. **M15** — reciprocal cross-link, the A01 precedence sentence, the composition algorithm pointer, and the rewrite of the `planMode` edge case at <section_ref anchor="x2258xmh"/>.
7. **M06 / M17 / M05** — subagent propagation (this is what closes A01's `shell` escape), background-task suppression under a `shell` deny, and the `Skill`-tool interaction.
8. **M12** — scenario-catalog row at <section_ref anchor="xe2ecat1"/>, per-adapter conformance cases, and the semver justification quoting <section_ref anchor="agvf1tok"/>: the `autoApproveTools` rename is a rename (major); `planMode` starting to throw is behavioral hardening riding the same major, with a CHANGELOG migration note.
9. **A01–A04** — one `Tool gating (M18)` bullet per adapter under per-capability consumption (<section_ref anchor="sw3cwrsm"/>, <section_ref anchor="rdl4n5wk"/>, <section_ref anchor="3iaufx4q"/>, <section_ref anchor="oirynpg7"/>), naming only the native mechanism and linking to M18's matrix. Plan-mode prose **moves** there — per quality rule 9, replace outright, leave no "(was …)" breadcrumb. Edge cases: A02 "shell not suppressible → throws" (<section_ref anchor="26dlg7ut"/>), A03 "stops asserting blanket allow, derives `permission` with a `'*'` default" (<section_ref anchor="d9ugsejh"/>), A01 keeps and cross-links its subagent-escape edge case (<section_ref anchor="677rc2wh"/>), A04 background-process tools (<section_ref anchor="99avio4b"/>).
10. **`spec/index.md`** — add M18 to the module table; **mark OQ6 resolved** (with the hook-vs-declarative rationale); **re-point OQ7 at M19**; resolve OQ5(c) for the probe shape; acknowledge OQ1's module-count band.
11. **AC entities** — tags `m18` + `m18-edge`, then ~16 `ac` entities with `verifies[]` populated: no-op when the field is absent; per-group enforcement per adapter; fail-closed throw on A02 `shell`; **strength reporting** (probe returns `soft` + escape surfaces on A01 `shell`); **residual allow-list invariant** (an unknown built-in is blocked); the porous-combination `warning`; preset union semantics; `planMode` desugaring; M18-over-M15 and M18-over-`autoApproveTools` precedence; resume immutability; subagent propagation; M17 suppression; validation of unknown/duplicate groups. Edge cases: MCP not covered; `file-write` deny with a live shell is not a boundary; A01 `file-read` deny bypassable via shell.

<!-- anchor: iefeqgpp -->
## Verified SDK facts — O1 / O2 / O4

All three are closed. They are recorded here because M18's L7 section has to carry them, and because two of them overturned a cell of Table 1.

- **O1 — A03: confirmed, with a caveat.** The running binary's schema consumes `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `lsp`, `skill`, `webfetch`, `websearch`, `codesearch`, `external_directory`; deny is a server-side block before execution, not a prompt; `'*'` works both as a bucket key and as the plain-string shorthand, so decision #8's residual allow-list is buildable. **Caveat:** the schema ends in a catch-all, so an unknown bucket name is accepted and ignored silently — and `file-read` needs a *set* of buckets, not one.
- **O2 — A02: `file-read` throws.** `deny_read` does not exist; the real mechanism is `default_permissions` + `[permissions.<name>.filesystem]`, where `"deny"` is a value. It is unreachable anyway: the SDK's `config` flattener builds dotted keys by raw concatenation and never quotes a segment, so absolute paths, globs and `":workspace_roots"` mis-parse — and the docs forbid pairing that family with `sandbox_mode`, which `planMode` already claims. Also noted: the SDK's `WebSearchMode` omits the documented `"indexed"` value.
- **O4 — A01: the order must be rewritten, not just version-stamped.** Evidenced: `disallowedTools` beats the allow channel; settings deny-rules beat `bypassPermissions`; `canUseTool` runs last. Observation-only: hooks precede mode and allow. Wrong and to be dropped: the single short-circuiting chain (`dontAsk` inverts mode vs allow), the `disallowedTools` = "deny rules" label, and hooks-before-`disallowedTools`. All of this is serialisation-side evidence — the CLI binary is not readable, so nothing here is normative.

<!-- anchor: xqynms9n -->
## Out of scope

Network / rate-limit / per-command policies (opencode's `bash` pattern map, gemini's Policy Engine rules, codex's `shell_environment_policy`), MCP tool gating, and any `'ask'` interaction mode. These stay parked in `spec/index.md` as a later increment; M18 fixes the group vocabulary so they can be layered on without another rename.

**Rejected alternative, recorded so it is not re-litigated:** folding tool gating into M15 as a widened "capability confinement" module. Attractive because M15 already gates tools on A01 and because index OQ1 warns the spec is past the 8–15 module band — but rejected because the two have different degradation postures (`warn` vs fail-closed), and merging them would force one posture onto both.
