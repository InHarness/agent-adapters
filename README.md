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

```ts
import { createAdapter } from '@inharness/agent-adapters';

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

### Custom providers

Register your own provider for any API-compatible backend:

```ts
import { registerProvider } from '@inharness/agent-adapters';
import type { ProviderPreset } from '@inharness/agent-adapters';

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
  model: 'claude-sonnet-4-20250514',
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
import { createAdapter, createMcpServer, mcpTool } from '@inharness/agent-adapters';

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
  model: 'claude-sonnet-4-20250514',
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
import { ClaudeCodeAdapter, createSdkMcpServer, tool } from '@inharness/agent-adapters/claude-code';

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
  model: 'claude-sonnet-4-20250514',
  mcpServers: { notes: server },
})) {
  // handle events...
}
```

### Mixing server types

You can combine different server types in a single execution:

```ts
import { createMcpServer, mcpTool } from '@inharness/agent-adapters';

const { config: appTools } = createMcpServer({
  name: 'app',
  tools: [/* your in-process tools */],
});

adapter.execute({
  prompt: '...',
  systemPrompt: '...',
  model: 'claude-sonnet-4-20250514',
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
} from '@inharness/agent-adapters';
```

## Error handling

All adapters emit typed errors via the `error` event. The error hierarchy lets you distinguish failure causes:

```ts
import {
  AdapterError,        // base class — all adapter errors extend this
  AdapterInitError,    // SDK initialization failed (missing API key, SDK not installed)
  AdapterTimeoutError, // execution exceeded timeoutMs
  AdapterAbortError,   // adapter.abort() was called manually
} from '@inharness/agent-adapters';

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
  model: string;                               // model ID
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
