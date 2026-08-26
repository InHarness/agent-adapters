<!-- anchor: pn4364qc -->
# M18 — Built-in tool gating (deny-groups)

> A declarative, engine-neutral contract for amputating whole *classes* of built-in capability from a run — shell, filesystem reads, filesystem writes, web — realized by each adapter with its SDK's native primitive, and refused before dispatch when no primitive exists.

<!-- anchor: f361hqgc -->
## Purpose

Consumers who need an agent to run with a capability removed — "research this, but no shell and no filesystem" — can declare that intent once, in engine-neutral terms, instead of hand-assembling a per-SDK list of tool names that rots with every SDK release. Which identifiers constitute "the shell" on a given engine is knowledge that belongs to the adapter defining that toolset, not to the consumer — the same knowledge-placement argument M15 makes for paths.

M18 owns the group vocabulary, the preset registry (`planMode` is one), the per-adapter support matrix with its strength gradation and its **escape surfaces**, the fail-closed degradation contract, and the composition rules against M15 path-scope and `autoApproveTools`. It is deliberately **built-ins only**: MCP tools are out of scope (see M04), as are per-command, network and rate-limit policies, which stay parked in <section_ref anchor="0aj92zki"/> as a later increment. M18 fixes the group vocabulary so those can be layered on without renaming anything.

**Why declarative, not a hook.** This module resolves the open question that posited a low-level `onToolPermission`-style escape hatch. A hook was rejected on two grounds: it hands the consumer back the per-SDK tool-shape knowledge this module exists to absorb, and — decisively — it cannot answer *before* the run. A consumer building a security boundary must learn that its policy is unenforceable while it can still refuse to dispatch, not on the first tool call of a live stream. A declarative deny-list is answerable synchronously; a hook is not.

<!-- anchor: uvxkq54b -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | New optional `disallowedToolGroups` field and the `ToolGroup` union on `RuntimeExecuteParams` (type home: M01). |
| L2 | New `toolGating` capability flag (a plain bool, like `pathScope`) + this module's support matrix, strength axis, escape surfaces and fail-closed degradation. |
| L3 | The preset registry (`planMode` desugars into a deny-list); the field is immutable on resume. |
| L4 | Exports the `ToolGroup` type, the preset constant, `probeToolGating` and the new error class. Semver **major**. |
| L5 | Conformance shape: a denied group's tools are absent from the adapter's catalog, or the run throws — plus one negative case per documented escape surface. |
| L7 | Pinned tool names, deprecated primitives, stale schema mirrors and SDK/binary version skew are all named drift surfaces. |
| M01 | `RuntimeExecuteParams` type home; `architectureCapabilities` gains the `toolGating` bool; `probeToolGating` lives beside the path-scope probe. |
| M04 | Scope boundary — MCP tools are **not** gated by this module. |
| M05 | A skill can drive the shell, so a `shell` deny must decide the fate of the `Skill` tool. |
| M06 | Deny-groups propagate into every subagent definition — without that, A01's `shell` gate is holed by construction. |
| M07 | Resume immutability — the field must not change mid-session; `findResumeViolations` is extended to cover it. |
| M12 | Semver justification, the per-adapter conformance cases and a new e2e scenario-catalog row. |
| M13 | `AdapterToolPolicyError`, a new `AdapterError` subclass for a refused policy. |
| M15 | Composition — M18 removes capability classes, M15 bounds the filesystem, but on A01 they contend for the same rule surfaces. |
| M17 | Background tasks *are* shell tasks; a `shell` deny disables M17 for that run. |

<!-- anchor: 4j6f86yq -->
## Unified Contract (L1)

One optional field on `RuntimeExecuteParams` (defined in M01, see <section_ref anchor="8do90d06"/>):

- `disallowedToolGroups?: ToolGroup[]` — the classes of built-in capability this run may not use.
- `type ToolGroup = 'shell' | 'file-read' | 'file-write' | 'web'`

Group definitions are normative — an adapter maps identifiers to these meanings, not the reverse:

- **shell** — executing an OS command in any form, *including* background-process inspection and any general-purpose code-execution tool (a JavaScript REPL is a shell).
- **file-read** — reading, listing or searching files.
- **file-write** — creating, editing or deleting files, and persisting memory.
- **web** — fetching URLs and web search.

Contract semantics (stated explicitly — ambiguity here is a security hole):

- **Absent field = today's behavior, byte for byte.** An empty array is a no-op.
- **Deny-only and additive.** The field is unioned with any preset-derived groups (L3); a preset can never be weakened by omitting it here.
- **Validation.** An unknown group string is refused pre-dispatch with the same error class as an unenforceable group; duplicates collapse; order is insignificant.
- **The consumer contract is deny-shaped; the adapter side is allow-shaped.** Each adapter derives a **residual allow-list** from the requested groups wherever its SDK offers one, and uses deny entries only as a backstop. The invariant this buys: *a built-in the library has never heard of is blocked, not allowed.* A deny-list alone is fail-open by construction — every SDK release that adds a tool silently widens the run. An adapter with no allow-list primitive is deny-only and is therefore capped at `soft` strength (L2).
- **A deny outranks `autoApproveTools`.** That field means *auto-approve*, not *restrict*; it can never re-widen a denied group.
- **Composition with M15 is not orthogonal — it is ordered.** M15 bounds *where* the filesystem may be touched; M18 removes *whether* a class of tool exists. On adapters where both land on the same rule surface, an M18 deny is applied last and is never re-widened by an M15-generated allow rule. The per-adapter mechanics are in L2; M15's edge cases carry the reciprocal statement (<section_ref anchor="x2258xmh"/>).

<!-- anchor: 1yllld10 -->
## Capability & Degradation (L2)

- **Capability flag.** `architectureCapabilities(arch).toolGating: boolean` — a plain bool, consistent with the flat-flag mechanism owned by M01/L2 (<section_ref anchor="nbgtn5nk"/>), advertising only whether a gating mechanism exists at all. It deliberately says nothing about strength.
- **Strength axis (separate from the bool).** Following the M15 precedent (<section_ref anchor="8pg5iti3"/>), each adapter/group pair carries a strength: **hard** (enforced outside the model — OS sandbox or server-side refusal), **soft** (the tool is removed from the model's context or catalog, which is a model-behaviour gate, not a sandbox), or **none**. One bool cannot carry a security guarantee; a consumer that must distinguish "the tool is gone from the prompt" from "the syscall is refused" reads this matrix, not the flag.
- **Escape surfaces are canon.** Every known way a denied group can still be reached is listed below and reported by the probe. **A group with a known escape surface is never reported `hard`.**
- **Runtime probe.** `probeToolGating(arch, requestedGroups)` returns, per requested group, `{ group, enforceable, strength, escapeSurfaces }`, computed synchronously **before** dispatch. As with M15's gate strength, a post-hoc `warning` is insufficient for a security control: the consumer must be able to refuse to run.

**Support matrix — capability and strength**

| Adapter | `toolGating` | shell | file-read | file-write | web | Native mechanism |
| --- | :---: | --- | --- | --- | --- | --- |
| **claude-code (A01)** | ✅ | soft ⚠ | soft ⚠ | soft | soft | Residual allow-list of built-ins, with a deny backstop that removes the tool from model context. Mechanics in A01 (<section_ref anchor="sw3cwrsm"/>). |
| **codex (A02)** | ⚠️ partial | **none → throw** | **none → throw** | hard, coarse | hard, coarse | Whole-run sandbox posture plus a web-search toggle; no per-tool primitive. Mechanics in A02 (<section_ref anchor="rdl4n5wk"/>). |
| **opencode (A03)** | ✅ | hard ⚠ | hard ⚠ | hard ⚠ | hard ⚠ | Server-side permission buckets with a wildcard default; deny is refused before execution, not prompted. Mechanics in A03 (<section_ref anchor="3iaufx4q"/>). |
| **gemini (A04)** | ✅ | soft ⚠ | soft | soft | soft | Tool-registry exclusion, applied before the approval policy. Mechanics in A04 (<section_ref anchor="oirynpg7"/>). |

**Escape surfaces**

- **A01 `shell`** — a spawned subagent does not inherit the parent's tool denies, and the SDK ships a general-purpose code-execution tool alongside the shell. M06 propagation of the deny-groups into every subagent definition is what closes this; until then the group is `soft` (<section_ref anchor="677rc2wh"/>). The asymmetry with M15 — denies leak across delegation, filesystem scope does not — is by construction rather than an inconsistency: a deny must be propagated because the SDK does not carry it into a subagent, while path-scope needs no propagation because no field of the subagent envelope can express a scope and the one SDK field that could re-open one is never set (<section_ref anchor="6fh6yq89"/>).
- **A01 `file-read`** — the SDK documents that native builds may serve search through the shell rather than the dedicated search tools, so a read deny is bypassable whenever `shell` is allowed.
- **A01 `web`** — a built-in MCP web-fetch identifier that the deny mechanism does not reliably filter.
- **A03 (all groups)** — the permission schema ends in a catch-all, so an unknown, mistyped or not-yet-supported bucket name is accepted and **silently ignored, with no validation error**. Enforcement is hard only against a server version known to consume that bucket; against an older server it degrades to a no-op with no signal. The adapter therefore reports `hard` only for buckets it has confirmed. See L7 for the version skew that makes this live.
- **A04 `shell`** — background-process tools are registered outside the enumerated built-in set and survive an exclusion aimed at the shell tool alone.

**Degradation — fail-closed, and honest about it.** M15 degrades with `warn`; M18 deliberately does not. Asking for the shell to be removed and receiving a warning plus a live shell is a silent security failure.

1. **Unenforceable → throw before dispatch.** A requested group with no primitive on the target adapter refuses the run pre-dispatch, never mid-stream. There is no partial application: if the policy cannot be honoured, nothing runs. The error is `AdapterToolPolicyError`, a new subclass in M13's hierarchy (<section_ref anchor="8q9q7ty7"/>), carrying the adapter id, the unenforceable groups, and the enforceable ones with their strength. It is the only class in that hierarchy raised *before* a run starts — a refusal rather than a failure.
2. **Enforceable but `soft` → run, and say so.** The strength and escape surfaces are reported through the probe and a startup event.
3. **Porous combination → one-shot `warning`.** Groups are independent — denying `file-write` does not auto-deny `shell`, because they are orthogonal capabilities and auto-denying would surprise the consumer. But `file-write` or `file-read` denied while `shell` remains available is not a boundary, and the run says so rather than shipping the illusion silently.

**Composition mechanics.**

- **A01.** Four rule surfaces exist at once: the built-in allow-list, the deny backstop, the settings permission rules, and the OS-sandbox filesystem rules. An M18 deny rides the **allow-list and the deny backstop only — never the settings permission rules**. The reason is M15: soft path-scope switches the run to a default-deny permission mode in which anything not *pre-approved* is refused, and pre-approval flows through the allow channel that M15 and `autoApproveTools` both write to. A deny expressed as a settings rule would sit on a surface those can widen. The deny backstop cannot be widened — it is documented to win even over an otherwise-allowed tool, and it strips the tool before the model sees it. A corollary the spec states so it is not "optimized" later: moving `file-write` onto the settings deny surface would lose the removed-from-context property.
- **A02.** The permission-profile family that could express a read denial is documented as incompatible with the sandbox posture that `planMode` already claims, and is unreachable through the SDK's config passthrough in any case (L7). M18 stays on the sandbox posture plus the web-search toggle, which is why `file-read` throws rather than mapping.
- **A03.** The adapter stops asserting a blanket allow and derives its permission buckets from the deny-groups, defaulting the remainder through the wildcard.
- **M17.** A `shell` deny disables background tasks for that run — a background task is a shell task.
- **M05.** A `shell` deny suppresses the `Skill` tool, which is otherwise whitelisted even in plan mode: a skill can drive the shell, so leaving it available would reopen the group.

<!-- anchor: c0b6eyl5 -->
## Configuration & Extensibility (L3)

- **Preset registry.** Presets are library-built deny-lists so consumers do not hand-assemble them. `planMode: true` → `['file-write', 'shell']` — reads and web stay available, because plan mode must still research. The registry is canon here and is exposed as a named constant through L4 so consumers can inspect and extend it. Every adapter's plan-mode handling goes through the deny-group path; there are no per-adapter plan-mode special cases.
- **A preset is not a weaker mode.** It desugars into exactly the same deny-groups and inherits fail-closed — one semantics, no special case for the path the consumer arrived by. The consequence is a behavioral change on the adapter that previously ignored plan mode with a console warning: it now throws. The documented opt-out is an explicit empty `disallowedToolGroups`.
- **Resume immutability.** A capability gate must not shrink or grow mid-session. `disallowedToolGroups` is a `RuntimeExecuteParams` field, not an `ArchOption` key, so it joins the designated always-immutable set that M07 already maintains for M15's path fields (<section_ref anchor="sjvy01iz"/>).

<!-- anchor: lgos60o9 -->
## Public API & Packaging (L4)

Exported: the `ToolGroup` type, the preset constant, `probeToolGating`, and `AdapterToolPolicyError` (per <section_ref anchor="9dv305bn"/>). The field itself is additive and absent-field behavior is unchanged, but the release is **major** on the rename of `allowedTools` → `autoApproveTools`, which M12's rule puts squarely in the removals-and-renames bucket (<section_ref anchor="agvf1tok"/>). The plan-mode hardening rides that same major with an explicit behavioral CHANGELOG note.

`autoApproveTools` gains the documentation it never had — it auto-approves, it does not restrict — and the three adapters that ignore it gain the one-shot `warning` the L2 degradation convention already requires.

<!-- anchor: 98smnxap -->
## Testing & Conformance (L5)

Conformance shape per group and adapter: **a denied group's tools are absent from the adapter's catalog, or the run throws pre-dispatch.** Two additions beyond the usual matrix sweep:

- **A negative case per escape surface.** Each documented hole gets a test that demonstrates it, so the hole cannot quietly become an untested assumption — and so that closing one (M06 subagent propagation) is observable as a test flipping.
- **The residual-allow-list invariant.** A built-in the library does not know about must be blocked; the test asserts the *shape* of what is sent to the SDK, not just the behavior of today's tool set.

A new `tool-gating` scenario joins the catalog (<section_ref anchor="xe2ecat1"/>) beside `plan-mode` and `path-scope`, and `plan-mode`'s own catalog entry is re-pointed at this module, since the preset is what it now proves. The real-model form matters here more than usual: only a live model distinguishes *"the tool is gone"* from *"the model chose not to use it"*, and a gate proven only by inspecting the options object proves the wiring, not the boundary. Per-adapter coverage stays in the adapter files (<section_ref anchor="a01e2ecv"/>).

<!-- anchor: pj0py9m4 -->
## SDK version compatibility & schema drift (L7)

This module is unusually drift-exposed: it pins identifiers and configuration keys across four SDKs, and a silent drift here does not break a build — it opens a gate.

- **Pinned tool identifiers.** Every group→identifier mapping is a drift surface. Renames have already happened in this ecosystem, and legacy aliases may resolve alongside current names, so a deny must cover both.
- **A04's exclusion primitive is deprecated** in favour of a policy engine. It still applies before the approval policy — which is why an auto-approving mode does not bypass it — but the migration is a scheduled drift.
- **A03's typed schema is a stale mirror** of the server's, typing a fraction of the buckets the server consumes. Types must not be treated as the contract here. Compounding it: this repo's pin, the resolved SDK version and the separately installed server binary can be three different versions, because the SDK does not contain the server. This is what makes the silent catch-all in L2 a live risk rather than a theoretical one.
- **A02's config passthrough mangles keys.** Nested configuration is flattened into dotted paths by raw concatenation, without quoting a segment — so absolute paths, glob patterns and reserved tokens mis-parse. This is the mechanical reason the permission-profile family is unreachable. Separately, the SDK's web-search mode type omits a documented value.
- **A01's permission evaluation order** may be stated only in the split the evidence supports: *evidenced* — the deny backstop beats the allow channel, settings deny-rules beat the bypass mode, and the interactive callback runs last; *observed on the pinned version* — hooks precede the mode and the allow channel. It must **not** be written as a single short-circuiting chain, because the default-deny mode inverts the mode-versus-allow relationship. Nor may the deny backstop be called a "deny rule": the SDK reserves that phrase for the settings mechanism, which is a different surface.

<!-- anchor: kztplcjf -->
## Edge cases

- Field absent or empty → no-op, identical to current behavior.
- Unknown group string → refused pre-dispatch, same error class as an unenforceable group. Duplicates collapse; order is insignificant.
- A preset and an explicit deny naming the same group → union, no double-application and no weakening.
- `file-write` denied while `shell` is allowed → **not a security boundary**; the run proceeds and emits the porous-combination warning. The same holds for `file-read`.
- `file-read` denied on an adapter whose search can fall back to the shell → the deny holds only for the dedicated tools; with `shell` allowed it is bypassable, which is why the group reports `soft` with a named escape surface.
- MCP tools are not covered → a filesystem MCP server is **not** blocked by denying `file-read` and `file-write`. Consumers needing that must gate the server itself (M04).
- Subagents → a deny that does not propagate into subagent definitions is not a deny at all; M06 carries the propagation.
- Background tasks under a `shell` deny → M17's capability is disabled for that run rather than failing at the first task.
- A group requested on an adapter with no primitive → nothing runs. Partial application is never offered, because a half-applied capability gate reads as a whole one.
- Resume with a changed `disallowedToolGroups` → a resume violation, like the M15 path fields.
- An SDK adds a built-in the library does not know → blocked, on adapters with an allow-list primitive; on deny-only adapters it is allowed, which is exactly why those are capped at `soft`.

<!-- anchor: 2rln5a4l -->
## Acceptance criteria

These verify the no-op guarantee when the field is absent, per-group enforcement and its declared strength on each adapter, the pre-dispatch refusal where no primitive exists, the residual-allow-list invariant, precedence over both M15 and `autoApproveTools`, preset desugaring, subagent propagation and resume immutability.

<tagged_list type="ac" tags="m18"/>

Edge-case criteria — deliberately including the documented holes rather than only the guarantees, because an escape surface that no criterion names is indistinguishable from one nobody noticed:

<tagged_list type="ac" tags="m18-edge"/>
