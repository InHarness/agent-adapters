<!-- anchor: z0q5hkxc -->
# M02 — Models & aliases

> One way to name a model across every engine: friendly aliases resolve to the concrete model string each SDK expects, with context-window metadata and thinking-only constraints attached.

<!-- anchor: dywsmbko -->
## Purpose

Developers can pass a stable alias (or a raw model id) and have it resolved correctly per architecture, instead of memorizing each SDK's model identifiers. M02 owns `MODEL_ALIASES`, the pure `resolveModel(architecture, model)` function, per-model context-window sizes (used by M08 to separate billing from window occupancy), and the `ADAPTIVE_THINKING_ONLY` set marking models whose thinking config is fixed (e.g. Opus 4.7 adaptive thinking). It does not run anything — it is a resolution and metadata layer.

<!-- anchor: cyy2lhfp -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L3 | Declares model resolution as configuration; adapters must call `resolveModel`. |
| L4 | Exports `resolveModel`, `MODEL_ALIASES`, `ADAPTIVE_THINKING_ONLY`, context-window metadata. |
| M01 | Reads `RuntimeExecuteParams.model`; resolution is invoked by every adapter. |
| M08 | Consumes context-window sizes to compute window occupancy vs. billing. |

<!-- anchor: ip0r5d0g -->
## Configuration & Extensibility (L3)

- **`resolveModel(architecture, model)`** — pure; maps an alias to the concrete model string for that architecture, and passes unknown/custom values through untouched. Every adapter must call it so aliases work uniformly.
- **`MODEL_ALIASES`** — the alias table (friendly name → per-architecture concrete id).
- **Context windows** — per-model window sizes exposed as metadata.
- **`ADAPTIVE_THINKING_ONLY`** — set of models whose thinking/reasoning knob is fixed by the model itself; relevant to M07 resume-immutability and to adapters that would otherwise set a thinking budget.

<!-- anchor: 9rpzxpiw -->
## Model catalog (L3)

This catalog is the **canon** for aliases, resolved ids, context windows, and adaptive-only membership. `src/models.ts` is a **mirror** of it: every new model release is edited here first, then propagated to code. Adapters A01–A04 do not duplicate these tables — they link to the relevant per-architecture table below.

The **adaptive-only?** column is a view of the `ADAPTIVE_THINKING_ONLY` class (see semantics below); it is meaningful only for architectures whose resolved ids are bare Anthropic model strings (`claude-code`). For every other architecture the class does not currently apply, so those tables omit the column.

<!-- anchor: 9gu9zp7z -->
### claude-code models

| alias | resolved id | context window | adaptive-only? |
| --- | --- | --- | --- |
| `fable-5` | `claude-fable-5` | 1,000,000 | ✓ |
| `sonnet-5` | `claude-sonnet-5` | 1,000,000 | ✓ |
| `sonnet-4.6` | `claude-sonnet-4-6` | 200,000 | — |
| `sonnet-4.5` | `claude-sonnet-4-5-20250929` | 200,000 | — |
| `opus-4.8` | `claude-opus-4-8` | 1,000,000 | ✓ |
| `opus-4.7` | `claude-opus-4-7` | 200,000 | ✓ |
| `opus-4.6` | `claude-opus-4-6` | 200,000 | ✓ |
| `opus-4.5` | `claude-opus-4-5-20251101` | 200,000 | — |
| `haiku-4.5` | `claude-haiku-4-5-20251001` | 200,000 | — |

`sonnet-5` (Anthropic API id `claude-sonnet-5`, 1M window, max output 128k) supports adaptive thinking only — extended/fixed-budget thinking is unavailable — so it joins the adaptive-only class alongside `opus-4.8`.

<!-- anchor: jq7y9jh0 -->
### codex models

| alias | resolved id | context window |
| --- | --- | --- |
| `gpt-5.5` | `gpt-5.5` | 400,000 |
| `gpt-5.5-codex` | `gpt-5.5-codex` | 400,000 |
| `gpt-5.5-mini` | `gpt-5.5-mini` | 400,000 |
| `gpt-5.4` | `gpt-5.4` | 400,000 |
| `gpt-5.4-codex` | `gpt-5.4-codex` | 400,000 |
| `gpt-5.4-mini` | `gpt-5.4-mini` | 400,000 |
| `gpt-5` | `gpt-5` | 400,000 |
| `gpt-5-codex` | `gpt-5-codex` | 400,000 |
| `gpt-5-mini` | `gpt-5-mini` | 400,000 |

<!-- anchor: b14uq6ky -->
### opencode-openrouter models

Aliases are ordered by popularity (most-used first). A `—` window means the size is unknown at publish time and intentionally omitted.

| alias | resolved id | context window |
| --- | --- | --- |
| `kimi-k2.6` | `moonshotai/kimi-k2.6` | 200,000 |
| `step-3.5-flash` | `stepfun/step-3.5-flash` | — |
| `ling-2.6-1t-free` | `inclusionai/ling-2.6-1t:free` | — |
| `minimax-m2.7` | `minimax/minimax-m2.7` | — |
| `claude-sonnet-4.6` | `anthropic/claude-sonnet-4.6` | 200,000 |
| `hy3-preview-free` | `tencent/hy3-preview:free` | — |
| `gemini-2.5-flash` | `google/gemini-2.5-flash` | 1,048,576 |
| `nemotron-3-super-free` | `nvidia/nemotron-3-super:free` | — |
| `claude-fable-5` | `anthropic/claude-fable-5` | 1,000,000 |
| `claude-opus-4.8` | `anthropic/claude-opus-4.8` | 1,000,000 |
| `claude-opus-4.7` | `anthropic/claude-opus-4.7` | 200,000 |
| `claude-sonnet-4` | `anthropic/claude-sonnet-4` | 200,000 |
| `claude-opus-4` | `anthropic/claude-opus-4` | 200,000 |
| `gemini-2.5-pro` | `google/gemini-2.5-pro` | 2,097,152 |
| `deepseek-r1` | `deepseek/deepseek-r1` | 64,000 |

<!-- anchor: b762jf0d -->
### gemini models

| alias | resolved id | context window |
| --- | --- | --- |
| `gemini-3.1-pro` | `gemini-3.1-pro-preview` | 1,048,576 |
| `gemini-3.1-flash` | `gemini-3-flash-preview` | 1,048,576 |
| `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite-preview` | 1,048,576 |
| `gemini-2.5-pro` | `gemini-2.5-pro` | 2,097,152 |
| `gemini-2.5-flash` | `gemini-2.5-flash` | 1,048,576 |
| `gemini-2.5-flash-lite` | `gemini-2.5-flash-lite` | 1,048,576 |
| `gemini-2.0-flash` | `gemini-2.0-flash` | 1,048,576 |

<!-- anchor: m2zqnniu -->
### Local / runtime-window architectures

`claude-code-ollama` and `claude-code-minimax` define aliases but **no** context windows — the window depends on local/provider configuration (Ollama `num_ctx`, custom endpoints), not on the model name, so it is supplied at runtime by the consumer.

| architecture | alias | resolved id |
| --- | --- | --- |
| `claude-code-ollama` | `qwen-coder-32b` | `qwen2.5-coder:32b` |
| `claude-code-ollama` | `deepseek-coder` | `deepseek-coder-v2:latest` |
| `claude-code-ollama` | `codellama-70b` | `codellama:70b` |
| `claude-code-ollama` | `llama-3.1-70b` | `llama3.1:70b` |
| `claude-code-minimax` | `minimax-m2.7` | `MiniMax-M2.7` |

<!-- anchor: udbixmag -->
### `ADAPTIVE_THINKING_ONLY` semantics

`ADAPTIVE_THINKING_ONLY` is keyed by **resolved** Anthropic model id (`claude-fable-5`, `claude-sonnet-5`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`). For a member the model itself fixes the thinking knob: the adapter must **not** push a fixed thinking budget — it leaves the model on its native adaptive thinking. The **adaptive-only?** column in the claude-code table is just a view of this class. This couples to M07 resume-immutability: a thinking knob the adapter never sets cannot drift across a resume.

<!-- anchor: 0ebwiey1 -->
### Context windows and M08

Per-model windows feed M08, which separates **billing** (tokens charged) from **window occupancy** (how full the model's context is). A `—` / absent window means M08 cannot compute occupancy for that model and falls back to a documented default rather than producing `NaN`; the empty `ollama`/`minimax` tables are intentional, with windows supplied at runtime.

<!-- anchor: ckbqkmr6 -->
## Public API & Packaging (L4)

Exports `resolveModel`, `MODEL_ALIASES`, `ADAPTIVE_THINKING_ONLY`, and context-window metadata from the package root.

<!-- anchor: qxlthubn -->
## Edge cases

- Model id not in `MODEL_ALIASES` → returned unchanged (custom models and raw ids are valid).
- Alias valid for one architecture but used with another → resolves against the requested architecture's table; if absent there, passes through.
- A model in `ADAPTIVE_THINKING_ONLY` combined with an explicit thinking-budget config → the thinking knob is treated as fixed (adapter must not override).

<!-- anchor: m8z9nrr2 -->
## Acceptance criteria

These verify resolution is deterministic, pure, and never blocks an unknown model.

<tagged_list type="ac" tags="m02"/>
