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

<!-- anchor: agvf1tok -->
## Public API & Packaging (L4)

- **Semver** — the contract is versioned; additive `UnifiedEvent`/param changes are minor, removals/renames are major.
- **Behavioral-hardening note (minor + CHANGELOG).** A change that only tightens an opt-in surface without changing its type signature stays **minor**, but when it alters runtime behavior a consumer already relies on, the release MUST carry an explicit behavioral CHANGELOG note. Reference case: the M15 path-scope hardening — the soft claude-code gate moves from deny-only to allow-confinement (and drops `bypassPermissions` when scope is requested). Additive at the type level, but behaviorally significant for consumers using path-scope today, so it ships as a minor with a "security-hardening: path-scope now confines to `cwd ∪ allowedPaths`, not deny-only" note rather than silently.
- **Deprecation policy** — a superseded surface (e.g. `elicitation_request` / `onElicitation`) is retained and bridged for at least one major before removal.
- **Contract-extension checklist** — adding an event/field requires: update `types.ts` with JSDoc naming supporting adapters; update every adapter (map / synthesize / document-unsupported with a one-shot `warning`); add `shared.ts` assertions; add a per-adapter e2e case; bump the capability matrix; bump the version on release.
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
