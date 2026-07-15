<!-- anchor: 2rz42y3i -->
# L5 — Testing & Conformance

> Contract assertions (`assert*`, `ContractResult`) plus the conventions for e2e and normalization tests that prove an adapter honors L1.

<!-- anchor: ykokbyyr -->
## Role in the system

L5 is how the contract is enforced rather than merely described. It provides the assertion toolkit any adapter (first- or third-party) runs to prove conformance, and fixes the conventions for e2e/normalization suites. It does NOT define the contract (that is L1) — it verifies adherence to it.

<!-- anchor: 9xedv63z -->
## Module slice schema

- **Capability-module (consumer)** — most modules write no L5 section. A module touches L5 only when it contributes an invariant to the shared assertion toolkit, in which case its `## Testing & Conformance (L5)` section names the assertion and what it checks.
- **Adapter (consumer)** — every adapter is covered by one `*.e2e.test.ts` that guards on `requireEnv()` and **skips** (never fails) when the SDK's credentials are absent. This is a shared convention, not a per-adapter section.
- **Implementor (M12)** — owns the `assert*` helpers, the `ContractResult` shape, the `/testing` export, and the e2e / normalization conventions, documented in how-mode.

> **Implementor module:** `M12 — Conformance, evolution & release` — owns the assertion toolkit, the `/testing` export, and the e2e conventions consumers and adapter authors rely on.
