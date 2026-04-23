# @inharness-ai/agent-adapters

Unified TypeScript interface for AI agent SDKs. Run prompts through Claude Code, Codex, OpenCode, or Gemini with one consistent `AsyncIterable<UnifiedEvent>` stream.

```ts
import { createAdapter } from '@inharness-ai/agent-adapters';

const adapter = createAdapter('claude-code');

for await (const event of adapter.execute({
  prompt: 'Read package.json and summarize it.',
  systemPrompt: 'Be concise.',
  model: 'sonnet-4.6', // alias → 'claude-sonnet-4-6'
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
npm install @inharness-ai/agent-adapters

# Install only the SDKs you need (peer dependencies):
npm install @anthropic-ai/claude-agent-sdk   # for claude-code
npm install @openai/codex-sdk                 # for codex
npm install @opencode-ai/sdk                  # for opencode
npm install @google/gemini-cli-core           # for gemini

# For in-process MCP servers (optional):
npm install @modelcontextprotocol/sdk zod
```

## Adapters

| Architecture | SDK | Streaming | Thinking | MCP | Session Resume | Subagents |
|---|---|---|---|---|---|---|
| `claude-code` | @anthropic-ai/claude-agent-sdk | Native deltas | Native streaming | Full (stdio, SSE, HTTP, in-process) | Yes (sessionId) | Native (Agent tool) |
| `codex` | @openai/codex-sdk | Synthesized (full text) | Post-hoc summary | Pre-configured only | Yes (resumeThread) | No |
| `opencode` | @opencode-ai/sdk | Native SSE | Native (reasoning) | Stdio only | No | Native (task tool) |
| `gemini` | @google/gemini-cli-core | Native | Native (thought) | Full (stdio, SSE, HTTP) | No | Via threadId |

## Providers

Adapters can run against alternative API backends via **providers**. A provider knows how to configure each adapter for a given backend (env vars, base URLs, model names, etc.).

| Provider | Supported adapters | Backend |
|---|---|---|
| `minimax` | claude-code, opencode, codex | [MiniMax API](https://platform.minimax.io) (Anthropic + OpenAI compatible) |
| `ollama` | claude-code | Local [Ollama](https://ollama.com) inference |
| `openrouter` | opencode | [OpenRouter](https://openrouter.ai) multi-provider gateway |

```ts
import { createAdapter } from '@inharness-ai/agent-adapters';

// Convenience alias
const adapter = createAdapter('claude-code-minimax');

// Explicit provider config
const adapter = createAdapter('claude-code', {
  provider: 'minimax',
  apiKey: 'sk-...',
  region: 'global', // 'global' | 'cn'
});

// Same provider, different agent architecture
const opencode = createAdapter('opencode', { provider: 'minimax', apiKey: 'sk-...' });
const codex = createAdapter('codex', { provider: 'minimax', apiKey: 'sk-...' });

// Ollama (local inference)
const local = createAdapter('claude-code-ollama');
const local2 = createAdapter('claude-code', {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
});
```

### Architecture aliases

These convenience aliases create an adapter with a pre-configured provider:

| Alias | Equivalent |
|---|---|
| `claude-code-ollama` | `createAdapter('claude-code', { provider: 'ollama' })` |
| `claude-code-minimax` | `createAdapter('claude-code', { provider: 'minimax' })` |
| `opencode-openrouter` | `createAdapter('opencode', { provider: 'openrouter' })` |

### Custom providers

Register your own provider for any API-compatible backend:

```ts
import { registerProvider } from '@inharness-ai/agent-adapters';
import type { ProviderPreset } from '@inharness-ai/agent-adapters';

registerProvider({
  name: 'openrouter',
  architectures: ['claude-code', 'opencode'],
  resolve(architecture, config) {
    switch (architecture) {
      case 'claude-code':
        return {
          custom_env: {
            ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
            ANTHROPIC_AUTH_TOKEN: config.apiKey,
          },
        };
      case 'opencode':
        return {
          opencode_providerID: 'openrouter',
          opencode_apiKey: config.apiKey,
        };
      default:
        throw new Error(`Unsupported architecture: ${architecture}`);
    }
  },
});

const adapter = createAdapter('claude-code', { provider: 'openrouter', apiKey: '...' });
```

## Model aliases

Each architecture has a set of short aliases for popular models. Use an alias instead of the full model ID — the adapter resolves it at runtime. You can also pass the full model ID directly.

| Architecture | Alias | Full model ID |
|---|---|---|
| `claude-code` | `sonnet-4.6` | `claude-sonnet-4-6` |
| | `sonnet-4.5` | `claude-sonnet-4-5-20250929` |
| | `opus-4.7` | `claude-opus-4-7` |
| | `opus-4.6` | `claude-opus-4-6` |
| | `opus-4.5` | `claude-opus-4-5-20251101` |
| | `haiku-4.5` | `claude-haiku-4-5-20251001` |
| `claude-code-ollama` | `qwen-coder-32b` | `qwen2.5-coder:32b` |
| | `deepseek-coder` | `deepseek-coder-v2:latest` |
| | `codellama-70b` | `codellama:70b` |
| | `llama-3.1-70b` | `llama3.1:70b` |
| `claude-code-minimax` | `minimax-m2.7` | `MiniMax-M2.7` |
| `codex` | `o4-mini` | `o4-mini` |
| | `o3` | `o3` |
| | `codex-mini` | `codex-mini-latest` |
| `opencode-openrouter` | `claude-sonnet-4` | `anthropic/claude-sonnet-4` |
| | `claude-opus-4` | `anthropic/claude-opus-4` |
| | `gemini-2.5-pro` | `google/gemini-2.5-pro` |
| | `deepseek-r1` | `deepseek/deepseek-r1` |
| `gemini` | `gemini-2.5-pro` | `gemini-2.5-pro` |
| | `gemini-2.5-flash` | `gemini-2.5-flash` |
| | `gemini-2.0-flash` | `gemini-2.0-flash` |

```ts
import { createAdapter, resolveModel, getModelsForArchitecture, MODEL_ALIASES } from '@inharness-ai/agent-adapters';

// Use aliases — resolved automatically by the adapter
const adapter = createAdapter('claude-code');
adapter.execute({ model: 'sonnet-4.7', ... });

// Full model ID also works (pass-through)
adapter.execute({ model: 'claude-sonnet-4-7-20250219', ... });

// Resolve manually
resolveModel('claude-code', 'opus-4.6');
// → 'claude-opus-4-6-20260401'

// List available models for an architecture
getModelsForArchitecture('claude-code');
// → [{ alias: 'sonnet-4.7', fullId: 'claude-sonnet-4-7-20250219' }, ...]

// Access the full catalog
MODEL_ALIASES['claude-code'];
// → { 'sonnet-4.7': 'claude-sonnet-4-7-20250219', ... }
```

Unknown aliases throw an `AdapterError` with the list of available aliases for that architecture. TypeScript also provides compile-time autocomplete for known aliases when the architecture generic is specified.

## UnifiedEvent

All adapters produce the same event types:

| Event | Description |
|---|---|
| `adapter_ready` | SDK-native config snapshot emitted once at startup (secrets redacted) |
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
| `warning` | Non-fatal notice (e.g. an option was dropped by this adapter) |
| `flush` | Context compaction boundary |

### adapter_ready — startup audit trail

Every `execute()` emits exactly one `adapter_ready` event right after the adapter finishes building its SDK-native config, and before the first SDK call. It lets consumers see what the underlying library actually received — useful when options differ per adapter (e.g. Codex hardcodes `approvalPolicy='never'`, OpenCode drops `planMode`, Gemini maps `planMode → approvalMode:'plan'`).

```ts
for await (const event of adapter.execute(params)) {
  if (event.type === 'adapter_ready') {
    console.log(`${event.adapter} is using:`, event.sdkConfig);
  }
}
```

- `event.adapter` — the runtime adapter name (`'claude-code' | 'codex' | 'gemini' | 'opencode'`).
- `event.sdkConfig` — the **adapter-specific** config object passed to the underlying SDK (not unified). Shape:
  - claude-code: `{ options }` — the `Options` passed to `query()`.
  - codex: `{ codexOptions, threadOptions, resumeSessionId? }` — constructor + thread options.
  - opencode: `{ port, config }` — the `createOpencode()` input.
  - gemini: the `ConfigParameters` passed to `new Config(...)`.

**Secret redaction.** Field names matching `/apikey|api_key|token|secret|password|authorization|credential|bearer/i` have their string values replaced with `'[REDACTED]'`. Redaction is recursive through nested objects and arrays, so MCP `env` entries like `GITHUB_TOKEN` and `headers: { Authorization: 'Bearer ...' }` are also scrubbed. The payload is therefore safe to log at info level. A secret stashed under a non-matching custom field name (e.g. `{ myCustom: 'sk-xxx' }`) won't be caught — use conventional field names for credentials.

If the adapter had to drop or override options (e.g. Codex emits a `warning` when `mcpServers` is provided), those `warning` events fire *before* `adapter_ready`, so the ordering reads as: "here is what I threw away → here is what I kept".

## MCP servers

The library supports four MCP server transport types, matching the Model Context Protocol spec:

| Type | Config | Supported adapters |
|---|---|---|
| **Stdio** | `{ command, args, env }` | claude-code, opencode, gemini |
| **SSE** | `{ type: 'sse', url, headers }` | claude-code, gemini |
| **HTTP** | `{ type: 'http', url, headers }` | claude-code, gemini |
| **In-process (SDK)** | `{ type: 'sdk', name, instance }` | claude-code |

### Stdio MCP servers

External MCP servers that run as subprocesses — works across most adapters:

```ts
const adapter = createAdapter('claude-code');

for await (const event of adapter.execute({
  prompt: 'List files in /tmp using the filesystem server.',
  systemPrompt: 'Be concise.',
  model: 'sonnet-4.5',
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    },
  },
})) {
  // handle events...
}
```

### In-process MCP servers

Create custom MCP tools that run in the same process — no subprocess spawning, direct access to your application state:

```ts
import { z } from 'zod';
import { createAdapter, createMcpServer, mcpTool } from '@inharness-ai/agent-adapters';

// Define tools with Zod schemas
const tools = [
  mcpTool('get_user', 'Look up a user by ID', { userId: z.string() }, async (args) => {
    const user = await db.users.find(args.userId);
    return { content: [{ type: 'text', text: JSON.stringify(user) }] };
  }),

  mcpTool('list_orders', 'List recent orders', { limit: z.number().default(10) }, async (args) => {
    const orders = await db.orders.recent(args.limit);
    return { content: [{ type: 'text', text: JSON.stringify(orders) }] };
  }),
];

// Create server — returns a config for RuntimeExecuteParams
const { config } = createMcpServer({ name: 'my-app', tools });

const adapter = createAdapter('claude-code');

for await (const event of adapter.execute({
  prompt: 'Look up user U123 and list their recent orders.',
  systemPrompt: 'Use the available tools.',
  model: 'sonnet-4.5',
  mcpServers: { 'my-app': config },
})) {
  // handle events...
}
```

`createMcpServer` requires `@modelcontextprotocol/sdk` and `zod` as peer dependencies. Input schemas must be Zod raw shapes (e.g. `{ name: z.string() }`).

### Claude Code SDK tools

For Claude Code specifically, you can also use the SDK's native `createSdkMcpServer` and `tool` helpers (re-exported from the claude-code subpath):

```ts
import { z } from 'zod';
import { ClaudeCodeAdapter, createSdkMcpServer, tool } from '@inharness-ai/agent-adapters/claude-code';

const server = createSdkMcpServer({
  name: 'notes',
  tools: [
    tool('add_note', 'Add a note', { text: z.string() }, async (args) => {
      return { content: [{ type: 'text', text: `Added: ${args.text}` }] };
    }),
  ],
});

const adapter = new ClaudeCodeAdapter();

for await (const event of adapter.execute({
  prompt: 'Add a note saying hello.',
  systemPrompt: 'Use the notes tools.',
  model: 'sonnet-4.5',
  mcpServers: { notes: server },
})) {
  // handle events...
}
```

### Mixing server types

You can combine different server types in a single execution:

```ts
import { createMcpServer, mcpTool } from '@inharness-ai/agent-adapters';

const { config: appTools } = createMcpServer({
  name: 'app',
  tools: [/* your in-process tools */],
});

adapter.execute({
  prompt: '...',
  systemPrompt: '...',
  model: 'sonnet-4.5',
  mcpServers: {
    app: appTools,                                           // in-process
    filesystem: { command: 'npx', args: ['...'] },           // stdio
    remote: { type: 'sse', url: 'https://mcp.example.com' }, // SSE
  },
});
```

### MCP per adapter

| Adapter | Behavior |
|---|---|
| **claude-code** | Full support — all 4 transport types. SDK handles connections natively. |
| **gemini** | Stdio, SSE, HTTP — mapped to gemini-cli-core's `MCPServerConfig`. In-process (SDK) servers are skipped. |
| **opencode** | Stdio only — other types are silently skipped. |
| **codex** | No dynamic MCP configuration. The SDK does not expose MCP setup. Pre-configure servers via `codex mcp add` CLI or `~/.codex/config.toml`. A warning is logged if `mcpServers` is provided. |

### McpServerConfig types

```ts
import type {
  McpServerConfig,        // union of all 4 types
  McpStdioServerConfig,   // { command, args?, env? }
  McpSseServerConfig,     // { type: 'sse', url, headers? }
  McpHttpServerConfig,    // { type: 'http', url, headers? }
  McpSdkServerConfig,     // { type: 'sdk', name, instance }
} from '@inharness-ai/agent-adapters';
```

## Error handling

All adapters emit typed errors via the `error` event. The error hierarchy lets you distinguish failure causes:

```ts
import {
  AdapterError,        // base class — all adapter errors extend this
  AdapterInitError,    // SDK initialization failed (missing API key, SDK not installed)
  AdapterTimeoutError, // execution exceeded timeoutMs
  AdapterAbortError,   // adapter.abort() was called manually
} from '@inharness-ai/agent-adapters';

for await (const event of adapter.execute(params)) {
  if (event.type === 'error') {
    if (event.error instanceof AdapterTimeoutError) {
      console.log('Timed out — retrying with longer timeout');
    } else if (event.error instanceof AdapterAbortError) {
      console.log('Aborted by user');
    } else {
      console.error('Adapter error:', event.error);
    }
  }
}
```

When `timeoutMs` is set, the adapter emits an `AdapterTimeoutError` event and stops. When `adapter.abort()` is called manually, it emits an `AdapterAbortError` event and stops.

## Tree-shakeable imports

Import only the adapter you need — no unnecessary SDK dependencies:

```ts
import { ClaudeCodeAdapter } from '@inharness-ai/agent-adapters/claude-code';
import { CodexAdapter } from '@inharness-ai/agent-adapters/codex';
import { OpencodeAdapter } from '@inharness-ai/agent-adapters/opencode';
import { GeminiAdapter } from '@inharness-ai/agent-adapters/gemini';
```

## Observer pattern

Attach observers to the event stream without consuming it. For quick debugging, use the built-in `createConsoleObserver`:

```ts
import { createAdapter, observeStream, createConsoleObserver } from '@inharness-ai/agent-adapters';

const adapter = createAdapter('claude-code');
const stream = adapter.execute(params);

for await (const _ of observeStream(stream, [createConsoleObserver()])) {
  // text deltas, tool calls, tool results, subagent lifecycle and usage
  // are printed to process.stdout as they arrive
}
```

Options: `{ color?, thinking?, subagents?, usage?, toolResultMaxLen?, stream?, showAdapterReady?, compactAdapterReady? }` — all optional; `color` auto-detects TTY, `stream` accepts any `NodeJS.WritableStream` (useful for tests). `showAdapterReady` (default `true`) prints the SDK-native config snapshot at the start of each run; `compactAdapterReady` (default `false`) switches it from pretty-printed JSON to a single line.

For custom behavior, implement `StreamObserver` yourself:

```ts
import type { StreamObserver } from '@inharness-ai/agent-adapters';

const logger: StreamObserver = {
  onTextDelta(text) { process.stdout.write(text); },
  onToolUse(name, id) { console.log(`\nTool: ${name}`); },
  onResult(output, msgs, usage) { console.log(`\nTokens: ${usage.inputTokens}+${usage.outputTokens}`); },
};

for await (const event of observeStream(stream, [logger])) {
  // events are dispatched to observers AND available here
}
```

## Streaming utilities

```ts
import { collectEvents, filterByType, takeUntilResult, splitBySubagent, extractText } from '@inharness-ai/agent-adapters';

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

## Factory API

```ts
// Base signature
createAdapter(architecture: string): RuntimeAdapter;

// With provider backend
createAdapter(architecture: string, providerConfig: ProviderConfig): RuntimeAdapter;

interface ProviderConfig {
  provider: string;    // provider name (e.g. 'minimax', 'ollama')
  apiKey?: string;     // API key (falls back to env vars)
  baseUrl?: string;    // base URL override
  model?: string;      // model name override
  [key: string]: unknown; // provider-specific options (e.g. region)
}
```

## Custom adapters

Register your own adapters for any agent architecture:

```ts
import { registerAdapter, createAdapter } from '@inharness-ai/agent-adapters';
import type { RuntimeAdapter } from '@inharness-ai/agent-adapters';

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
import { assertSimpleText, assertToolUse, assertThinking, assertMultiTurn } from '@inharness-ai/agent-adapters/testing';

const result = await assertSimpleText(myAdapter.execute(params));
console.log(result.passed); // true/false
console.log(result.assertions); // detailed per-assertion results
```

## Auth per adapter

| Adapter | Default auth | With provider |
|---|---|---|
| claude-code | SDK manages internally (OAuth, cached credentials, or `ANTHROPIC_API_KEY`) | Provider sets env vars via `custom_env` |
| codex | `OPENAI_API_KEY` env var | `providerConfig.apiKey` or `codex_apiKey` in architectureConfig |
| opencode | `OPENROUTER_API_KEY` env var + `opencode` CLI in PATH | `providerConfig.apiKey` or `opencode_apiKey` in architectureConfig |
| gemini | `GOOGLE_API_KEY` or `GEMINI_API_KEY` env var | — |

## RuntimeExecuteParams

```ts
interface RuntimeExecuteParams {
  prompt: string;                              // conversation prompt
  systemPrompt: string;                        // system prompt
  model: string;                               // model alias or full model ID
  allowedTools?: string[];                     // builtin SDK tools
  builtinMCPServers?: string[];                // builtin MCP server names (consumer hint)
  allowedMCPTools?: string[];                  // allowed MCP tools (consumer hint)
  mcpServers?: Record<string, McpServerConfig>; // MCP servers — adapters read this
  cwd?: string;                                // working directory
  resumeSessionId?: string;                    // session resumption
  maxTurns?: number;                           // max conversation turns
  timeoutMs?: number;                          // execution timeout
  architectureConfig?: Record<string, unknown>; // architecture-specific config
}
```

`builtinMCPServers` and `allowedMCPTools` are consumer-level hints — the consumer (e.g. orchestrator) resolves them into concrete `mcpServers` entries before calling the adapter. Adapters only read `mcpServers`.

### Architecture-specific config

| Key | Adapter | Description |
|---|---|---|
| `claude_thinking` | claude-code | `{ type: 'enabled', budgetTokens?: number }` |
| `claude_effort` | claude-code | `'low' \| 'medium' \| 'high' \| 'max'` |
| `claude_usePreset` | claude-code | `true \| 'claude_code' \| string` — use SDK preset system prompt; `systemPrompt` becomes `append` |
| `custom_env` | claude-code | `Record<string, string>` — custom env vars merged into SDK options (set by providers) |
| `ollama_baseUrl` | claude-code | Ollama API base URL (legacy — prefer `provider: 'ollama'`) |
| `codex_sandboxMode` | codex | `'read-only' \| 'workspace-write'` |
| `codex_reasoningEffort` | codex | `'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh'` |
| `codex_baseUrl` | codex | Custom API base URL (set by providers) |
| `codex_apiKey` | codex | Custom API key (set by providers) |
| `opencode_temperature` | opencode | Temperature (0-2) |
| `opencode_topP` | opencode | Top-P sampling |
| `opencode_providerID` | opencode | Override provider ID (e.g. `'anthropic'` for MiniMax) |
| `opencode_baseUrl` | opencode | Custom provider base URL |
| `opencode_apiKey` | opencode | Custom API key |
| `opencode_model` | opencode | Override model string (e.g. `'anthropic/MiniMax-M2.7'`) |
| `gemini_thinkingBudget` | gemini | Thinking token budget |
| `gemini_temperature` | gemini | Temperature (0-2) |

## Examples

```
examples/
  claude-code/
    simple.ts              # Basic prompt → stream
    thinking.ts            # Extended thinking
    ollama-local.ts        # Local Ollama backend
    mcp-sdk-tools.ts       # SDK's createSdkMcpServer + tool()
  codex/
    sandbox.ts             # Sandboxed execution
  opencode/
    openrouter.ts          # OpenRouter integration
  gemini/
    thinking.ts            # Gemini thinking config
  advanced/
    mcp-servers.ts         # Stdio MCP servers across adapters
    mcp-in-process.ts      # In-process MCP server with createMcpServer
    mcp-mixed-servers.ts   # Mixing stdio + in-process servers
    swap-adapter.ts        # Same prompt, different adapters
    observer-pattern.ts    # Stream observers
    session-resumption.ts  # Session resume
    streaming-utilities.ts # collectEvents, filterByType, etc.
    timeout-and-abort.ts   # Timeout and manual abort
```

## License

MIT
