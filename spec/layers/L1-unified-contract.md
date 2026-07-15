<!-- anchor: ouqdr0lz -->
# L1 — Unified Contract

> The typed vocabulary every adapter normalizes to: one event stream (`UnifiedEvent`), one message shape (`NormalizedMessage` / `ContentBlock`), one run-parameter shape (`RuntimeExecuteParams`), one usage shape (`UsageStats`).

<!-- anchor: v7n3lmmz -->
## Role in the system

L1 is the contract the consumer depends on and every adapter implements. Adapters translate SDK-native output into L1 types at the edge; consumers read only L1. L1 is NOT responsible for how a capability is configured (that is L3) or whether an adapter supports it (that is L2) — only for the *shape* of what flows.

<!-- anchor: yc5ftl18 -->
## Module slice schema

A module that touches L1 carries a `## Unified Contract (L1)` section; an **adapter** instead carries a `## Event mapping (L1)` section. Both answer "what flows, in L1 terms", in different shapes:

- **Capability-module (consumer)** — a bullet list of the `UnifiedEvent` variants it produces or reads, plus any `NormalizedMessage` / `ContentBlock` / `RuntimeExecuteParams` / `UsageStats` field it contributes, each stated with the guarantee that field carries. Reference each type by name; do not restate its definition (that is the implementor's job).
- **Adapter (consumer)** — a two-column table `SDK event → UnifiedEvent` covering every event its SDK emits, followed by prose on normalization specifics (e.g. synthetic streaming, `replace` semantics, `subagentTaskId` resolution).
- **Implementor (M01)** — documents the event taxonomy, the `NormalizedMessage` / `ContentBlock` union, and the param/usage shapes in how-mode: what each variant means and which invariants hold across all adapters.

> **Implementor module:** `M01 — Unified Core & Factory` — owns the contract types and the event taxonomy; consumers are every other module and every adapter.
