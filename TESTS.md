# Testing

This library ships two tiers of tests:

| Tier | Purpose | Network | Config | Location |
| --- | --- | --- | --- | --- |
| **Unit / contract** | Fast checks of adapter behaviour against `MockAdapter`; shared assertions for the unified event stream | No | `vitest.config.ts` (excludes `**/e2e/**`) | `src/**/*.test.ts` |
| **E2E** | Hit real vendor SDKs through each adapter (Claude Code, Codex, OpenCode, Gemini) | Yes | `vitest.config.e2e.ts` (120 s timeout, `retry: 0`, loads `.env`) | `src/testing/e2e/*.e2e.test.ts` |

## Prerequisites

```bash
npm install
```

- E2E tests auto-load a `.env` file at the repo root (via `loadEnv()` in `vitest.config.e2e.ts`). Put the API keys listed in [Environment variables](#environment-variables) there, or export them in your shell.
- Tests are **auto-skipped** when required env vars are missing — you can safely run `npm run test:e2e` with only some keys set.
- OpenCode E2E requires the `opencode` CLI on `PATH`.

## Unit tests

```bash
npm test                # run all unit / contract tests
npm run test:claude     # filter by filename: adapters/claude-code
npm run test:codex
npm run test:opencode
npm run test:gemini
```

These need no API keys and no external binaries.

## Adapter normalization tests

Each adapter normalizes its native SDK events into the unified `NormalizedMessage` (with `ContentBlock[]`). These tests verify that mapping without hitting any real vendor API.

| Adapter | Style | File |
| --- | --- | --- |
| `claude-code` | pure-function unit (helpers exported) | `src/adapters/claude-code.normalize.test.ts` |
| `gemini`      | pure-function unit (helpers exported) | `src/adapters/gemini.normalize.test.ts` |
| `codex`       | fixture replay (mocked SDK)           | `src/adapters/codex.normalize.test.ts` |
| `opencode`    | fixture replay (mocked SSE stream)    | `src/adapters/opencode.normalize.test.ts` |

Why two styles? `claude-code` and `gemini` already have isolated normalization helpers (`normalizeContentBlocks`, `normalizeAssistantMessage`, `contentPartsToBlocks`) — testing them directly is the cheapest, most precise option. `codex` and `opencode` interleave normalization with stream/state handling; we test them as black boxes by feeding fixtures of native SDK events through `vi.mock()` and asserting the resulting `result.rawMessages`. Fixtures live under `src/adapters/__fixtures__/` and carry a header noting which SDK version they target.

Common assertion helper (re-used by E2E):

- `assertNormalization(events, expected)` — `src/testing/normalization.ts`, re-exported from `@inharness-ai/agent-adapters/testing`. Walks the flattened `ContentBlock` stream from `result.rawMessages` (optionally filtered by `role`) and asserts the expected blocks appear in order. Fields on each expected block are matched partially.

Coverage matrix — what ends up in `NormalizedMessage.content` per adapter (events emitted on the unified stream may differ; see the adapter skill files for the full event taxonomy):

| Block type   | claude-code | codex | opencode | gemini |
| ---          | ---         | ---   | ---      | ---    |
| `text`       | ✓           | ✓     | ✓        | ✓      |
| `thinking`   | ✓           | —     | ✓        | ✓      |
| `toolUse`    | ✓ (assistant role) | — (events only) | ✓ | n/a |
| `toolResult` | ✓ (user role)      | — (events only) | ✓ | n/a |
| `image`      | —           | —     | —        | ✓      |
| `subagentTaskId` | ✓ (`parent_tool_use_id`) | — | — | partial |

Run only normalization tests:

```bash
npx vitest run normalize
```

E2E tests additionally call `assertNormalization` on the live event stream in their text/tool/thinking scenarios, so the same contract is verified against real SDK output as well.

## E2E tests

```bash
npm run test:e2e                # all four adapters (skips any without keys)
npm run test:e2e:claude         # Claude Code only
npm run test:e2e:codex          # Codex only
npm run test:e2e:opencode       # OpenCode only
npm run test:e2e:gemini         # Gemini only
```

### Claude — pick a specific model

Claude E2E reads the model from `E2E_CLAUDE_MODEL` (default: `sonnet-4.6`). See `src/testing/e2e/claude-code.e2e.test.ts:45`.

Convenience scripts are already wired up:

```bash
npm run test:e2e:claude:sonnet-4.6
npm run test:e2e:claude:sonnet-4.5
npm run test:e2e:claude:opus-4.7
npm run test:e2e:claude:opus-4.6
npm run test:e2e:claude:opus-4.5
npm run test:e2e:claude:haiku-4.5
```

Or set the env var yourself:

```bash
E2E_CLAUDE_MODEL=opus-4.7 npm run test:e2e:claude
E2E_CLAUDE_MODEL=claude-sonnet-4-6 npm run test:e2e:claude   # full ID also works
```

To force-skip the Claude E2E suite (e.g. on CI without credentials):

```bash
SKIP_CLAUDE_E2E=1 npm run test:e2e
```

### Other adapters — pick a specific model

Codex, OpenCode, and Gemini E2E tests currently hardcode their model inside the test file. To try a different model, either edit the `MODEL` constant at the top of the relevant `*.e2e.test.ts`, or add an env-var override the same way `claude-code.e2e.test.ts` does.

Available aliases per architecture (from `src/models.ts` `MODEL_ALIASES`) — you can also pass a full model ID; `resolveModel()` at `src/models.ts:107` passes those through and throws an `AdapterError` listing aliases for anything unknown:

| Architecture | Aliases |
| --- | --- |
| `claude-code` | `sonnet-4.6`, `sonnet-4.5`, `opus-4.7`, `opus-4.6`, `opus-4.5`, `haiku-4.5` |
| `claude-code-ollama` | `qwen-coder-32b`, `deepseek-coder`, `codellama-70b`, `llama-3.1-70b` |
| `claude-code-minimax` | `minimax-m2.7` |
| `codex` | `o4-mini`, `o3`, `codex-mini` |
| `opencode-openrouter` | `claude-sonnet-4`, `claude-opus-4`, `gemini-2.5-pro`, `deepseek-r1` |
| `gemini` | `gemini-3.1-pro`, `gemini-3.1-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash` |

## Environment variables

| Adapter | Required | Optional |
| --- | --- | --- |
| Claude Code | `ANTHROPIC_API_KEY` (or let the SDK do its OAuth flow) | `E2E_CLAUDE_MODEL`, `SKIP_CLAUDE_E2E` |
| Codex | `OPENAI_API_KEY` | — |
| OpenCode | `OPENROUTER_API_KEY` (+ `opencode` on `PATH`) | — |
| Gemini | `GOOGLE_API_KEY` **or** `GEMINI_API_KEY` | — |

Each E2E file calls `requireEnv(...)` (see `src/testing/e2e/shared.ts:27`) and uses `describe.skipIf(...)` to skip cleanly when keys are absent.

## Running a single file or test

```bash
# One file
npx vitest run --config vitest.config.e2e.ts src/testing/e2e/claude-code.e2e.test.ts

# One test by name (substring match on `it(...)` / `describe(...)`)
npx vitest run --config vitest.config.e2e.ts -t "streams text deltas"

# Bump the timeout for a slow model
npx vitest run --config vitest.config.e2e.ts --testTimeout 240000 claude-code
```

## Writing new tests

**Unit / contract** — import helpers from the public `@inharness-ai/agent-adapters/testing` subpath (exported by `src/testing/index.ts`):

- `MockAdapter`, `createTestParams` — from `src/testing/helpers.ts`
- `assertSimpleText`, `assertToolUse`, `assertThinking`, `assertMultiTurn` — from `src/testing/contract.ts`

**E2E** — reuse `src/testing/e2e/shared.ts` instead of inventing new prompts or assertions:

- Prompts: `SIMPLE_PROMPT`, `TOOL_PROMPT`, `THINKING_PROMPT`, `SUBAGENT_PROMPT`, `PLAN_WRITE_PROMPT`, `USER_QUESTION_PROMPT`
- Stream assertions: `assertSimpleTextStream`, `assertTextDeltas`, `assertResultEvent`, `assertNormalization` (block-level mapping check, see [Adapter normalization tests](#adapter-normalization-tests))
- MCP: `createE2eMcpServer()` (echo tool for tool-use tests)
- Plan-mode helpers: `createPlanModeTmpDir`, `findWriteToolUses`, `assertNoFileCreated`
- User-input scenario: `runUserQuestionScenario`, `assertUserInputRequest`
- Env guard: `requireEnv(...vars)` — returns `true` only when all vars are set

## Troubleshooting

- **Suite reports 0 tests / silently skips** — a required env var is missing. Check the `requireEnv(...)` call at the top of the adapter's E2E file.
- **`AdapterError: Unknown model "<x>" for architecture "<y>"`** — alias typo. The error message lists the valid aliases; full model IDs also work.
- **Timeouts on reasoning models** — default is 120 s; raise with `--testTimeout` or by editing `vitest.config.e2e.ts`.
- **OpenCode E2E fails with "opencode not found"** — install the CLI and make sure it's on `PATH`.
