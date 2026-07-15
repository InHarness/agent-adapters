<!-- anchor: ksw7801f -->
# M15 — Filesystem path scoping (sandbox)

> A declarative, engine-neutral contract for hard-bounding the filesystem an agent's tools may touch: the consumer states *intent* (`allowedPaths` / `disallowedPaths`) and each adapter realizes it with its SDK's native primitives — an OS-level sandbox where available, permission rules otherwise.

<!-- anchor: ot3zqa0a -->
## Purpose

Consumers building a hard filesystem sandbox around an agent (e.g. C4S's *Agent Path Scoping*) can declare, once and in engine-neutral terms, which paths the agent's tools may read and write — and have every adapter enforce that intent with whatever native primitive its SDK offers, instead of each consumer re-deriving "which tool argument is a path / how to parse a Bash `command` / how an `mcp__` tool maps to a file". That knowledge of tool shape belongs to the adapter that defines the toolset, not to the consumer.

M15 owns the two optional `RuntimeExecuteParams` fields, their precedence and normalization semantics, the per-adapter support matrix with its strength/expressiveness gradation, and the degradation contract — including the security-critical case where the *declared* gate strength can silently weaken at runtime. It is deliberately **FS-only**: non-path policies (network, specific-tool gating, rate limits) are out of scope and belong to a future generic tool-permission hook — a sibling that composes with M15, not a competitor (see <index> Open questions).

<!-- anchor: xtryst7i -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | New optional `allowedPaths` / `disallowedPaths` fields on `RuntimeExecuteParams` (type home: M01). |
| L2 | New `pathScope` capability flag (a plain bool, like `midTurnPush`) + this module's path-scope support matrix and degradation (warn; hard→soft). |
| L3 | Path-scope fields are immutable on resume — extends M07's resume mechanism to designated `RuntimeExecuteParams` fields. |
| L4 | Additive type exports; absent fields preserve today's behavior. Semver **minor**. |
| M01 | `RuntimeExecuteParams` type home; `architectureCapabilities` gains the `pathScope` bool (flat-flag mechanism unchanged). |
| M07 | Resume immutability — path-scope fields must not change mid-session; `findResumeViolations` is extended to cover them. |

<!-- anchor: j4a1hr2q -->
## Unified Contract (L1)

Two optional fields on `RuntimeExecuteParams` (defined in M01):

- `allowedPaths?: string[]` — absolute directory prefixes that, together with the implicit base, define the **ceiling** of what the agent's tools may read and write.
- `disallowedPaths?: string[]` — carve-outs excluded from within that ceiling.

Contract semantics (stated explicitly — ambiguity here is a security hole):

- **Implicit base = `cwd`.** Both empty/absent → no-op; today's behavior is unchanged.
- **Confinement, not deny-only.** When either field is present the agent's reads and writes are **bounded to `cwd ∪ allowedPaths`** — anything outside that set is unreachable *even if it is not named in `disallowedPaths`*. `disallowedPaths` is an additional carve-out *within* the ceiling, not the sole mechanism. An adapter that can only express denies (see L2) MUST still realize this allow-confinement; a soft gate that is merely a deny-list is a documented expressiveness limitation, not conformance.
- **Precedence: `disallowedPaths` > `allowedPaths` > base(`cwd`)** — read as *narrowing a ceiling*: `allowedPaths` widen the base up to the ceiling, `disallowedPaths` subtract from it.
- **Scope = read AND write together** — a hard FS gate in both directions. A future read/write split is a possible extension (Claude/Codex natively distinguish allow/denyRead vs allow/denyWrite — see <index> Open questions).
- **Input syntax = absolute directory prefixes.** Each adapter translates prefixes into its SDK's native rule/glob syntax. Relative inputs are **normalized against `cwd`** before mapping (not rejected). Glob is a future extension.
- **Gate strength is a separate, declared signal** (hard OS-sandbox vs soft model-visible permission rule) — see L2. It is **not** folded into the flat capability bool.

<!-- anchor: 8pg5iti3 -->
## Capability & Degradation (L2)

- **Capability flag.** `architectureCapabilities(arch).pathScope: boolean` — a plain bool, consistent with the existing flat-flag mechanism owned by M01/L2, advertising only whether the adapter honors the fields at all. The mechanism and the warn/skip/synthesize taxonomy are unchanged; M15 adds exactly one flag.
- **Strength signal (separate from the bool).** Because one bool cannot express *how hard* the gate is, M15 owns a separate per-adapter descriptor along three axes: gate **strength** (hard, OS-enforced / soft, model-visible / none), **expressiveness** (deny-expressible fine-grained vs allow-list-only), and **config-discovery containment** — whether the bounded run also cuts off *ambient* config/skill discovery (global settings, `~/.claude`-style home tiers) that could otherwise re-widen the agent's reach outside the declared scope. Hard-bounding a filesystem is incomplete if the agent can still load global configuration or skills from outside it; a real confinement severs that channel too. This is M15-owned data (one-home rule), deliberately kept out of the flat capability map so the L2 mechanism stays a bool taxonomy. The *mechanism* by which each adapter severs discovery is adapter-specific and lives in that adapter's file (e.g. A01's setting-source narrowing), not here.
- **Expressiveness ⇒ confinement obligation.** A deny-expressible adapter MUST use its expressiveness to realize allow-confinement (bound to `cwd ∪ allowedPaths`), not merely to publish a deny-list. If an adapter can only realize a deny-list under a given mode, that is an explicit expressiveness limitation the consumer must be able to read from this matrix — never a silent "scoped" claim.

| Adapter | `pathScope` | Strength | Expressiveness | Native mapping |
| --- | :---: | --- | --- | --- |
| **claude-code (A01)** | ✅ | soft default; **hard-capable** (OS sandbox opt-in) | deny-expressible → allow-confinement | Soft: default-deny permission mode + allow-rules for `cwd ∪ allowedPaths` and deny-rules for `disallowedPaths` (confinement, not a bare deny-list). Hard: opt-in `sandbox.enabled` flips to OS-syscall enforcement (`allowWrite`/`denyWrite`/`denyRead` plus managed allow-read confinement for reads). Bounded runs also narrow config/skill discovery. Mechanics in A01 (<section_ref anchor="sw3cwrsm"/>). |
| **codex (A02)** | ✅ | hard (OS), coarse | allow-only | `allowedPaths` → `sandboxMode: 'workspace-write'` + `additionalDirectories` (writable roots); full block → `'read-only'`. Already allow-only confinement, so it satisfies the tightened contract. Must **compose** with any existing `codex_sandboxMode` / `additionalDirectories` and plan mode (narrow, never overwrite). |
| **opencode (A03)** | ❌ | none | — | no per-call path sandbox; fields → one-shot `warning`, operations run normally (unchanged by the tightened contract). |
| **gemini (A04)** | ⚠️ to verify | soft (if any) | — | possibly `targetDir` / include-directories; if it cannot honor the fields → `warning` like opencode. |

**No regression for the other adapters.** The tightened confinement contract re-specifies only claude-code (which was previously deny-only under a soft gate). codex already realizes allow-only confinement via `workspace-write`, so it conforms as-is; opencode stays `none` → `warning`; gemini remains to-verify. The change does not alter the behavior any conforming adapter already had.

- **Degradation — always warn, two flavors:**
  1. **unsupported → warn.** An adapter with `pathScope: false` (opencode) emits a one-shot `warning`; operations proceed normally. Never an "unsupported" throw.
  2. **hard→soft → warn.** An adapter that can only offer a soft gate on the host (e.g. claude-code without an OS sandbox available) emits a `warning` so the consumer knows the gate is model-visible, not OS-enforced.
- **Static capability vs host-dependent strength (security-critical).** `architectureCapabilities` is static per-architecture, but claude-code's hard gate depends on bubblewrap (Linux) / seatbelt (macOS) being present on the host *at runtime*. So the static signal is at most **hard-capable**, never a runtime guarantee of "hard". A consumer building a security sandbox MUST obtain runtime confirmation (a probe / startup event) **before** dispatch — an ephemeral post-hoc `warning` is insufficient for a security gate. M15 therefore separates the *declared* (static) capability from a *runtime-confirmed* strength signal surfaced ahead of the run.

<!-- anchor: 04yb4iiw -->
## Configuration & Extensibility (L3)

- **Resume immutability.** A sandbox must not shrink or grow mid-session, so `allowedPaths` / `disallowedPaths` are immutable across resume. These are `RuntimeExecuteParams` fields, **not** `ArchOption` keys, so M07's existing `resumeImmutable`-on-`ArchOption` mechanism does not cover them as written: M07 is extended to treat designated `RuntimeExecuteParams` fields as always-immutable, and `findResumeViolations` reports a change to either field. See M07.

<!-- anchor: 2vt09vgw -->
## Public API & Packaging (L4)

The two fields and the `pathScope` capability are additive; absent fields preserve today's behavior, so the surface change is non-breaking. Semver: **minor** — but the tightening of soft claude-code scope from deny-only to allow-confinement changes already-relied-upon runtime behavior for consumers who use path-scope today, so it ships as a minor with an explicit **behavioral CHANGELOG note** ("path-scope now confines to `cwd ∪ allowedPaths`, not deny-only"). See M12 (<section_ref anchor="agvf1tok"/>).

<!-- anchor: x2258xmh -->
## Edge cases

- Both fields empty/absent → no-op, identical to current behavior (backward compatible).
- File outside `cwd ∪ allowedPaths` but **not** listed in `disallowedPaths` → still unreachable (read and write). Confinement bounds to the ceiling; a path's absence from `disallowedPaths` does not make it reachable.
- `disallowedPaths` carve-out on an allow-list-only adapter (codex) → the fine-grained deny is **not** guaranteed, but the allow-confinement (bound to `cwd ∪ allowedPaths`) still holds; the limitation is surfaced via the matrix so the consumer never assumes a fine-grained deny is enforced where it is not.
- Host without an OS sandbox on a hard-capable adapter → hard→soft degradation with a `warning`; the gate becomes model-visible but stays a confinement (allow-bounded), not a bare deny-list.
- Read confinement in hard mode → reads are cut off at the OS level only when the adapter supplies managed allow-read confinement (the default read model is deny-based; simply *allowing* the scope does not exclude the rest). Under the soft gate reads are confined by the default-deny permission mode instead.
- Bash writing outside scope → blocked at the syscall level when the OS sandbox is enabled (no `command` parsing needed); only soft-protected under permission rules.
- Ambient config/skill discovery under a bounded run → global home-tier config and skills (e.g. `~/.claude`) are no longer auto-loaded, so the agent cannot re-widen its scope via ambient configuration; the containment mechanism is adapter-specific (see the adapter file).
- Relative path input → normalized against `cwd` before mapping (not rejected).
- MCP file tools → the OS sandbox covers child processes; permission rules cover built-ins (`Read`/`Edit`). Files touched by MCP tools outside the built-ins may fall outside the soft gate — a documented boundary the consumer must account for.
- Composes with `planMode` → both narrow (planMode hides mutating built-ins; path-scope bounds the FS of the allowed tools); they sum, never cancel.

<!-- anchor: ffwhq41t -->
## Acceptance criteria

These verify the precedence/normalization semantics, the hard vs soft gate strength (including the host-dependent degradation), the allow-only limitation on codex, and backward compatibility when the fields are absent.

Real-model proof: the e2e `path-scope` scenario (reads/writes confined to `cwd ∪ allowedPaths`; a path outside scope blocked) and the related `plan-mode` scenario exercise this against a live model — scenario catalog in M12 (<section_ref anchor="xe2ecat1"/>); per-adapter coverage in the adapter files (<section_ref anchor="a01e2ecv"/>).

<tagged_list type="ac" tags="m15"/>
