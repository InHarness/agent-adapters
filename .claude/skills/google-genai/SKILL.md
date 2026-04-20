---
name: google-genai
description: Use when designing or implementing the google-genai adapter at src/adapters/google-genai.ts (NOT YET IMPLEMENTED — this is a design brief), evaluating @google/genai Interactions API for paid Gemini use cases (API key / Workspace OAuth / Vertex), or deciding whether to route a Gemini call to gemini-cli-core (free-tier personal OAuth) vs google-genai (stable, documented, built-in MCP + SSE streaming + long-running tasks + Deep Research Agent). Covers Interactions API Beta status and design open questions.
---

# google-genai adapter — `@google/genai` Interactions API

> **Status: PLANNED — not yet implemented.** This file is a design brief. When `src/adapters/google-genai.ts` is created, promote it to a full implementation doc (use sibling adapter skills as a template — sections: Pinned version, Native API surface, Event mapping, Quirks, Troubleshooting).

## Why we're adding this

The existing `gemini-cli-core` adapter exists strictly to support **free-tier Code Assist for Individuals OAuth** — the only Google path without a paid API key. But `gemini-cli-core` is internal, undocumented, and unstable.

For every other Gemini use case — paid API key, Workspace OAuth, Vertex AI — we want a first-class, stable, documented adapter. **`@google/genai`'s Interactions API** is that answer:

- Documented on ai.google.dev, schemas published and change-controlled
- SSE streaming with `content.delta` events — straightforward mapping to `UnifiedEvent.text_delta`
- Built-in MCP server support (remote)
- Long-running / background execution with polling — potential fit for our eventual `resumeSessionId` flow
- Deep Research Agent (`deep-research-pro-preview-12-2025`) available as a specialized model
- Proper `systemInstruction` field (no Codex-style concatenation)
- Function calling + built-in tools: Google Search, Maps, Code execution, URL context, Computer Use, File search

Status is **Beta** — breaking schema changes possible. Pin conservatively.

## Official documentation & sources

- **Interactions API docs**: https://ai.google.dev/gemini-api/docs/interactions
- **Agents overview**: https://ai.google.dev/gemini-api/docs/agents
- **Function calling**: https://ai.google.dev/gemini-api/docs/function-calling
- **Libraries / auth guide**: https://ai.google.dev/gemini-api/docs/libraries
- **Gemini API reference**: https://ai.google.dev/gemini-api/docs
- **npm (`@google/genai`)**: https://www.npmjs.com/package/@google/genai
- **Repo (`js-genai`)**: https://github.com/googleapis/js-genai

## Pinned version & TODO (placeholder — fill in at implementation time)

- **Planned peer**: `@google/genai` (latest observed at research time: `1.48.0`; pin to current stable at impl)
- **TODO / things to watch**:
  - Interactions API is **Beta** — expect breaking schema changes; re-test on every version bump
  - `deep-research-pro-preview-12-2025` model ID is preview/rotating — don't hard-code
  - MCP transport subset: Interactions API documents "remote MCP" — verify which of our `McpServerConfig` types translate (likely SSE/HTTP, probably not stdio)
  - Background execution via polling — design how our `execute(): AsyncIterable<UnifiedEvent>` bridges long-running async tasks
  - Confirm whether this SDK can emit `thinking` incrementally or only as a final summary

## Design brief (capability map)

| UnifiedEvent / Capability | Interactions API mapping (expected) | Confidence |
|---|---|:---:|
| `text_delta` | `content.delta` SSE events | high |
| `thinking` | Gemini thinking features | ⚠️ verify delta vs replace |
| `tool_use` + `tool_result` | function calling + tool results; custom + built-in | high |
| `user_input_request` (model-tool) | no confirmed native ask-user primitive | ❌ → warn + ignore |
| `user_input_request` (MCP elicitation) | could propagate from remote MCP | ⚠️ verify |
| `assistant_message` | aggregate deltas into final message | high |
| `subagent_*` | not multi-agent in this API (use `google-adk` for that) | low — synthesize if ever needed |
| `result { sessionId }` | `previous_interaction_id` / `interaction_id` | medium — map to `resumeSessionId` |
| `planMode` | no native sandbox; restrict tools to read-only or emit warning | ⚠️ design at impl |
| MCP transports | remote only; likely SSE + HTTP (stdio unlikely) | medium |

## Open questions (resolve at impl time)

1. **Auth modes**: API key confirmed; Workspace OAuth confirmed; personal OAuth — should be routed to `gemini-cli-core` sibling. Verify behavior if consumer passes personal credentials accidentally.
2. **MCP transport subset**: Which of `McpStdioServerConfig | McpSseServerConfig | McpHttpServerConfig | McpSdkServerConfig` does Interactions API accept? In-process SDK server is almost certainly out.
3. **Streaming ergonomics**: Raw SSE or does `@google/genai` expose async iterable?
4. **Thinking deltas**: incremental `append` or full `replace: true`? Affects `UnifiedEvent.thinking.replace` flag.
5. **Long-running tasks**: iterator stays open for the duration, or do we surface polling via `result + sessionId` → caller resumes?
6. **Session resumption fidelity**: is `previous_interaction_id` a full state restore or just context hint? Compare with `claude-code`'s native `options.resume`.
7. **Vertex AI path**: single architecture `google-genai` handling both backends, or split into `google-genai` + `google-genai-vertex`?

## Non-goals

- **Free-tier Code Assist for Individuals OAuth** — stays in `gemini-cli-core` sibling. If consumer needs it, route there.
- **Shell / filesystem as native tools** — Interactions API does not provide these. Consumer brings them via MCP (e.g. `@modelcontextprotocol/server-filesystem`).
- **Multi-agent orchestration** — that's the `google-adk` sibling's job. Interactions API is single-interaction per call.

## Skills support (design note)

**Native support: none.** Neither `@google/genai` nor the Interactions API expose a skills primitive. Available extensibility:

- `systemInstruction` — single string
- Function calling (custom tools)
- Built-in tools: Google Search, Maps, Code execution, URL context, Computer Use, File search
- Remote MCP servers

### Don't confuse with `gemini-skills`

[github.com/google-gemini/gemini-skills](https://github.com/google-gemini/gemini-skills) ships markdown *documentation modules* (e.g. `gemini-api-dev/SKILL.md`, `gemini-interactions-api/SKILL.md`) meant to be loaded **by developers into their own prompts at authoring time** — either pasted into `systemInstruction` or fed through a coding assistant. **It is not a runtime SDK capability.** There is no progressive disclosure, no auto-discovery, no `loadSkill()` method.

### Closest analogues (at implementation time, pick one)

1. **Unsupported + warning** — cleanest; emit a one-shot `warning` event when `RuntimeExecuteParams.skills` is provided. Callers who need skills route to `claude-code` or `opencode` instead.
2. **Concatenate into `systemInstruction`** — adapter reads matching `SKILL.md` files and prepends bodies to the system instruction. Simple, but pays full token cost upfront for every session and loses progressive disclosure.
3. **`load_skill` function-calling shim** — expose one custom function `load_skill(name)` alongside user-provided tools; the adapter resolves calls against `.claude/skills/<name>/SKILL.md`. Gives progressive disclosure at the cost of one round-trip per skill. Matches the pattern recommended in the sibling `google-adk` design note.

Recommendation: option 3, for consistency with `google-adk` and to keep the event stream clean (a normal `tool_use` + `tool_result` pair).

### Dynamic loading

None natively. Option 3 above synthesises it via function calling.

## Architectures this adapter will register

- `google-genai` — primary, Gemini Developer API backend
- `google-genai-vertex` (optional) — Vertex AI backend, separate preset if needed

Model aliases to be added in `src/models.ts` mirroring the existing `gemini` architecture (Gemini 3.1 / 2.5 families), plus specialized ones like `deep-research`.

## Key files (at implementation time)

- `src/adapters/google-genai.ts` — NEW
- `src/testing/e2e/google-genai.e2e.test.ts` — NEW
- `src/models.ts` — add `google-genai` entry to `MODEL_ALIASES` + `ArchitectureModelMap`
- `src/types.ts` — add to `BuiltinArchitecture` union
- `src/index.ts` — register in `createAdapter()`
- `package.json` — add `@google/genai` peer + dev dep, bump version in dep range

## Reminder

When implementing, follow the unified-architecture checklist (see `unified-architecture` skill, section "Checklist: adding a new event type or param field") — every new adapter must update the capability matrix and provide graceful degradation for anything it can't emit.
