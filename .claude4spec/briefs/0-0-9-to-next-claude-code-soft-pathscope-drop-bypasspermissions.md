---
type: brief
source: analysis
from_release: 0.0.9
to_release: null
generated_at: '2026-07-15T14:38:18.215Z'
generator_version: brief-author@0.1
implemented: true
---
# Analysis brief: claude-code soft path-scope — drop `bypassPermissions` for a default-deny allow-confinement

This is a **fix brief**, not a release brief: it carries **no spec delta**. The specification already mandates the correct behaviour (anchors cited below); the `claude-code` adapter implementation has drifted from it and must be brought back into line. The job for the implementer is purely a code fix in `src/adapters/claude-code.ts` plus un-skipping one committed acceptance test — no `spec/` edits.

The bug is a live, reproduced security gap. On 2026-07-15 an e2e run against a live model (sonnet-4.6, `@anthropic-ai/claude-agent-sdk` 0.3.153) proved that the adapter's **soft** (non-OS-sandbox) filesystem path-scope gate does **not** actually block a `Read` of a file placed under `disallowedPaths`: the disallowed file's contents (the marker `TOP-SECRET-1729`) leaked verbatim into the model output. A related earlier finding: the soft gate only denied `Read`/`Edit`, never `Write`, so creating a new file under a disallowed path was also unblocked.

<!-- anchor: rootcause1 -->
## Root cause (in `src/adapters/claude-code.ts`)

The soft gate is a bare deny-list layered on top of a run that auto-approves everything, so the deny never bites.

- **Line ~487** sets `permissionMode: 'bypassPermissions'` (together with `allowDangerouslySkipPermissions: true`) **unconditionally for every run**, and never lowers it when path-scope is requested. Under `bypassPermissions` the SDK auto-approves everything not otherwise handled — so `permissions.deny` rules are effectively bypassed and allow-confinement is impossible.
- **Lines ~619–627** (the path-scope block) map `allowedPaths → options.additionalDirectories` and `disallowedPaths → options.settings.permissions.deny = ['Read(<abs>/**)', 'Edit(<abs>/**)']`. There is **no** `permissions.allow` confinement, **no** `Write(...)` deny, and **no** `settingSources` narrowing. `additionalDirectories` merely *widens* reach; it cannot confine.
- **Lines ~612–616** carry a comment asserting *"Deny outranks permissionMode in the SDK precedence chain, so the deny rules survive our bypassPermissions default."* This is **empirically false** — under `bypassPermissions` the deny is ignored — and must be removed/corrected.

Net effect: the soft path-scope gate is decorative. A `disallowedPaths` entry produces a deny string that the run never enforces, and writes were never covered at all.

<!-- anchor: specalign -->
## The spec already prescribes the fix

The intended behaviour is already written down; only the code lags. Do **not** propose changing these — they are the source of truth the fix must satisfy:

- **A01 — `spec/adapters/A01-claude-code.md`, "Per-capability consumption" → Path-scope (M15), anchor `sw3cwrsm`:** when path-scope is requested the run switches **off** the adapter's usual `permissionMode: 'bypassPermissions'` and onto a **default-deny** mode (`permissionMode: 'default'` / `'dontAsk'`) with `permissions.allow` rules for `cwd ∪ allowedPaths` and `permissions.deny` rules (`Read(…)`, `Edit(…)`) for `disallowedPaths`. This confines reads/writes to the model-visible ceiling. Outside path-scope the adapter keeps today's `bypassPermissions`, so consumers not using scope see no regression. The same section mandates config-discovery containment: narrow `options.settingSources` to exclude the global `~/.claude` tier; inline skills (delivered via `options.plugins`) are unaffected.
- **A01 edge cases, anchor `677rc2wh`:** path-scope requested → the soft run drops `bypassPermissions` for a default-deny mode; a read of a file **outside `cwd ∪ allowedPaths` is blocked even when it is not named in `disallowedPaths`**. Outside path-scope the run keeps `bypassPermissions` unchanged. (The `settingSources`-narrowing edge case sits just below it.)
- **M15 — `spec/modules/M15-path-scoping.md`, "Confinement, not deny-only" (anchor `j4a1hr2q`) and the L2 matrix (anchor `8pg5iti3`):** the soft gate MUST realise **allow-confinement** bound to `cwd ∪ allowedPaths`, not a bare deny-list.
- **M15 L4 / M12 semver note (M12 anchor `agvf1tok`):** ships as a **minor** with a behavioural CHANGELOG note — *"path-scope now confines to `cwd ∪ allowedPaths`, not deny-only."*

<!-- anchor: acceptance -->
## Acceptance criterion

The behavioural e2e is already committed as `it.skip` ("soft deny blocks Read" — a `Read` of a `disallowedPaths` file must not surface its contents). **Un-skipping that test and making it pass against a live model IS the acceptance criterion.** The construction-only unit test in `claude-code.path-scope.test.ts`, which asserts the deny **string** is present in the options, is **not** sufficient — that test passed the whole time and is exactly what hid this bug. Verify behaviour, not option-shape.

<!-- anchor: forimplementers -->
## For implementers

All edits are in `src/adapters/claude-code.ts` unless noted. Gate every change below on "path-scope requested" — i.e. `probePathScope(...).requested` (true when `allowedPaths` and/or `disallowedPaths` are present).

1. **Lower the permission mode under path-scope (~L487).** When path-scope is requested, stop emitting `permissionMode: 'bypassPermissions'` and drop `allowDangerouslySkipPermissions: true` for that run; switch to a **default-deny** mode (`'default'` or `'dontAsk'`). Outside path-scope, keep `bypassPermissions` and `allowDangerouslySkipPermissions` exactly as today — no regression for consumers not using scope.
2. **Build allow-confinement, not a bare deny-list (~L619–627).** Emit `options.settings.permissions.allow` rules covering `cwd ∪ allowedPaths` (both read and write/edit), plus `options.settings.permissions.deny` rules for `disallowedPaths`. The `allowedPaths → options.additionalDirectories` mapping alone is insufficient: confinement must come from default-deny + explicit `allow`, so that a read outside `cwd ∪ allowedPaths` is blocked even when it is not named in `disallowedPaths`.
3. **Cover writes too.** Extend the deny/allow set to bound `Write(...)`, not only `Read(...)` / `Edit(...)`, so creating a **new** file under a disallowed path (or anywhere outside the ceiling) is blocked under the soft gate.
4. **Config-discovery containment.** When path-scope (or the OS sandbox) is requested, narrow `options.settingSources` to exclude the global `~/.claude` tier, so ambient global settings / on-disk skill discovery cannot re-widen the agent's reach. Inline skills are delivered via `options.plugins` and MUST remain unaffected.
5. **Leave the hard OS-sandbox path unchanged (~L629–650).** The opt-in `claude_sandbox.enabled` branch is out of scope; this fix is about the soft default only.
6. **Remove/correct the false comment (~L612–616)** asserting "Deny outranks permissionMode in the SDK precedence chain…" — it is empirically wrong under `bypassPermissions`.
7. **Acceptance test.** Un-skip the committed `it.skip` behavioural e2e ("soft deny blocks Read") and make it pass against a live model — a `Read` of a `disallowedPaths` file must not surface its contents. Do not rely on the construction-only unit test in `claude-code.path-scope.test.ts` (asserting the deny string); it is what masked the bug.
8. **Semver + CHANGELOG.** Release as a **minor** with a behavioural note: *"path-scope now confines to `cwd ∪ allowedPaths`, not deny-only."*
