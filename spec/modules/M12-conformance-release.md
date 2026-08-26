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
- **Side-band events are exempt from ordering assertions.** `flush` and `warning` report on a run rather than advancing it, so the toolkit's terminality check reads the last **non-`flush`, non-`warning`** event — per M01's definition, which it asserts and does not restate. A toolkit demanding a literal trailing `result` would fail conforming adapters, since a `warning` may legitimately follow one — a warning's position on the stream carries no meaning at all (M01). The toolkit therefore asserts the shape the contract permits, not the shape today's adapters happen to produce: an adapter that starts emitting a trailing `warning` must not thereby turn a green suite red. Same exemption the `adapter_ready` check already makes at the other end of the stream.
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
| `subagents` | delegated work emits `subagent_*` lifecycle with consistent `subagentTaskId`; (where supported) a consumer-defined subagent is invocable; and a subagent inherits the run's filesystem ceiling — under a soft path-scope, a subagent asked to read outside `cwd ∪ allowedPaths` is refused exactly as the parent would be (M15 — <section_ref anchor="8pg5iti3"/>). |
| `plan-mode` | the plan-mode preset desugars into M18 deny-groups: mutation is blocked, reads and web still work, and an adapter that cannot enforce the preset refuses the run pre-dispatch rather than warning. |
| `path-scope` | reads/writes are confined to `cwd ∪ allowedPaths`; a path outside scope is blocked. |
| `tool-gating` | a denied `ToolGroup` is unusable for the whole run — its tools are absent from the adapter's catalog, or the run is refused before dispatch — and a documented escape surface behaves as the matrix says it does, not better. Proves the fail-closed posture against a live model, which is the only way to tell "the model chose not to" from "the tool is gone" (M18). |
| `resume` | a resumed session recalls turn-1 state and reports **per-call** usage independence. |
| `todo` | a task-planning tool projects to `todo_list_updated` and snapshots on `result`. |
| `user-input` | a native ask-user tool bridges to `user_input_request`; the handler's answer reaches the model (and the decline path is handled). |
| `image` | an image on input is materialized and described by the model. |
| `mid-turn` | a `pushMessage` mid-turn is accepted and reflected as `user_message` in the same run. |
| `background-tasks` | engine-backgrounded work outliving the turn is observed end-to-end: the lifecycle family is emitted, the first `result` is **not** terminal, the engine's wake-up produces a continuation turn and a further `result` before `done`, and the control channel is still live across the hold. Absent on adapters whose SDK never backgrounds work (M17's skip strategy). |
| `abort` | `abort()` mid-stream ends the run cleanly (`AdapterAbortError`, channel closed). |
| `unknown-model` | an unknown alias warns and passes through (the SDK, not the adapter, rejects it). |
| `usage` | billing vs `contextSize` and cache buckets are legible on the `result`. |

*Coverage* — which scenarios a given adapter runs, and against which model(s) — is **per-adapter**, owned in the adapter file (one-home for coverage), not a matrix here. *Per-capability nuance* — which assertion proves a capability — lives beside that capability's support matrix in its owning module. See <section_ref anchor="ye2ecov1"/>.

**Model matrix & verified range.** claude-code parametrizes the suite over the whole M02 model catalog (`E2E_CLAUDE_MODEL`, the `test:e2e:claude:*` scripts); other adapters pin one model per file. The suite run is also the evidence for L7's *declared range == verified range*: a peer-SDK bump re-runs the full suite before the range is narrowed (see <section_ref anchor="qno516sg"/>).

<!-- anchor: agvf1tok -->
## Public API & Packaging (L4)

- **Semver** — the contract is versioned; additive `UnifiedEvent`/param changes are minor, removals/renames are major.
- **Behavioral-hardening note (minor + CHANGELOG).** A change that only tightens an opt-in surface without changing its type signature stays **minor**, but when it alters runtime behavior a consumer already relies on, the release MUST carry an explicit behavioral CHANGELOG note. Reference case: the M15 path-scope hardening — the soft claude-code gate moves from deny-only to allow-confinement (and drops `bypassPermissions` when scope is requested). Additive at the type level, but behaviorally significant for consumers using path-scope today, so it ships as a minor with a "security-hardening: path-scope now confines to `cwd ∪ allowedPaths`, not deny-only" note rather than silently.
- **Worked case — M18 tool gating is a major, and the two halves ride it for different reasons.** The `allowedTools` → `autoApproveTools` rename falls under the removals-and-renames rule above, with no room for judgement: the old name disappears. The plan-mode change is the *other* rule — behavioral hardening — because `planMode: true` on the adapter that previously ignored it with a console warning now refuses the run. It would have been a minor-plus-note on its own; it rides the rename's major instead of waiting, and the CHANGELOG names the opt-out explicitly (an empty `disallowedToolGroups`). Recording both here matters because "it's a security fix" is not a semver category — the rename is what makes the major mandatory.
- **Deprecation policy** — a superseded surface (e.g. `elicitation_request` / `onElicitation`) is retained and bridged for at least one major before removal.
- **Contract-extension checklist** — adding an event/field requires: update `types.ts` with JSDoc naming supporting adapters; update every adapter (map / synthesize / document-unsupported with a one-shot `warning`); add `shared.ts` assertions; add a per-adapter e2e case — and, if it introduces a new real-model scenario, add it to the scenario catalog (see <section_ref anchor="xe2ecat1"/>), record it in each covering adapter's e2e coverage list, and add its AC entity; bump the capability matrix; bump the version on release.
- **Release process** — install → typecheck → test → build → publish (mirrors the `.buddy` pipeline), then changelog + tag.
- **Peer-SDK bump workflow (spec-first).** A dev-pin bump is edited **in the spec before it is edited in `devDependencies`** — the same canon rule the M02 model catalog follows. Order: (1) the consumer's L7 section changes first — the pin named in *Supported peer-SDK range* plus a new Verified-pin-log row carrying `findings: pending verification` (see <section_ref anchor="qno516sg"/>); (2) a release brief carries that bump to the implementer; (3) the implementer updates `devDependencies`, runs the **full** e2e suite for that consumer (`test:e2e:<adapter>`, × the model scripts where the adapter is parametrized), and writes the result — including "none observed" — back into the pending row through the patch-feedback channel. A bump whose row is never completed is an unfinished bump, not a passing one. Deliberately **no multi-version test matrix**: exactly one verified pin per consumer at a time; the log carries the history that a matrix would otherwise have to carry in CI.

<!-- anchor: f718z382 -->
## Edge cases

- Adapter omits a required event → `ContractResult` fails the relevant assertion with a specific message; the suite does not silently pass.
- A new contract feature only one adapter can emit → must be documented in the type JSDoc and degrade in the others, or conformance/degradation tests flag the gap.
- Credentials missing in CI → e2e tests **skip**, never fail, so the contract suite stays green without secrets.

<!-- anchor: 9zhdfqmb -->
## Acceptance criteria

These verify the toolkit catches non-conformance and that contract growth follows the documented policy.

<tagged_list type="ac" tags="m12"/>
