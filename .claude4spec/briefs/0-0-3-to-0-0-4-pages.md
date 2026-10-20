---
type: brief
source: release-diff
from_release: 0.0.3
to_release: 0.0.4
generated_at: '2026-07-05T15:18:18.669Z'
generator_version: brief-author@0.1
implemented: false
roots:
  - pages
---
# Brief: 0.0.3 → 0.0.4

## Summary

Release 0.0.4 hardens filesystem path-scoping (module M15) from a **deny-only soft gate** into real **allow-confinement**. When a consumer declares `allowedPaths` / `disallowedPaths` on `RuntimeExecuteParams`, the agent's reads and writes are now bounded to the ceiling `cwd ∪ allowedPaths` — anything outside that set is unreachable **even if it is not named in `disallowedPaths`**. The claude-code adapter (A01) is the only adapter re-specified: its soft gate stops applying the blanket `permissionMode: 'bypassPermissions'` in favor of a default-deny mode, its opt-in OS sandbox gains managed allow-read confinement, and a bounded run now also severs ambient global config/skill discovery (`~/.claude`) so the agent cannot re-widen its own reach. Because this changes runtime behavior that consumers using path-scope already rely on, it ships as a semver-**minor** with a mandatory behavioral CHANGELOG note — a new policy added to M12. No type signatures change; the fields already existed in 0.0.3.

This is a single-theme release. Every entity and page change below serves the path-scope hardening.

## 1. Contract semantics: deny-only → allow-confinement (M15 / L1)

The two optional fields on `RuntimeExecuteParams` are unchanged in type but redefined in meaning.

Before (0.0.3):
- `allowedPaths?: string[]` — "absolute directory prefixes the agent's tools may access **beyond** the implicit base."
- `disallowedPaths?: string[]` — "carve-outs excluded from the allowed set."
- Precedence: `disallowedPaths > allowedPaths > base`.

After (0.0.4):
- `allowedPaths?: string[]` — absolute directory prefixes that, together with the implicit base, define the **ceiling** of what the agent's tools may read and write.
- `disallowedPaths?: string[]` — carve-outs excluded from **within** that ceiling.
- **Confinement, not deny-only.** When either field is present, reads and writes are bounded to `cwd ∪ allowedPaths`; a path outside that set is unreachable even when absent from `disallowedPaths`.
- Precedence ordering is the same (`disallowedPaths > allowedPaths > base(cwd)`) but is now read as **narrowing a ceiling**: `allowedPaths` widen the base up to the ceiling, `disallowedPaths` subtract from within it.
- Implicit base remains `cwd`; both fields empty/absent is still a no-op (backward compatible). Relative inputs are normalized against `cwd`. Scope covers read AND write together.
- An adapter that can only express denies MUST still realize this allow-confinement; a soft gate that is merely a deny-list is now a documented **expressiveness limitation**, not conformance.

## 2. Strength descriptor gains a third axis + confinement obligation (M15 / L2)

M15's per-adapter strength descriptor grew from **two** axes to **three**:

- gate **strength** — hard (OS-enforced) / soft (model-visible) / none
- **expressiveness** — deny-expressible fine-grained vs allow-list-only
- **config-discovery containment** (new) — whether the bounded run also cuts off *ambient* config/skill discovery (global settings, `~/.claude`-style home tiers) that could otherwise re-widen the agent's reach outside the declared scope.

New rule — **Expressiveness ⇒ confinement obligation**: a deny-expressible adapter MUST use its expressiveness to realize allow-confinement (bound to `cwd ∪ allowedPaths`), never merely to publish a deny-list. If it can only realize a deny-list under some mode, that is an explicit limitation the consumer must be able to read from the matrix.

Updated support matrix:

| Adapter | `pathScope` | Strength | Expressiveness | Native mapping |
| --- | :---: | --- | --- | --- |
| claude-code (A01) | ✅ | soft default; hard-capable (OS sandbox opt-in) | deny-expressible → allow-confinement | Soft: default-deny permission mode + allow-rules for `cwd ∪ allowedPaths` and deny-rules for `disallowedPaths`. Hard: opt-in `sandbox.enabled` → OS-syscall enforcement (`allowWrite`/`denyWrite`/`denyRead` + managed allow-read confinement). Bounded runs also narrow config/skill discovery. |
| codex (A02) | ✅ | hard (OS), coarse | allow-only | `allowedPaths` → `sandboxMode: 'workspace-write'` + `additionalDirectories`; full block → `'read-only'`. Already allow-only confinement, so it satisfies the tightened contract as-is. |
| opencode (A03) | ❌ | none | — | no per-call path sandbox; fields → one-shot `warning`, operations run normally. |
| gemini (A04) | ⚠️ to verify | soft (if any) | — | possibly `targetDir` / include-directories; if it cannot honor the fields → `warning` like opencode. |

**No regression for other adapters.** Only claude-code (previously deny-only under a soft gate) is re-specified. codex already realizes allow-only confinement via `workspace-write`; opencode stays `none` → `warning`; gemini remains to-verify.

The security-critical distinction stands: `architectureCapabilities` is static, but claude-code's hard gate depends on bubblewrap (Linux) / seatbelt (macOS) at runtime, so the static signal is at most **hard-capable**. A security consumer must obtain runtime confirmation before dispatch; a post-hoc `warning` is insufficient for a security gate.

## 3. claude-code (A01) realization

**Soft default** — before: `disallowedPaths` → `permissions.deny: ['Read(…)','Edit(…)']`, `allowedPaths` → `additionalDirectories`, while the run kept the adapter's usual `permissionMode: 'bypassPermissions'`.

After: when path-scope is requested the run switches **off** `bypassPermissions` (under which everything not explicitly denied is auto-approved — allow-confinement is impossible) and onto a **default-deny** mode (`permissionMode: 'default'` / `'dontAsk'`) with:
- `permissions.allow` rules for `cwd ∪ allowedPaths`, and
- `permissions.deny: ['Read(…)','Edit(…)']` rules for `disallowedPaths`.

Outside path-scope the adapter keeps today's `bypassPermissions`, so consumers not using scope see no regression.

**Hard gate (opt-in `claude_sandbox.enabled`)** — enforces at the OS syscall level (bubblewrap/seatbelt):
- `sandbox.filesystem` `allowWrite` / `denyWrite` / `denyRead` for write confinement, plus
- **managed allow-read confinement** (`allowManagedReadPathsOnly` + `allowRead` for `cwd ∪ allowedPaths`) for reads — because the SDK's default read model is deny-based, merely allowing the scope would not exclude the rest.
- Host without bubblewrap/seatbelt → hard→soft degradation with a one-shot `warning`.

**Config-discovery containment** — when path-scope (or the sandbox) is requested the adapter narrows `options.settingSources` to exclude the global user tier (`~/.claude`), disabling ambient global settings and disk-skill discovery that could otherwise re-widen the agent's reach. Inline skills are delivered via `options.plugins`, so this narrowing does **not** disable inline-skill materialization.

New/updated edge cases for A01:
- Under the OS sandbox, a Bash subprocess writing outside scope is blocked at the syscall level (no `command` parsing); under the soft default it is only protected by `Bash(...)` permission patterns.
- Path-scope requested → the soft run drops `bypassPermissions`; a read of a file outside `cwd ∪ allowedPaths` is blocked even when it is not named in `disallowedPaths`.

## 4. Skills discovery boundary under a sandbox (M05 / L2)

M05 gained a **Discovery boundary under a sandbox (claude-code)** note: when a filesystem path-scope / sandbox is requested, claude-code no longer auto-discovers global home-tier disk skills (`~/.claude/skills`) — an intended part of confining the agent so ambient global skills cannot re-widen its reach. The *mechanism* (setting-source narrowing) belongs to A01, not M05. Inline-skill delivery is unaffected: it rides on `options.plugins`, not the narrowed config sources, so project-scoped inline skills still materialize under the sandbox. The boundary is simply "skills outside project scope are not auto-discovered in sandbox mode."

## 5. Conformance policy: behavioral-hardening CHANGELOG note (M12 / L4)

M12 added a **Behavioral-hardening note (minor + CHANGELOG)** policy: a change that only tightens an opt-in surface without changing its type signature stays **minor**, but when it alters runtime behavior a consumer already relies on, the release MUST carry an explicit behavioral CHANGELOG note. The stated reference case is this very M15 hardening — additive at the type level, but behaviorally significant for consumers using path-scope today, so it ships as a minor with a note along the lines of:

> security-hardening: path-scope now confines to `cwd ∪ allowedPaths`, not deny-only

rather than shipping silently.

## 6. Capability flag & resume immutability

- `architectureCapabilities('claude-code')` now returns `pathScope: true`. Full expected object: `{ midTurnPush: true, imageInput: true, subagentDefinition: true, pathScope: true }`.
- Resume immutability (M15 / L3 → M07): `allowedPaths` / `disallowedPaths` are immutable across resume (a sandbox must not shrink or grow mid-session). They are `RuntimeExecuteParams` fields, not `ArchOption` keys, so `findResumeViolations` is extended to treat these designated fields as always-immutable and report a change to either.

## Acceptance criteria (new & updated)

New (`create`):
- In hard mode (OS sandbox) on claude-code, a read outside `cwd ∪ allowedPaths` is cut off at the OS level via managed allow-read confinement, not merely by a model-visible rule. (m15)
- Under a bounded/sandboxed run, global home-tier config and skill discovery (e.g. `~/.claude` settings and skills) is not auto-loaded, so the agent cannot re-widen its scope via ambient configuration. (m15)
- Under a claude-code sandbox/path-scope run, global disk-skill discovery (`~/.claude/skills`) is not auto-loaded, while inline (plugin-based) skill delivery still materializes and reaches the agent. (m05)
- When path-scope (or `claude_sandbox.enabled`) is requested, the claude-code soft run switches from `bypassPermissions` to a default-deny mode with allow-rules for `cwd ∪ allowedPaths` and deny-rules for `disallowedPaths`; outside path-scope it keeps `bypassPermissions` unchanged. (a01)
- When path-scope or the sandbox is requested, claude-code narrows `options.settingSources` to exclude the global `~/.claude` tier (disabling ambient global settings and disk-skill discovery), while inline skills delivered via `options.plugins` still materialize. (a01)
- With scope declared, a read or write of a path outside `cwd ∪ allowedPaths` is blocked even though that path is not listed in `disallowedPaths` (allow-confinement, not deny-only). (m15)

Updated (`update`):
- `architectureCapabilities('claude-code')` gains `pathScope: true` (see §6).
- Path-scope precedence AC now reads: "Path-scope confines reads and writes to `cwd ∪ allowedPaths` (the ceiling), with precedence `disallowedPaths > allowedPaths > base(cwd)` read as narrowing that ceiling." (m15)

## For implementers

Ordered roughly by dependency. Targets are in the `@inharness-ai/agent-adapters` library (`src/`, plus `testing/`).

1. **Capability flag (M01 / L2).** In `architectureCapabilities`, add `pathScope: true` to the claude-code branch so it returns `{ midTurnPush: true, imageInput: true, subagentDefinition: true, pathScope: true }`. Leave codex `true`, opencode `false`, gemini per its verified support.
2. **claude-code soft gate (A01).** In the claude-code adapter's option builder, when `allowedPaths`/`disallowedPaths` are present OR `claude_sandbox.enabled` is set: stop emitting `permissionMode: 'bypassPermissions'`; set `permissionMode: 'default'` (or `'dontAsk'`); build `permissions.allow` = `Read`/`Edit` rules for each dir in `cwd ∪ allowedPaths`; build `permissions.deny` = `['Read(<p>)','Edit(<p>)']` for each `disallowedPaths` entry. When no scope is requested, keep `bypassPermissions` unchanged.
3. **claude-code hard gate (A01).** On `claude_sandbox.enabled`, emit `sandbox.filesystem` with `allowWrite` / `denyWrite` / `denyRead` for writes, and set `allowManagedReadPathsOnly: true` plus `allowRead` for `cwd ∪ allowedPaths` for reads. If bubblewrap (Linux) / seatbelt (macOS) is unavailable at runtime, degrade hard→soft (fall back to step 2) and emit a one-shot `warning`.
4. **Setting-source narrowing (A01).** When path-scope or the sandbox is requested, set `options.settingSources` to exclude the global `~/.claude` user tier. Do NOT touch `options.plugins` — inline skills must still materialize.
5. **Disk-skill discovery (M05).** Ensure `listDiskSkills` / `getSkillSearchDirs` skip the global `~/.claude/skills` tier when the run is bounded (sandbox/path-scope). The inline materializer (`skills-tempdir.ts` → `options.plugins`) is unaffected.
6. **Resume immutability (M07).** Extend `findResumeViolations` to treat `allowedPaths` / `disallowedPaths` on `RuntimeExecuteParams` as always-immutable across resume, reporting a violation if either changes mid-session. (They are not `ArchOption` keys, so the existing `resumeImmutable`-on-`ArchOption` path does not cover them.)
7. **Release + CHANGELOG (M12).** Ship as semver-minor. Add an explicit behavioral CHANGELOG note: `security-hardening: path-scope now confines to cwd ∪ allowedPaths, not deny-only`.
8. **Tests.** Add contract/e2e cases for each new acceptance criterion above: soft-gate mode switch off `bypassPermissions`; allow-confinement blocking an unlisted out-of-scope path; hard-mode managed allow-read cutoff; global `~/.claude` settings + `~/.claude/skills` not auto-loaded under a bounded run while inline plugins still load. Guard e2e on `requireEnv()` and skip (not fail) when credentials are absent.
