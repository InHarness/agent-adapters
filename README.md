# @inharness/agent-adapters

Unified TypeScript interface for AI agent SDKs. Run prompts through Claude Code, Codex, OpenCode, or Gemini with one consistent `AsyncIterable<UnifiedEvent>` stream.

```ts
import { createAdapter } from '@inharness/agent-adapters';

const adapter = createAdapter('claude-code');

for await (const event of adapter.execute({
  prompt: 'Read package.json and summarize it.',
  systemPrompt: 'Be concise.',
  model: 'claude-sonnet-4-20250514',
})) {
  if (event.type === 'text_delta') process.stdout.write(event.text);
  if (event.type === 'result') console.log('\n\nDone. Tokens:', event.usage);
}
```

## Why

Every AI agent SDK has its own event protocol. Claude Code emits `SDKMessage`, Codex emits `ThreadEvent`, OpenCode uses SSE, Gemini has `AgentEvent`. This package normalizes all of them into a single typed stream — `AsyncIterable<UnifiedEvent>` — so your application code doesn't change when you swap agents.

**No existing package does this.** `coder/agentapi` wraps CLI processes (Go, no types). AG-UI is a wire protocol. Vercel AI SDK covers LLM APIs, not agent SDKs.

## Install

```bash
npm install @inharness/agent-adapters

# Install only the SDKs you need (peer dependencies):
npm install @anthropic-ai/claude-agent-sdk   # for claude-code
npm install @openai/codex-sdk                 # for codex
npm install @opencode-ai/sdk                  # for opencode
npm install @google/gemini-cli-core           # for gemini (experimental)
```

## Adapters

| Architecture | SDK | Streaming | Thinking | MCP | Session Resume | Subagents |
|---|---|---|---|---|---|---|
| `claude-code` | @anthropic-ai/claude-agent-sdk | Native deltas | Native streaming | Full (stdio) | Yes (sessionId) | Native (Agent tool) |
| `claude-code-ollama` | Same + Ollama backend | Native deltas | Model-dependent | Full (stdio) | Model-dependent | Model-dependent |
| `codex` | @openai/codex-sdk | Synthesized (full text) | Post-hoc summary | Native (McpToolCallItem) | Yes (resumeThread) | No |
| `opencode` | @opencode-ai/sdk | Native SSE | Native (reasoning) | Stdio bridge | No | Native (task tool) |
| `gemini` | @google/gemini-cli-core | Native | Native (thought) | CLI-level | No | Via threadId |

> **Gemini is experimental.** The `@google/gemini-cli-core` package is the core of Gemini CLI, not a standalone SDK. It requires full CLI infrastructure. Consider wrapping the `gemini` CLI binary for production use.

## UnifiedEvent

All adapters produce the same 11 event types:

| Event | Description |
|---|---|
| `text_delta` | Incremental text output |
| `thinking` | Model reasoning/thinking |
| `tool_use` | Tool invocation started |
| `tool_result` | Tool invocation completed |
| `assistant_message` | Full normalized message |
| `subagent_started` | Subagent task began |
| `subagent_progress` | Subagent progress update |
| `subagent_completed` | Subagent task finished |
| `result` | Terminal event — output, rawMessages, usage |
| `error` | Error event |
| `flush` | Context compaction boundary |

## Tree-shakeable imports

Import only the adapter you need — no unnecessary SDK dependencies:

```ts
import { ClaudeCodeAdapter } from '@inharness/agent-adapters/claude-code';
import { CodexAdapter } from '@inharness/agent-adapters/codex';
import { OpencodeAdapter } from '@inharness/agent-adapters/opencode';
import { GeminiAdapter } from '@inharness/agent-adapters/gemini';
```

## Observer pattern

Attach observers to the event stream without consuming it:

```ts
import { createAdapter, observeStream } from '@inharness/agent-adapters';
import type { StreamObserver } from '@inharness/agent-adapters';

const logger: StreamObserver = {
  onTextDelta(text) { process.stdout.write(text); },
  onToolUse(name, id) { console.log(`\nTool: ${name}`); },
  onResult(output, msgs, usage) { console.log(`\nTokens: ${usage.inputTokens}+${usage.outputTokens}`); },
};

const adapter = createAdapter('claude-code');
const stream = adapter.execute(params);

for await (const event of observeStream(stream, [logger])) {
  // events are dispatched to observers AND available here
}
```

## Streaming utilities

```ts
import { collectEvents, filterByType, takeUntilResult, splitBySubagent, extractText } from '@inharness/agent-adapters';

// Collect all events into array
const events = await collectEvents(stream);

// Filter to specific event type
for await (const delta of filterByType(stream, 'text_delta')) {
  process.stdout.write(delta.text);
}

// Stop after result/error
for await (const event of takeUntilResult(stream)) { ... }

// Separate main and subagent events
const { main, subagent } = await splitBySubagent(stream);

// Get just the text output
const text = await extractText(stream);
```

## Custom adapters

Register your own adapters for any agent architecture:

```ts
import { registerAdapter, createAdapter } from '@inharness/agent-adapters';
import type { RuntimeAdapter } from '@inharness/agent-adapters';

class AiderAdapter implements RuntimeAdapter {
  architecture = 'aider';
  abort() { /* ... */ }
  async *execute(params) { /* yield UnifiedEvent */ }
}

registerAdapter('aider', () => new AiderAdapter());

const adapter = createAdapter('aider');
```

## Contract testing

Validate that your custom adapter produces correct event sequences:

```ts
import { assertSimpleText, assertToolUse, assertThinking, assertMultiTurn } from '@inharness/agent-adapters/testing';

const result = await assertSimpleText(myAdapter.execute(params));
console.log(result.passed); // true/false
console.log(result.assertions); // detailed per-assertion results
```

## Auth per adapter

| Adapter | Auth |
|---|---|
| claude-code | SDK manages internally (OAuth, cached credentials, or `ANTHROPIC_API_KEY`) |
| codex | `OPENAI_API_KEY` env var |
| opencode | `OPENROUTER_API_KEY` env var + `opencode` CLI in PATH |
| gemini | `GOOGLE_API_KEY` or `GEMINI_API_KEY` env var |

## RuntimeExecuteParams

```ts
interface RuntimeExecuteParams {
  prompt: string;                              // conversation prompt
  systemPrompt: string;                        // system prompt
  model: string;                               // model ID
  allowedTools?: string[];                     // builtin SDK tools
  builtinMCPServers?: string[];                // builtin MCP server names
  allowedMCPTools?: string[];                  // allowed MCP tools
  mcpServers?: Record<string, McpServerConfig>; // external MCP servers
  cwd?: string;                                // working directory
  resumeSessionId?: string;                    // session resumption
  maxTurns?: number;                           // max conversation turns
  timeoutMs?: number;                          // execution timeout
  architectureConfig?: Record<string, unknown>; // architecture-specific config
}
```

### Architecture-specific config

| Key | Adapter | Description |
|---|---|---|
| `claude_thinking` | claude-code | `{ type: 'enabled', budgetTokens?: number }` |
| `claude_effort` | claude-code | `'low' \| 'medium' \| 'high' \| 'max'` |
| `ollama_baseUrl` | claude-code-ollama | Ollama API base URL |
| `codex_sandboxMode` | codex | `'read-only' \| 'workspace-write'` |
| `codex_reasoningEffort` | codex | `'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh'` |
| `opencode_temperature` | opencode | Temperature (0-2) |
| `opencode_topP` | opencode | Top-P sampling |
| `gemini_thinkingBudget` | gemini | Thinking token budget |
| `gemini_temperature` | gemini | Temperature (0-2) |

## License

MIT
