<!-- anchor: 2rz42y3i -->
# L5 — Testing & Conformance

> Contract assertions (`assert*`, `ContractResult`) plus the conventions for e2e and normalization tests that prove an adapter honors L1.

<!-- anchor: ykokbyyr -->
## Role in the system

L5 is how the contract is enforced rather than merely described. It provides the assertion toolkit any adapter (first- or third-party) runs to prove conformance, and fixes the conventions for e2e/normalization suites. It does NOT define the contract (that is L1) — it verifies adherence to it.

<!-- anchor: 9xedv63z -->
## Module slice schema

- **Capability-module (consumer)** — most modules write no L5 section. A module touches L5 only when it contributes an invariant to the shared assertion toolkit, in which case its `## Testing & Conformance (L5)` section names the assertion and what it checks.
- **Adapter (consumer)** — every adapter is covered by one `*.e2e.test.ts` that guards on `requireEnv()` and **skips** (never fails) when the SDK's credentials are absent. The skip-without-creds contract is a shared convention (not a per-adapter section), but *which* real-model scenarios that suite exercises **is** per-adapter content — it lives in the adapter file (see <section_ref anchor="ye2ecov1"/>), because the coverage is a property of that adapter's test suite, not of any one capability.
- **Implementor (M12)** — owns the `assert*` helpers, the `ContractResult` shape, the `/testing` export, the e2e / normalization conventions, and the **canonical scenario catalog** (the named real-model scenarios every suite draws from), documented in how-mode.

> **Implementor module:** `M12 — Conformance, evolution & release` — owns the assertion toolkit, the `/testing` export, the scenario catalog, and the e2e conventions consumers and adapter authors rely on.

<!-- anchor: ye2ecov1 -->
## Real-model e2e — scenarios, coverage & verified range

"e2e" here means the **real-model** suite: prompts driven against a live model, not mocks. Three concerns, three homes — keep them distinct:

- **Scenario catalog (shared vocabulary → M12).** The named behaviors a suite can exercise (simple text, thinking, tool/MCP, subagents, plan mode, path-scope, resume, todo, user-input, image, mid-turn, abort, unknown-model, usage) are a cross-cutting vocabulary — analogous to L1 owning the `UnifiedEvent` taxonomy. The catalog defines each scenario and *what it proves*; it does **not** restate prompt strings or `assert*` names (those are code detail, owned by the `.claude/skills` for the SDK).
- **Per-adapter coverage (→ the adapter file).** Which catalog scenarios a given adapter's `*.e2e.test.ts` actually runs is that adapter's own section. There is deliberately **no** central scenario×adapter matrix: coverage is owned by each suite, and a cross-adapter comparison is a *derived* view of the per-adapter lists, not a hand-authored table (contrast the capability support matrices of L2, which are owned by the capability because support is intrinsic to it).
- **Per-capability nuance (→ the owning capability-module, one-home).** When a scenario proves a specific capability (resume, subagents, path-scope…), the capability-module notes *which* e2e assertion proves it, beside its existing support matrix.

**Model matrix & verified range.** The real-model suite is also how L7's *declared range == verified range* invariant is made real: the SDK dev-pin the suite runs against **is** the "verified" evidence for that adapter's declared peer-SDK range, so a peer-SDK bump requires re-running the full suite before the range is narrowed (see <section_ref anchor="qno516sg"/>). Breadth across models is per-adapter: claude-code parametrizes the suite over the whole M02 model catalog (`E2E_CLAUDE_MODEL`, the `test:e2e:claude:*` scripts); the other adapters pin a single model per file. This ties e2e breadth to the M02 catalog (canon).
