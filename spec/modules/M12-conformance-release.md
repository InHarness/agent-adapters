<!-- anchor: lemjup0g -->
# M12 — Conformance, evolution & release

> The toolkit that proves any adapter — first- or third-party — honors the contract, plus the policy that lets the contract grow without breaking the adapters already built on it.

<!-- anchor: b559upc7 -->
## Purpose

Adapter authors can verify their adapter against L1 with a shared assertion toolkit instead of guessing, and library maintainers can evolve the contract under a known semver/deprecation policy. M12 is the **implementor of L5**: it owns the `assert*` helpers, the `ContractResult` shape, the `/testing` subpath export, and the e2e/normalization conventions. It also owns (in L4) the contract-extension checklist, the deprecation policy, and the release process.

<!-- anchor: 5oarh8v7 -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L5 | Implements it — the assertion toolkit and conformance conventions live here. |
| L4 | Owns the semver/deprecation policy and the `/testing` subpath export. |
| L1 | Asserts adherence to the contract it does not define. |
| every adapter | Each runs the assertion toolkit and an e2e suite to prove conformance. |

<!-- anchor: n44tj2yh -->
## Testing & Conformance (L5) — implementor

Read in *how-mode* — what adapter authors rely on:

- **Assertion toolkit** (`testing/contract.ts`, `testing/e2e/shared.ts`) — `assertEventTypes`, `assertTextDeltas`, `assertNormalizedMessage`, `assertContentBlock`, plus an `adapter_ready` validator (exactly one, first non-warning event). Each returns/accumulates into a **`ContractResult`** listing passed/failed assertions with messages.
- **`/testing` export** — the toolkit ships under a dedicated subpath so consumers and third-party adapter authors import assertions without pulling in adapters.
- **e2e conventions** — one `*.e2e.test.ts` per adapter; every test guards on `requireEnv()` and **skips** (not fails) when the SDK's credentials are absent. New invariants are added to `shared.ts` so all adapters inherit them.

<!-- anchor: xe2ecat1 -->
## e2e scenario catalog (L5)

The **canonical vocabulary** of real-model scenarios every adapter suite draws from — the "what a suite can prove", analogous to L1's `UnifiedEvent` taxonomy. Each entry names a scenario and *what it proves*; it deliberately does **not** restate prompt strings or `assert*` helper names (that is code detail, owned by the SDK skills under `.claude/skills`).

| Scenario | What it proves (real-model) |
| --- | --- |
| `simple-text` | a live model streams `text_delta`s and closes with a well-formed `result` + usage; run for both a model **alias** and a **full id**. |
| `thinking` | reasoning surfaces as `thinking` events distinct from answer text. |
| `tool-use` (MCP) | a configured MCP tool is invoked and its `tool_result` flows back into the model's answer. |
| `subagents` | delegated work emits `subagent_*` lifecycle with consistent `subagentTaskId`; and (where supported) a consumer-defined subagent is invocable. |
| `plan-mode` | plan/read-only mode blocks mutation and allows reads (or warns where the SDK cannot enforce it). |
| `path-scope` | reads/writes are confined to `cwd ∪ allowedPaths`; a path outside scope is blocked. |
| `resume` | a resumed session recalls turn-1 state and reports **per-call** usage independence. |
| `todo` | a task-planning tool projects to `todo_list_updated` and snapshots on `result`. |
| `user-input` | a native ask-user tool bridges to `user_input_request`; the handler's answer reaches the model (and the decline path is handled). |
| `image` | an image on input is materialized and described by the model. |
| `mid-turn` | a `pushMessage` mid-turn is accepted and reflected as `user_message` in the same run. |
| `abort` | `abort()` mid-stream ends the run cleanly (`AdapterAbortError`, channel closed). |
| `unknown-model` | an unknown alias warns and passes through (the SDK, not the adapter, rejects it). |
| `usage` | billing vs `contextSize` and cache buckets are legible on the `result`. |

*Coverage* — which scenarios a given adapter runs, and against which model(s) — is **per-adapter**, owned in the adapter file (one-home for coverage), not a matrix here. *Per-capability nuance* — which assertion proves a capability — lives beside that capability's support matrix in its owning module. See <section_ref anchor="ye2ecov1"/>.

**Model matrix & verified range.** claude-code parametrizes the suite over the whole M02 model catalog (`E2E_CLAUDE_MODEL`, the `test:e2e:claude:*` scripts); other adapters pin one model per file. The suite run is also the evidence for L7's *declared range == verified range*: a peer-SDK bump re-runs the full suite before the range is narrowed (see <section_ref anchor="qno516sg"/>).

<!-- anchor: agvf1tok -->
## Public API & Packaging (L4)

- **Semver** — the contract is versioned; additive `UnifiedEvent`/param changes are minor, removals/renames are major.
- **Behavioral-hardening note (minor + CHANGELOG).** A change that only tightens an opt-in surface without changing its type signature stays **minor**, but when it alters runtime behavior a consumer already relies on, the release MUST carry an explicit behavioral CHANGELOG note. Reference case: the M15 path-scope hardening — the soft claude-code gate moves from deny-only to allow-confinement (and drops `bypassPermissions` when scope is requested). Additive at the type level, but behaviorally significant for consumers using path-scope today, so it ships as a minor with a "security-hardening: path-scope now confines to `cwd ∪ allowedPaths`, not deny-only" note rather than silently.
- **Deprecation policy** — a superseded surface (e.g. `elicitation_request` / `onElicitation`) is retained and bridged for at least one major before removal.
- **Contract-extension checklist** — adding an event/field requires: update `types.ts` with JSDoc naming supporting adapters; update every adapter (map / synthesize / document-unsupported with a one-shot `warning`); add `shared.ts` assertions; add a per-adapter e2e case — and, if it introduces a new real-model scenario, add it to the scenario catalog (see <section_ref anchor="xe2ecat1"/>), record it in each covering adapter's e2e coverage list, and add its AC entity; bump the capability matrix; bump the version on release.
- **Release process** — install → typecheck → test → build → publish (mirrors the `.buddy` pipeline), then changelog + tag.

<!-- anchor: f718z382 -->
## Edge cases

- Adapter omits a required event → `ContractResult` fails the relevant assertion with a specific message; the suite does not silently pass.
- A new contract feature only one adapter can emit → must be documented in the type JSDoc and degrade in the others, or conformance/degradation tests flag the gap.
- Credentials missing in CI → e2e tests **skip**, never fail, so the contract suite stays green without secrets.

<!-- anchor: 9zhdfqmb -->
## Acceptance criteria

These verify the toolkit catches non-conformance and that contract growth follows the documented policy.

<tagged_list type="ac" tags="m12"/>
