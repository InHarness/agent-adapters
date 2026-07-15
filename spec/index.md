<!-- anchor: w5e9vcbj -->
# Specification: `@inharness-ai/agent-adapters`

A TypeScript library that wraps several agent SDKs — Claude Code, OpenAI Codex, OpenCode, Gemini CLI — behind one unified contract. Application code runs a prompt through any engine and consumes a single `AsyncIterable<UnifiedEvent>`; swapping the backend is a registry lookup, not a code change. Advanced capabilities (MCP, skills, subagents, images, mid-turn input) are configured uniformly and degrade gracefully when an adapter cannot honor them.

> **Spec target:** Production-hardened.
> Covers full functionality plus the cross-cutting concerns a multi-SDK library must own: auth/credentials, observability/audit, secret redaction, operational resilience (timeout/abort/process hardening), and contract versioning/evolution. Out of scope: persistence, HTTP, UI, CLI, i18n, background jobs (N/A for a library), the sibling `@inharness-ai/agent-chat` package, and the planned Google `google-genai` / `google-adk` adapters (future scope).

<!-- anchor: xhk5v1dt -->
## Core principle

The unified contract is the single source of truth; every agent SDK is normalized to it by an adapter. Application code depends on the contract, never on a specific SDK — so an engine can be added, swapped, or removed without touching the consumer.

<!-- anchor: 2zl4mpg1 -->
## High-level architecture

```
            consumer code  (depends only on the contract)
                  │
                  ▼  AsyncIterable<UnifiedEvent>
        ┌───────────────────────────────┐
        │   Unified Contract  (L1/L2/L3) │  ← capability map + degradation
        └───────────────────────────────┘
            ▲        ▲        ▲        ▲
         adapter  adapter  adapter  adapter        (registry: createAdapter / registerAdapter)
            │        │        │        │
      claude-code  codex   opencode  gemini
            │        │        │        │
         wrapped agent SDK (auth lives here, L6)
```

<!-- anchor: 4ods9d8q -->
## Key concepts

<!-- anchor: 1ym49bfn -->
### One contract, many engines

There is exactly one event vocabulary (`UnifiedEvent`), one message shape (`NormalizedMessage` / `ContentBlock`), one run-parameter shape (`RuntimeExecuteParams`), and one usage shape (`UsageStats`). Normalization happens at the edge — inside each adapter — so the differences between SDKs (synthetic vs. native streaming, thought summaries, cumulative vs. delta usage) never leak to the consumer. A consumer written against the contract keeps working when the engine changes.

<!-- anchor: ay9g0b1m -->
### Capabilities are declared, degradation is graceful

An adapter never silently pretends to support a feature. Each architecture declares what it supports; when a consumer asks for something the adapter can't do, the library applies a defined degradation strategy — **warn** (surface a diagnostic and continue), **skip** (drop the unsupported input), or **synthesize** (emulate the behavior from primitives) — and never throws for "unsupported". The capability map is the contract for "what works where".

<!-- anchor: vkj9dox7 -->
### Backends are swapped through registries

Adapters, providers, and model aliases are values in registries, not hard-coded branches. Adding a backend (`registerAdapter`), an API provider preset (`registerProvider`), or resolving a model alias (`resolveModel`) is data, not a consumer edit. `listArchitectures` enumerates what is available at runtime.

<!-- anchor: ogary76x -->
### Auth belongs to the wrapped SDK

The contract carries no credentials. Each adapter declares its own auth model — default credential source, optional provider override, required environment, and a defined failure mode (`AdapterInitError`) when credentials are missing. The library's job is to declare and fail clearly, not to store or broker secrets.

<!-- anchor: e274aqtz -->
### Safe to log by construction

Every run emits a startup audit event, and any value that could carry a secret passes through redaction before it can reach a log sink. "Safe to log" is a guarantee the library makes, not a discipline left to the consumer.

<!-- anchor: pvms8npr -->
### Spec structure — the three-level model (authoritative)

> This subsection is the **canon** for how this spec is organized. `CLAUDE.md` only points here; it does not restate these rules. The generic `layered-vertical-slices` skill is left untouched — project specifics would clutter it.

This spec follows *Layered Vertical Slices*, whose native grid is **2-axis**: vertical slices (modules) crossed with horizontal cross-cuts (layers). We add a third, named artifact kind — **adapters** — living in `spec/adapters/`. The result is a three-level **consumption/dependency hierarchy** the reader can hold in their head:

```
Layer   ←  Capability-module  ←  Adapter
(convention) (cross-cutting feature) (concrete SDK wrapper)
```

- A **layer** (`spec/layers/LX-*.md`) fixes a cross-cutting convention (the contract, capability mechanism, config schema, packaging, testing, auth).
- A **capability-module** (`spec/modules/MXX-*.md`) is a vertical slice of one feature (MCP, skills, subagents, usage, …). It *describes how it uses the layers*.
- An **adapter** (`spec/adapters/AXX-*.md`) wraps one agent SDK. It *describes how it uses the capability-modules and layers* to map its SDK onto the unified contract.

**Why adapters get their own kind (conscious extension).** Structurally, adapters are a specialized **sub-family of consumer modules** — vertical slices you add/remove via `registerAdapter`. They get a separate directory and template purely for ergonomics: their content shape (per-capability consumption matrix + SDK event mapping + auth model + resume constraints) differs enough from a capability-module that a shared `module.md` template would fit neither well. The "three levels" the reader sees are real as a hierarchy of *consumption*, but under the skill they remain the *modules-over-layers* grid, with adapters as a recognizable sub-family. This is a **deliberate departure** from the literal 2-axis model, documented here so a future agent does not mistake adapters for ordinary modules.

**Adapter template (`spec/adapters/AXX-*.md`) — seven sections:**
1. **Purpose & SDK identity** — the wrapped SDK and its architecture id (the supported version range and version gate now live in the L7 section below).
2. **Event mapping (L1)** — table mapping SDK events → `UnifiedEvent`, plus normalization specifics.
3. **Capability support & degradation (L2)** — *links* to each capability-module's support matrix (the matrix lives there, not here) + the SDK mechanic that fills or degrades each capability.
4. **Per-capability consumption** — how it wires MCP, skills, models/aliases, images, subagents, mid-turn, resume, usage (links to capability-modules).
5. **Auth model (L6)** — default / via provider / required env / failure mode (`AdapterInitError`).
6. **SDK compatibility & schema drift (L7)** — supported peer-SDK range (== the verified range), hard init version gate (`AdapterInitError` on mismatch), version-acquisition mechanism, availability probe, known in-range schema-drift points, defensive-read strategy.
7. **Edge cases & Acceptance criteria** — AC as entities, tag `aNN` / `aNN-edge`, embedded via `<tagged_list type="ac" tags="aNN"/>`.

**One-home rule (quality rule 2).** A capability's support matrix and degradation rules (warn / skip / synthesize) live in the **capability-module** that owns that capability (e.g. per-adapter MCP transport support → the MCP module; mid-turn degradation → the mid-turn module). An adapter only **links** to that matrix and adds its own SDK mechanic. The capability mechanism itself (`architectureCapabilities` declaration + the degradation taxonomy) is owned by M01 / L2 — not the per-(adapter × capability) data.

<!-- anchor: y3u2gqln -->
## Jobs this spec serves

| Job | Primary user | Modules involved | Success looks like |
| --- | --- | --- | --- |
| J1 — Run a prompt through any engine, consume one event stream | App/platform developer | M01, M09 | Swapping the agent leaves consumer code untouched; events arrive as one `AsyncIterable<UnifiedEvent>`. |
| J2 — Add/swap backends without touching the consumer | App/platform developer | M01, M02, M03 | A new adapter/provider/alias is registered; consumer code is unchanged. |
| J3 — Configure advanced capabilities uniformly, degrade gracefully | App/platform developer | M04, M05, M06, M10, M11, M15 | One config shape across engines; unsupported features warn/skip/synthesize, never crash. |
| J4 — Measure, observe, and survive failures | App/platform developer | M08, M09, M13, M14 | Billing vs. context window is legible; errors/timeout/abort are handled; runs are safe to log. |
| J5 — Build and evolve adapters safely | Custom-adapter author; library maintainer | M12 | A custom adapter passes contract assertions; the contract evolves under semver with deprecations. |

<!-- anchor: 7hcfzr89 -->
## Layers

Conventions shared across modules and adapters live in `layers/`:

| Layer | File | Purpose |
| --- | --- | --- |
| **L1 — Unified Contract** | `layers/L1-unified-contract.md` | The typed vocabulary (`UnifiedEvent`, `NormalizedMessage`/`ContentBlock`, `RuntimeExecuteParams`, `UsageStats`) every adapter normalizes to. |
| **L2 — Capability & Degradation** | `layers/L2-capability-degradation.md` | Mechanism for declaring per-architecture support + the degradation taxonomy (warn / skip / synthesize). |
| **L3 — Configuration & Extensibility** | `layers/L3-configuration-extensibility.md` | `architectureConfig` key schemas (ArchOption), resume-immutability flags, adapter/provider registries. |
| **L4 — Public API & Packaging** | `layers/L4-public-api-packaging.md` | Exports, tree-shakeable subpath entry points, peer-dependency model, semver/deprecations. |
| **L5 — Testing & Conformance** | `layers/L5-testing-conformance.md` | Contract assertions + e2e / normalization conventions. |
| **L6 — Auth & Credentials** | `layers/L6-auth-credentials.md` | Each adapter declares its auth model: default, via provider, required env, failure mode (`AdapterInitError`). |
| **L7 — SDK version compatibility & schema drift** | `layers/L7-sdk-compatibility.md` | Per-consumer supported peer-SDK range (== the verified range), a hard init version gate (out-of-range → `AdapterInitError`), and known in-range schema-drift points with defensive reads. |

<!-- anchor: 0kaqumsu -->
## Modules

Each capability-module is a vertical slice through the layers. Modules skip layers they don't touch.

| # | Module | Complexity | Layers | Scope | File |
| --- | --- | --- | --- | --- | --- |
| M01 | **Unified Core & Factory** | complex | L1, L2, L3, L4 *(impl L1–L3)* | Contract types, event taxonomy, `createAdapter`/`registerAdapter`/`listArchitectures`, capability map, ArchOption schema | `modules/M01-unified-core.md` |
| M02 | **Models & aliases** | medium | L3, L4 | `MODEL_ALIASES`, `resolveModel`, context windows, `ADAPTIVE_THINKING_ONLY` | `modules/M02-models-aliases.md` |
| M03 | **Providers** | medium | L3, L4, L6 | minimax/ollama/openrouter presets, `registerProvider`, architecture aliases | `modules/M03-providers.md` |
| M04 | **MCP integration** | complex | L1, L2, L4, L7 | 4 transports, `createMcpServer`/`mcpTool`, per-adapter support matrix; home of the `@modelcontextprotocol/sdk` peer-SDK range/gate (L7) | `modules/M04-mcp-integration.md` |
| M05 | **Inline skills & disk discovery** | complex | L1, L2, L4 | `InlineSkill` materialization + per-adapter delivery; `listDiskSkills`/`getSkillSearchDirs` | `modules/M05-skills.md` |
| M06 | **Subagents** | medium | L1, L2, L4 | Lifecycle event observation + definition (`SubagentDefinition`, `validateSubagents`) | `modules/M06-subagents.md` |
| M07 | **Session resume & immutability** | medium | L1, L3, L4 | Resume semantics + `getSessionResumeConstraints`/`findResumeViolations`/`isSessionFieldMutable` | `modules/M07-session-resume.md` |
| M08 | **Token usage & metrics** | medium | L1, L4 | Billing vs. `contextSize`, aggregation, cache fields, `priorUsage` (cross-process codex) | `modules/M08-token-usage.md` |
| M09 | **Stream consumption** | medium | L1, L4 | Observers (`observeStream`, `createConsoleObserver`) + `collectEvents`/`filterByType`/`splitBySubagent`/… | `modules/M09-stream-consumption.md` |
| M10 | **Image input** | medium | L1, L2, L4 | `ImageInput` + per-adapter materialization | `modules/M10-image-input.md` |
| M11 | **Mid-turn injection / streaming input** | medium | L1, L2, L4 | `pushMessage`, `streamingInput`, `user_message`, degradation when `midTurnPush=false` | `modules/M11-mid-turn-input.md` |
| M12 | **Conformance, evolution & release** | medium | L4, L5 *(impl L5)* | `assert*`, `ContractResult`, `/testing` export, e2e; semver, deprecations, contract-extension checklist, release process | `modules/M12-conformance-release.md` |
| M13 | **Errors, resilience & process hardening** | medium | L1, L4 | `AdapterError` hierarchy (init/runtime phase, OS-field hoisting, `toJSON`), timeout, abort, stdin guard (Passenger/CageFS) | `modules/M13-errors-resilience.md` |
| M14 | **Startup audit & secret redaction** | medium | L1, L4 | `adapter_ready` event, `redact.ts`, "safe to log" guarantee, warning→ready ordering | `modules/M14-audit-redaction.md` |
| M15 | **Filesystem path scoping (sandbox)** | medium | L1, L2, L3, L4 | `allowedPaths`/`disallowedPaths`, `pathScope` capability + strength/expressiveness matrix, native sandbox mapping, resume-immutability, degradation (warn; hard→soft) | `modules/M15-path-scoping.md` |
| M16 | **Task / todo tracking** | medium | L1, L2, L7 | Per-adapter task-tracking matrix (`TodoWrite`↔`Task*` per SDK version, opencode `todo.updated`), `todo_list_updated` projection + snapshot accumulation | `modules/M16-task-tracking.md` |

<!-- anchor: 5uvpqu1k -->
## Adapters

The third artifact kind (see *Spec structure* above). Each adapter consumes layers (L1/L2/L6) **and** capability-modules, and describes *how* it maps its SDK onto the unified contract. Adapters are counted separately from the module budget.

| # | Adapter | SDK (peer-dep) | Distinguishers | File |
| --- | --- | --- | --- | --- |
| A01 | **claude-code** | `@anthropic-ai/claude-agent-sdk` | Reference adapter; only one with `subagentDefinition` + `midTurnPush=true`; preset system prompts | `adapters/A01-claude-code.md` |
| A02 | **codex** | `@openai/codex-sdk` | Synthetic streaming; delta from cumulative usage (`priorUsage`, cross-process); sandbox | `adapters/A02-codex.md` |
| A03 | **opencode** | `@opencode-ai/sdk` | SSE; MCP stdio-only; `question.asked`; requires CLI in PATH | `adapters/A03-opencode.md` |
| A04 | **gemini** | `@google/gemini-cli-core` | Thought summaries (`replace:true`); threadId-synthesized subagents; requires `GOOGLE_API_KEY`/`GEMINI_API_KEY` | `adapters/A04-gemini.md` |

<!-- anchor: vancl72m -->
### Key relations

```
Adapters (registered via registerAdapter)
  A01 claude-code ─┐
  A02 codex       ─┤
  A03 opencode    ─┼─ normalize SDK events ──> L1 Unified Contract        (impl: M01)
  A04 gemini      ─┘ declare support      ──> L2 Capability & Degradation (impl: M01)
                     read config keys     ──> L3 Configuration            (impl: M01)
                     declare auth model   ──> L6 Auth & Credentials       (external: wrapped SDKs)
                     gate SDK version      ──> L7 SDK compatibility        (external: agent SDKs)

Adapters consume capability-modules (each module owns its support matrix):
  ── M04 MCP, M05 Skills, M06 Subagents, M10 Images, M11 Mid-turn, M15 Path-scope  (L1+L2 features)
  ── M02 Models, M03 Providers, M07 Resume                          (L3 config features)
  ── M08 Usage, M09 Stream, M13 Errors, M14 Audit                   (L1 observability/resilience)
  ── M16 Task/todo tracking  (A01, A03 positive; A02, A04 absent)   (L1+L2; flagship L7 drift case)

M15 Path-scope ── relation ──> M07 Resume (path-scope fields immutable on resume)
A01 claude-code, A03 opencode ── consume ──> M16 Task/todo tracking (projection matrix)
M16 Task-tracking ── flagship drift ──> L7 SDK compatibility (SDK renames the task tool in-range)
L7 SDK compatibility ── out-of-range ──> AdapterInitError (M13); range-narrowing is semver (M12)
  consumers: A01–A04 + M04 (@modelcontextprotocol/sdk)

M01 Unified Core ── infrastructure ──> every module and every adapter
M12 Conformance  ── implements ──> L5; asserts every adapter against L1
M03 Providers    ── relation ──> M02 Models (alias resolution), L6 Auth (credentials)
```

<!-- anchor: prf5pucs -->
## Tech stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript (Node ≥ 20) |
| Module formats | ESM + CJS via tsup; tree-shakeable subpath exports |
| Persistence | None (pure library) |
| Wrapped SDKs (peer-deps, optional per adapter) | `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@opencode-ai/sdk`, `@google/gemini-cli-core` |
| Testing | vitest (unit + e2e); contract assertions exported from `/testing` |
| Distribution | npm, semver, deprecation policy |

<!-- anchor: zwfw7p15 -->
## Acceptance criteria

Project-wide, observable outcomes. Per-module and per-adapter criteria live in their own files; this list embeds the cross-cutting `core` set.

<tagged_list type="ac" tags="core"/>

<!-- anchor: 0aj92zki -->
## Open questions

1. Module budget: with M16, the spec now has **16** capability-modules — a conscious step *past* the production-hardened band (8–15), accepted deliberately when adding Task/todo tracking. Optional consolidation (M08+M09 → "Stream & metrics"; M10+M11 → "Prompt & mid-turn input") remains available on a separate round if the set feels heavy.
2. L6 Auth vs. L3 Config — auth could be folded into L3; kept separate for hardening rigor. Revisit if L6 stays thin.
3. Google adapters (`google-genai`, `google-adk`) — deferred (future scope); `gemini-cli-core` is the Google path for now.
4. **Gemini auth tension.** The strategic rationale for keeping `gemini-cli-core` was free-tier OAuth, but the current adapter **requires** `GOOGLE_API_KEY`/`GEMINI_API_KEY` and fails with `AdapterInitError` when neither is set (see <section_ref anchor="qhpv1am5"/>). The spec documents the code as-is. Decide whether to (a) accept API-key-only auth as the contract, or (b) treat OAuth free-tier as an adapter gap to close — at which point A04's L6 section changes.
5. **Path-scope (M15) — deferred design decisions.** The core contract is decided (prefixes, read+write combined, permission-rules-default with OS-sandbox opt-in, `pathScope` as a bool + separate strength signal). Still open: (a) read/write **split** and **glob** input as future extensions; (b) whether A04 gemini can honor path-scope natively (`targetDir` / include-directories) or stays `warn`-degraded — needs code verification; (c) the exact shape of the **pre-run strength-confirmation** channel (probe vs startup event) that lets a security consumer learn hard-vs-soft before dispatch, since the static capability cannot know whether bubblewrap/seatbelt is present; (d) whether the capability should additionally surface "deny-expressible vs allow-only" as a first-class signal so consumers never assume an unenforceable carve-out.
6. **Generic tool-permission hook (future).** A low-level `onToolPermission`-style escape hatch for **non-path** policies (network, specific-tool gating, rate limits) is intentionally *not* part of M15 — the declarative path-scope contract and a generic hook are different abstraction levels that compose (adapter applies native path-scope first; a hook would handle the rest). Whether to build it as a sibling module (a future `M17+`, since `M16` is now Task/todo tracking) or leave it a pure open question is undecided; if built, it must be designed to run in parallel with M15 without conflict.
7. **Autonomous self-scheduling loop (deferred — next design round).** A01 now *hard-suppresses* the harness scheduling family (`ScheduleWakeup`, `Cron*`, `/loop`) because it is inert under headless drive. The follow-up is to replace that dead passthrough with a **real, cross-adapter** capability: a library-owned loop that ends the turn, sleeps N seconds, and re-invokes itself with a wake-up prompt — built on primitives we already have (M07 resume, M11 mid-turn/streaming input). Likely a **future** module (`M17+` — `M16` is now Task/todo tracking) with a degradation matrix (L2), loop config (L3: max iterations, backoff, stop-condition), cross-wake usage aggregation (M08), and a whole-cycle timeout/abort (M13). **Scope tension to resolve at the start of that round:** it directly contradicts the current *"Out of scope: background jobs — N/A for a library"* stance — a conscious decision, not a silent drift.
