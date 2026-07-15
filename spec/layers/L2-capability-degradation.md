<!-- anchor: yjirif3v -->
# L2 — Capability & Degradation

> The mechanism by which each architecture declares what it supports, and the taxonomy for what happens when a consumer asks for something unsupported: **warn / skip / synthesize**.

<!-- anchor: 65oh54aa -->
## Role in the system

L2 makes capability differences explicit and safe. It is the home of the *mechanism* (`architectureCapabilities` declaration) and the *taxonomy* (the three degradation strategies) — not of the per-(adapter × capability) data, which lives in each capability-module's support matrix. L2 guarantees that "unsupported" is a defined, observable outcome, never a crash.

<!-- anchor: au14qdu4 -->
## Module slice schema

A module that touches L2 carries a `## Capability & Degradation (L2)` section; an **adapter** carries a `## Capability support & degradation (L2)` section. The two roles differ:

- **Capability-module (consumer)** — names the capability flag(s) it keys on (`midTurnPush` / `imageInput` / `subagentDefinition`) and, for each, the degradation strategy that applies when an adapter lacks support: **warn** (emit a one-shot `warning`), **skip** (drop the input), or **synthesize** (emulate from primitives). It states which strategy and why, and owns the per-adapter support **matrix** for its capability (one-home rule).
- **Adapter (consumer)** — states its `architectureCapabilities(arch)` result and, per capability, **links** to the owning module's matrix and names the SDK mechanic that fills or degrades it. The matrix lives in the module, never duplicated here.
- **Implementor (M01 / `capabilities.ts`)** — owns the `architectureCapabilities` declaration mechanism and the warn/skip/synthesize taxonomy, documented in how-mode.

> **Implementor module:** `M01 — Unified Core & Factory` (`capabilities.ts`) — owns the declaration mechanism and the degradation taxonomy; capability-modules own their own support matrices.
