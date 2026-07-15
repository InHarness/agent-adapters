<!-- anchor: xnos4b9z -->
# L3 — Configuration & Extensibility

> The schemas for `architectureConfig` keys (ArchOption), resume-immutability flags, and the registries through which adapters, providers, and model aliases are added without touching the consumer.

<!-- anchor: 8dgpmcse -->
## Role in the system

L3 fixes how a run is configured and how the set of backends is extended. It owns the *shape* of config keys and the registry contracts (`registerAdapter`, `registerProvider`, alias resolution); it does NOT own the runtime event shape (L1) or capability support (L2). Extensibility is data, not a code edit.

<!-- anchor: gapa5rc5 -->
## Module slice schema

- **Capability-module (consumer)** — a `## Configuration & Extensibility (L3)` section listing the `architectureConfig` keys it declares (ArchOption: key name, type, default, validation) and any registry it plugs into (`registerAdapter` / `registerProvider` / alias resolution).
- **Adapter (consumer)** — adapters *read* L3 config keys rather than declaring them, so an adapter documents the keys it consumes inline in `## Per-capability consumption` (e.g. `codex_sandboxMode`, `gemini_thinkingBudget`, `opencode_providerID`), not in a separate L3 section.
- **Implementor (M01 / `options.ts`, factory)** — owns the ArchOption schema and the registry contracts in how-mode.

> **Implementor module:** `M01 — Unified Core & Factory` (`options.ts`, factory) — owns the ArchOption schema and the registry contracts; capability-modules declare their own config keys.
