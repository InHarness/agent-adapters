<!-- anchor: a4e5df9n -->
# M03 — Providers

> API provider presets (minimax, ollama, openrouter) bundled as registrable values, so pointing an adapter at an alternative backend is configuration, not a code fork.

<!-- anchor: bsg14b35 -->
## Purpose

Developers can run a Claude- or OpenCode-shaped adapter against an alternative API backend (MiniMax, a local Ollama, OpenRouter) by selecting a provider preset instead of hand-wiring base URLs and credentials. M03 owns the built-in presets, the `registerProvider` extension point, and the architecture aliases that bind a provider to an adapter (`claude-code-minimax`, `claude-code-ollama`, `opencode-openrouter`). A provider preset describes *where* requests go and *which* environment supplies credentials; it does not itself broker secrets (L6).

<!-- anchor: sgj74486 -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L3 | Declares provider presets and the `registerProvider` registry. |
| L4 | Exports `registerProvider` and the built-in presets. |
| L6 | Each preset names the env that supplies credentials; auth resolution stays in the wrapped SDK. |
| M02 | Presets may carry default model ids resolved through `resolveModel`. |
| M01 | Provider-bound architecture aliases register as architectures in M01's factory. |

<!-- anchor: dlxu7p4c -->
## Configuration & Extensibility (L3)

- **Built-in presets** — minimax, ollama, openrouter. Each preset fixes base URL, the credential env var(s), and any default model.
- **`registerProvider(...)`** — adds a custom provider preset at runtime.
- **architectureConfig keys** — `ollama_baseUrl` (override local endpoint), `custom_env` (inject provider env). Provider-bound architecture aliases (`claude-code-minimax`, `claude-code-ollama`, `opencode-openrouter`) select a preset by name.

<!-- anchor: tyzuuync -->
## Auth & Credentials (L6)

A provider preset declares which environment variable carries the credential (e.g. the OpenRouter / MiniMax API key) and, for local Ollama, that no credential is required. The preset only *declares* the source; the wrapped SDK reads it. A missing required credential surfaces as `AdapterInitError` (M13) at adapter init.

<!-- anchor: 0sxx12sv -->
## Public API & Packaging (L4)

Exports `registerProvider` and the built-in provider presets from the package root.

<!-- anchor: 0itdpo7a -->
## Edge cases

- Unknown provider name selected → `AdapterInitError` with the available preset names.
- Ollama without `ollama_baseUrl` and no running local endpoint → init/runtime failure surfaced as an adapter error, not a throw.
- Provider preset overrides a model the base SDK cannot serve → resolution proceeds; failure surfaces from the SDK as a runtime `error` event.

<!-- anchor: sx6eim0j -->
## Acceptance criteria

These verify that swapping the backend is preset selection, and that credential expectations are declared, not hidden.

<tagged_list type="ac" tags="m03"/>
