---
name: google-adk
description: >-
  Use when designing or implementing the google-adk adapter at
  src/adapters/google-adk.ts (NOT YET IMPLEMENTED — this is a design brief),
  evaluating @google/adk (Agent Development Kit for TypeScript) for multi-agent
  / code-first orchestration, or deciding whether to route a call to
  google-genai (single-agent Interactions API) vs google-adk (multi-agent
  framework). Covers pre-GA TS status, native MCP, FunctionTool extensibility,
  deployment-agnostic and model-agnostic design.
---

<!-- anchor: 7w0m83k3 -->
# google-adk adapter — `@google/adk` (Agent Development Kit for TypeScript)

> **Status: PLANNED — not yet implemented.** This file is a design brief. When `src/adapters/google-adk.ts` is created, promote it to a full implementation doc (use sibling adapter skills as a template).

<!-- anchor: qxycoqyj -->
## Why we're adding this

ADK-JS is Google's answer to code-first agent frameworks — philosophically closer to `claude-agent-sdk` than `@google/genai` is. Key differentiators vs Interactions API:

- **Multi-agent orchestration** as a first-class concept — compose specialized agents; our `subagent_*` events would map natively instead of being synthesized (as in `gemini-cli-core`, `codex`, `opencode`)
- **Code-first framework** — define agent logic, tools, orchestration in TypeScript with strong typing; version-control, unit-test, CI/CD-friendly
- **Model-agnostic** — optimized for Gemini / Vertex but also supports Anthropic, OpenAI, etc. (Same adapter could route to non-Google models; design decision TBD.)
- **Deployment-agnostic** — local process, container, or Cloud Run
- **Native MCP** — "MCP tools" is a documented component of the framework
- **Extensibility via `FunctionTool`** — custom tools in idiomatic TS

Adding this adapter future-proofs our library: ADK Go 1.0 and Java 1.0 are GA; TypeScript follows, and Google is clearly investing.

<!-- anchor: tlosb4im -->
## Official documentation & sources

- **ADK docs (home)**: https://adk.dev/
- **TypeScript quickstart**: https://adk.dev/get-started/typescript/
- **GitHub repo**: https://github.com/google/adk-js
- **npm (core)**: https://www.npmjs.com/package/@google/adk
- **npm (devtools)**: https://www.npmjs.com/package/@google/adk-devtools
- **Samples**: https://github.com/google/adk-samples
- **Introduction blog post**: https://developers.googleblog.com/introducing-agent-development-kit-for-typescript-build-ai-agents-with-the-power-of-a-code-first-approach/
- **Architectural tour**: https://thenewstack.io/what-is-googles-agent-development-kit-an-architectural-tour/

<!-- anchor: zudav77n -->
## Pinned version & TODO (placeholder — fill in at implementation time)

- **Planned peer**: `@google/adk` — TS is **pre-GA** at research time (while Go 1.0 and Java 1.0 are GA). Mark adapter as experimental until TS 1.0 announcement.
- **Planned dev dep**: `@google/adk-devtools` (for the local dev UI / eval tooling)
- **TODO / things to watch**:
  - TS 1.0 GA announcement — remove "experimental" warning when it lands
  - `ADK 2.0` is referenced in the nav (likely for another lang) — track versioning carefully
  - API surface is still moving — re-check docs + changelog on every bump
  - Streaming / event model is thin in docs — confirm async iterable shape before finalizing our event mapping
  - Multi-agent → `subagent_*` mapping: design how ADK sub-agents carry `taskId` / parent linkage

<!-- anchor: ronx8xrk -->
## Design brief (capability map)

| UnifiedEvent / Capability | ADK-JS mapping (expected) | Confidence |
|---|---|:---:|
| `text_delta` | streaming model unclear from docs | ⚠️ verify |
| `thinking` | surfaces Gemini thinking when model supports it | ⚠️ verify |
| `tool_use` + `tool_result` | `FunctionTool` invocations + built-in tools (e.g. `GOOGLE_SEARCH`) | high |
| `user_input_request` | unclear whether ADK has ask-user primitive | ⚠️ verify |
| `assistant_message` | aggregate from agent output | medium |
| **`subagent_started` / `_progress` / `_completed`** | **natively supported** via multi-agent composition | high — first adapter where these aren't synthesized |
| `result` | terminal agent state + usage | medium |
| `planMode` | depends on tool filtering / sandbox primitives | ⚠️ design at impl |
| MCP (stdio/SSE/HTTP/SDK) | native MCP tools component | ⚠️ verify transport subset |

<!-- anchor: 4mazvhqv -->
## Open questions (resolve at impl time)

1. **Stability**: is `@google/adk` TS actually v1.x GA at impl time, or still pre-GA? Re-check before adding to peer deps.
2. **Auth modes**: quickstart shows API key; need to confirm OAuth (workspace), Vertex service account, and rule out personal OAuth (→ route to `gemini-cli-core`).
3. **Streaming ergonomics**: does ADK expose an async iterable of events, or only completion callbacks?
4. **Multi-agent event semantics**: when a parent agent spawns a sub-agent, do we emit one unified stream with `subagent_*` wrapping, or separate streams? How is `taskId` generated?
5. **MCP transport coverage**: stdio, SSE, HTTP, SDK — which does `@google/adk` accept? In-process SDK is the most likely gap.
6. **Built-in tools exposure**: should `GOOGLE_SEARCH`, etc. be exposed via `architectureConfig` keys (`adk_enableGoogleSearch: true`), or always on?
7. **Model-agnosticism routing**: ADK supports third-party models. Do we:
   - (a) register a single `google-adk` architecture with any model string, or
   - (b) split into `google-adk-gemini` / `google-adk-anthropic` / ... for clarity
   - Decision influences `ArchitectureModelMap` shape.
8. **Overlap with other adapters**: if ADK can drive Anthropic models, does that conflict with `claude-code`? (Probably no — different primitives. Document clearly.)

<!-- anchor: uyqal75l -->
## Non-goals

- **Free-tier Code Assist for Individuals OAuth** — route to `gemini-cli-core`.
- **Single-turn "just one model call"** — use `google-genai` sibling; simpler, more direct.
- **Shell sandbox / file ops** — not ADK's job; consumer brings via MCP server or custom `FunctionTool`.

<!-- anchor: kdw6426o -->
## Skills support (design note)

**Native support: none.** ADK has no runtime "skills" primitive comparable to `SKILL.md` progressive disclosure. Its extensibility primitives are:

- **Instructions** — string prompts bound to an `Agent` at construction time
- **Tools** — `FunctionTool` (custom TS functions) + built-ins (`GOOGLE_SEARCH`, etc.)
- **Multi-agent composition** — delegate to specialised sub-agents via transfer

The phrase "ADK developer Skills" that shows up in Google's marketing and the `@google/adk-devtools` package refers to **IDE-side assistants that help developers write ADK code at author time** — not runtime skills consumed by an agent at inference time. Do not conflate.

<!-- anchor: b9tovb66 -->
### Closest analogues (at implementation time, pick one)

1. **Unsupported + warning** — emit a one-shot `warning` event when `RuntimeExecuteParams.skills` (once we add it) is provided. Same pattern as Codex for `onUserInput`.
2. **Synthesise via sub-agents** — map each requested `SKILL.md` to a sub-`Agent` whose `instructions` is the skill body + required tools. Use ADK's multi-agent transfer to invoke. **Cost**: instructions are evaluated upfront if composed at agent construction, so no progressive disclosure unless we gate via a router agent.
3. **`load_skill` FunctionTool** — our adapter reads `.claude/skills/<name>/SKILL.md` itself, exposes a single `load_skill(name)` `FunctionTool` that returns the body. The model invokes it on demand → genuine progressive disclosure at the cost of one function-call round-trip per load. Matches the OpenCode `skill` tool shape.

Recommendation: option 3 gives the best unified-event-compat (it produces a normal `tool_use` + `tool_result` pair that already maps to our taxonomy). Defer the decision to implementation time; revisit if ADK adds a native skill concept before then.

<!-- anchor: pyqs2c51 -->
### Dynamic loading

None natively. Option 3 above gives it artificially.

<!-- anchor: 2459zq0y -->
## Architectures this adapter will register

- `google-adk` — primary
- Possibly `google-adk-vertex` if Vertex needs separate preset
- Model aliases: decide between passthrough (model-agnostic) vs curated per-model-family

<!-- anchor: 090rj45k -->
## Key files (at implementation time)

- `src/adapters/google-adk.ts` — NEW
- `src/testing/e2e/google-adk.e2e.test.ts` — NEW
- `src/models.ts` — decide model alias strategy, add entry
- `src/types.ts` — add to `BuiltinArchitecture` union
- `src/index.ts` — register in `createAdapter()`
- `package.json` — add `@google/adk` peer + dev dep

<!-- anchor: 0isvjwon -->
## Reminder

When implementing, follow the unified-architecture checklist (see `unified-architecture` skill, section "Checklist: adding a new event type or param field"). Since ADK is the first adapter where `subagent_*` is native, this is also an opportunity to audit our subagent event shape and make sure it fits real multi-agent flows rather than the synthesis patterns baked in by the other adapters.
