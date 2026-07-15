<!-- anchor: qno516sg -->
# L7 — SDK version compatibility & schema drift

> How every consumer that wraps a peer-SDK pins the version range it actually verifies, hard-fails outside that range, and reads defensively against tool/field schema drift inside it.

<!-- anchor: gxe5pr6r -->
## Role in the system

L7 is where each peer-SDK consumer — adapters A01–A04 and M04 (for `@modelcontextprotocol/sdk`) — declares the **authoritative, narrow** version range it supports, how it reads the installed version at init, where the wrapped SDK's tool/field schema is known to drift *within* that range, and how it stays correct across that drift. It governs **runtime version compatibility**. It is distinct from L4, which governs how those same peer-deps are *packaged* (optional, tree-shakeable subpaths): L4 is about distribution, L7 is about the running version. It is also distinct from L2: an out-of-range peer-SDK is a fault of the "missing credentials" class — a hard init failure — **not** a capability the contract promises to degrade. L2's warn / skip / synthesize applies only to *in-contract* capabilities; it never covers an unsupported SDK version.

<!-- anchor: d0npth7e -->
## Module slice schema

Each consumer that wraps a peer-SDK fills its `## SDK compatibility & schema drift (L7)` section with:

- **Supported peer-SDK range** — a concrete, narrow semver range that **equals** the range actually verified in CI and asserted by the version gate. Declaring `>=x` while testing only one pin is forbidden: *declared range == verified range*. This canonical range is authoritative in the spec (as the M02 model catalog is canon over `src/`); the `package.json` `peerDependencies` entry must be **narrowed to match it** — a semver-significant change (see <section_ref anchor="agvf1tok"/>), so config/code that ships downstream of a release brief, never edited here.
- **Version gate (HARD)** — at init the consumer reads the installed peer-SDK version and evaluates `satisfies(range)`. A non-match **emits** an `error` event (`phase: 'init'`, `AdapterInitError`) naming "installed X, requires Y". It is blocking and non-suppressible — never a warning, no bypass, no config gate — consistent with the "emitted, never thrown" error model (see <section_ref anchor="8q9q7ty7"/>).
- **Version-acquisition mechanism** — where the installed version is read from. This is **per-SDK** because a peer's `package.json` may be hidden behind an `exports` map; the consumer states its concrete method rather than the layer mandating one.
- **Availability probe** — how the lazy `import()` detects the peer-SDK is *absent*, separate from the version gate: absence and wrong-version are distinct init faults, both surfaced as `AdapterInitError`.
- **Known schema-drift points** — the tool/field renames or shape changes known to occur *inside* the declared range (with the cutover version where known), so the defensive read below is deliberate, not accidental. List "none identified yet" honestly rather than inventing points.
- **Defensive-read / in-range degradation strategy** — how the consumer keeps working across that drift (dual-path reads, fallbacks) so a renamed field is never a silent no-op. In-range drift degrades per L2; out-of-range is the hard fault above.

> **Two regimes.** *Outside* the declared range → **HARD FAIL** (the version gate above): non-suppressible init `error`, no bypass. *Inside* the declared range → defensive `Record<string,unknown>` reads plus L2 degradation: within the range we commit to keep working despite field drift.

> **Implementor module:** `external — agent SDKs` (each wrapped SDK owns its own versioning; the spec declares the range, the gate, and the drift points). Related policy: the `AdapterInitError` failure surface is owned by M13; narrowing `peerDependencies` to these ranges is the semver-significant change owned by M12.
