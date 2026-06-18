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
  if (event.type === 'result') {
    // Two distinct metrics — see "Token usage" section below.
    console.log(`\n\nBilling: ${event.usage.inputTokens}in / ${event.usage.outputTokens}out`);
    console.log(`Context window used: ${event.contextSize} tokens`);
  }
}
```

## Try it

Want to see all adapters in action? Spin up an interactive chat that lets you talk to each one in turn:

```bash
npx @inharness-ai/agent-chat basic
```

See [`@inharness-ai/agent-chat`](https://www.npmjs.com/package/@inharness-ai/agent-chat) for details.

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
| `opencode` | @opencode-ai/sdk | Native SSE | Native (reasoning) | Stdio only | Yes (session.get) | Native (task tool) |
| `gemini` | @google/gemini-cli-core | Native | Native (thought) | Full (stdio, SSE, HTTP) | Yes (resumeChat) | Via threadId |

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
| `claude-code` | `fable-5` | `claude-fable-5` |
| | `sonnet-4.6` | `claude-sonnet-4-6` |
| | `sonnet-4.5` | `claude-sonnet-4-5-20250929` |
| | `opus-4.8` | `claude-opus-4-8` |
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
| `opencode-openrouter` | `claude-fable-5` | `anthropic/claude-fable-5` |
| | `claude-opus-4.8` | `anthropic/claude-opus-4.8` |
| | `claude-sonnet-4` | `anthropic/claude-sonnet-4` |
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
| `result` | Terminal event — output, rawMessages, usage (BILLING tokens), contextSize (CONTEXT WINDOW utilization) |
| `user_message` | A message pushed into the live session mid-turn (streaming-input mode — see [Mid-turn message injection](#mid-turn-message-injection)) |
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

## Inline skills

Pass skill definitions directly via `RuntimeExecuteParams.skills` instead of writing files into `.claude/skills/` ahead of time. Each skill is a `{ name, description, content }` triple — content is the Markdown body the model would normally read from a `SKILL.md` file. The library materializes them to a per-call tmpdir, wires the running SDK to load them, and removes everything in `finally` (abort-safe — works through SDK errors, timeouts, and `AbortController.abort()`).

```ts
import { createAdapter } from '@inharness-ai/agent-adapters';

const adapter = createAdapter('claude-code');

for await (const event of adapter.execute({
  prompt: 'Use the rhyme skill on "potato".',
  systemPrompt: 'Be playful.',
  model: 'sonnet-4.5',
  skills: [
    {
      name: 'rhyme',
      description: 'Generate three rhymes for a given word.',
      content: '# Rhyme\n\nReturn three words that rhyme with the input, one per line.\n',
    },
  ],
})) {
  // handle events...
}
```

### How each adapter receives the skill

| Adapter | Mechanism | Pollutes user cwd? |
|---|---|---|
| **claude-code** | tmpdir registered as a `local` plugin via `Options.plugins` | No |
| **gemini** | passed inline via `Config.skills: SkillDefinition[]` (`body` is the content) | No |
| **opencode** | mirrored into `<cwd>/.opencode/skills/agent-adapters-<uuid>-<slug>/SKILL.md` | Yes — uuid-prefixed, removed in `finally` |
| **codex** | mirrored into `<cwd>/.agents/skills/agent-adapters-<uuid>-<slug>/SKILL.md` | Yes — uuid-prefixed, removed in `finally` |

OpenCode and Codex SDKs have no programmatic skills API, so the library mirrors the SKILL.md files into the directories those agents auto-scan. The `agent-adapters-<uuid>-` prefix guarantees no collision with skills the user already keeps under those paths, and cleanup removes only the directories this call created.

### InlineSkill type

```ts
import type { InlineSkill } from '@inharness-ai/agent-adapters';

interface InlineSkill {
  name: string;                // kebab-case identifier, must be unique within the call
  description: string;         // one-line summary shown to the model in the skill listing
  content: string;             // Markdown body without frontmatter — the helper prepends it
  files?: Record<string, string>; // extra files placed alongside SKILL.md (POSIX-style relative paths)
  metadata?: Record<string, string | number | boolean>; // optional extra frontmatter keys
}
```

Validation: names with `/`, `\`, or `..` are rejected (path traversal); slugs longer than 64 chars or that collide within the same call throw. `files` keys must be relative (no leading `/`, no absolute paths), must not contain `..` segments, must not equal `SKILL.md` (use `content` for the main body), and are capped at 200 chars.

### Multi-file skills

Real Claude Code skills are often directories — a main `SKILL.md` plus helper files the model can `Read`/`Glob`. Pass them via `files`:

```ts
{
  name: 'codereview',
  description: 'Reviews a TypeScript file against project conventions.',
  content: '# Code review\n\nWhen invoked, read CHECKLIST.md and apply each item to the target file.\n',
  files: {
    'CHECKLIST.md': '- [ ] Imports sorted\n- [ ] No `any` types\n- [ ] ...\n',
    'examples/good.ts': '// idiomatic example\n',
    'examples/bad.ts':  '// anti-pattern\n',
  },
}
```

Materialized layout:
```
<tmpRoot>/skills/codereview/
  SKILL.md         ← built from `content`
  CHECKLIST.md     ← from files
  examples/
    good.ts
    bad.ts
```

For codex/opencode the entire tree is mirrored under `<cwd>/<subdir>/agent-adapters-<uuid>-codereview/`. **Gemini exception:** its `SkillDefinition.body` API takes a single string, so extra `files` are written to disk for parity but the model only sees `content`. The gemini adapter emits a `console.warn` when `files` is non-empty.

### Listing disk skills

`InlineSkill` is the write side. For the read side — discovering the skills a runtime **already auto-loads from disk** (the directories it scans whether you want it to or not) — use `listDiskSkills(architecture)`. It scans the same project/global/system directories the runtime reads and returns one entry per `<name>/SKILL.md`, parsed for frontmatter `name`/`description` (block scalars folded) plus any extra flat metadata keys.

```ts
import { listDiskSkills, getSkillSearchDirs } from '@inharness-ai/agent-adapters';

const skills = await listDiskSkills('claude-code', { cwd: process.cwd() });
for (const s of skills) {
  console.log(s.scope, s.source, s.name, '—', s.description);
}

// Inspect which directories would be scanned, without touching disk:
getSkillSearchDirs('opencode'); // [{ dir, scope, source, layout }, ...]
```

Directories scanned per architecture:

| Architecture | Project (relative to `cwd`) | Global (relative to `home`) | System |
|---|---|---|---|
| `claude-code` | `.claude/skills` | `~/.claude/skills` | — |
| `codex` | `.agents/skills` | `~/.agents/skills` | `/etc/codex/skills` |
| `opencode` | `.opencode/skills`, `.claude/skills`, `.agents/skills` | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | — |
| `gemini` | `.gemini/extensions/<ext>/skills` | `~/.gemini/extensions/<ext>/skills` | — |

Results are **not** deduplicated: the same skill name in both a project and a global directory yields two entries, each with its own `scope` (`project`/`global`/`system`) and `source` so you can see where each came from. `cwd` defaults to `process.cwd()` and `home` to `os.homedir()`. Gemini skills live only inside extensions, so a repo without extensions returns `[]`. Missing directories and unknown architectures return `[]`.

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

Options: `{ color?, thinking?, subagents?, usage?, toolResultMaxLen?, stream?, showAdapterReady?, compactAdapterReady?, sdkConfigInclude?, sdkConfigExclude? }` — all optional; `color` auto-detects TTY, `stream` accepts any `NodeJS.WritableStream` (useful for tests). `showAdapterReady` (default `true`) prints the SDK-native config snapshot at the start of each run; `compactAdapterReady` (default `false`) switches it from pretty-printed JSON to a single line.

`sdkConfigInclude` / `sdkConfigExclude` filter which paths in the `adapter_ready.sdkConfig` payload are printed. Matched subtrees are replaced with the string `"[Excluded]"` — the key stays in place so you can still see which fields the adapter passed to the SDK. Paths use dot notation with `*` as a single-segment wildcard (e.g. `'mcpServers.*.instance'`). If both are set, exclusion wins.

```ts
// Hide large/noisy fields but still see their keys in the tree
createConsoleObserver({
  sdkConfigExclude: ['mcpServers.*.instance', 'systemPrompt'],
});

// Or invert: show only what you care about
createConsoleObserver({
  sdkConfigInclude: ['model', 'maxTurns', 'mcpServers.*.command'],
});
```

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

## Session resume

Pass `resumeSessionId` (from a prior `result.sessionId`) to continue a conversation. One invariant holds across every adapter:

> **`model` and the reasoning/thinking configuration must stay constant for the lifetime of a session.**

Adapters are stateless — they keep no record of how a session was originally configured, so they cannot enforce this at runtime. The underlying providers do, though. On claude-code it fails hard: the prior assistant turn's `thinking` blocks are immutable, so resuming with a different thinking/effort/model config makes Anthropic reject the turn with

```
400 ... `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified.
```

Other adapters are more forgiving, but switching model or reasoning mid-thread is still wrong there. **To change the model or thinking config, start a new session — don't resume.**

The library exposes this declaratively so your UI can lock the right controls (or decide to fork a new thread). The `ArchOption` schema marks immutable fields with `resumeImmutable: true`, and three pure, stateless helpers expose it:

```ts
import { getSessionResumeConstraints, findResumeViolations, isSessionFieldMutable } from '@inharness-ai/agent-adapters';

// Which fields to disable in the UI once a thread is active:
getSessionResumeConstraints('claude-code');
// [ { path: 'model', reason: '...' },
//   { path: 'architectureConfig.claude_thinking', reason: '...' },
//   { path: 'architectureConfig.claude_thinking_budget', reason: '...' },
//   { path: 'architectureConfig.claude_effort', reason: '...' } ]

isSessionFieldMutable('claude-code', 'architectureConfig.claude_effort'); // false
isSessionFieldMutable('gemini', 'architectureConfig.gemini_temperature'); // true (generation-only)

// Before resuming, diff the thread's original config against the new one (you hold both):
const violations = findResumeViolations(
  'claude-code',
  thread.originalConfig,            // { model, architectureConfig } stored at turn 1
  { model, architectureConfig },    // current UI state
);
if (violations.length > 0) {
  // changing an immutable field — start a NEW session instead of resuming
}
```

`findResumeViolations` only flags a field when it is present on **both** sides and the values differ — partial configs never produce false positives. Per-turn fields (prompt, system prompt, tools, MCP servers, skills, plan mode, temperature/top-p) are all mutable and never reported.

## Image input

Attach images to the prompt with `images` — one unified shape, delivered to each
runtime in its native form. A source is inline `base64`, a remote `url`, or a
local `file` path; the `base64`/`url` members are byte-identical to the image
`source` you receive on output, so the vocabulary is the same on both sides.

```ts
import { createAdapter } from '@inharness-ai/agent-adapters';

const adapter = createAdapter('claude-code');

for await (const event of adapter.execute({
  prompt: 'What is in this image?',
  systemPrompt: 'Be concise.',
  model: 'sonnet-4.6',
  images: [
    { type: 'base64', mediaType: 'image/png', data: pngBase64 },
    { type: 'url', url: 'https://example.com/diagram.png' },
    { type: 'file', path: '/abs/path/screenshot.png' }, // mediaType inferred from extension
  ],
})) {
  // …
}
```

All four adapters accept images — `architectureCapabilities(arch).imageInput` is
`true` for every built-in architecture. The adapter bridges whatever its SDK
lacks, transparently:

- **claude-code** — `base64`/`url` go to the SDK natively; a `file` is read and
  inlined. `base64` `mediaType` must be `image/jpeg`, `image/png`, `image/gif`,
  or `image/webp` (Anthropic's accepted set) or the call errors.
- **gemini** — delivered as a `media` content part (`base64`/`file` inline,
  `url` as a uri).
- **codex** — the SDK takes only a local image path, so `base64` is written to a
  temp file and `url` is downloaded to one (both removed when the call ends);
  `file` passes through.
- **opencode** — delivered as a `file` part; `base64` is written to a temp file
  referenced as `file://…`, `url` passes through.

Images ride with the initial `prompt` and, on `claude-code`, mid-turn via
`pushMessage(text, images)` (see [Mid-turn message injection](#mid-turn-message-injection)).
Omitting `images` — or passing `[]` — is identical to a text-only prompt.

## Mid-turn message injection

By default `execute()` is one-shot: one prompt in, one `result` out. Opt into **streaming-input mode** with `streamingInput: true` to keep the session's input channel open and push additional user messages *while the agent is still working* — useful for chat UIs that want to leave the composer unlocked during a turn.

```ts
import { createAdapter, architectureCapabilities } from '@inharness-ai/agent-adapters';

// Discover support up front — no trial call needed.
if (!architectureCapabilities('claude-code').midTurnPush) return; // → true for claude-code

const adapter = createAdapter('claude-code');

for await (const event of adapter.execute({
  prompt: 'Start the long task…',
  systemPrompt: '…',
  model: 'sonnet-4.6',
  streamingInput: true, // open input channel, seeded with `prompt`
})) {
  if (event.type === 'tool_use') {
    // Inject a follow-up into the LIVE session.
    const accepted = adapter.pushMessage?.('Also handle the edge case.') ?? false;
    // accepted === false → the turn is closing; re-dispatch after it ends
    // with a fresh execute({ resumeSessionId }) instead.
  }
  if (event.type === 'user_message') {
    // The push was accepted — persist it as a user message in your transcript.
    // Emitted before the model's response, so rendered order matches the model's view.
  }
  if (event.type === 'result') {
    // In streaming-input mode you may receive MULTIPLE result events — one per
    // delivered turn. A push accepted during a turn runs as the next turn in the
    // same session and yields its own result.
  }
}
```

Contract:

- **`pushMessage(text, images?): boolean`** — `true` if the message was accepted onto the open channel, `false` if the channel is closed/closing (turn ended) or the adapter isn't in streaming-input mode. The boolean tells you which delivery path the message took — there is **no lost-message window**: on `false`, re-dispatch after the turn via `resumeSessionId`. Optional `images` (same shape as `RuntimeExecuteParams.images`) are normalized exactly like the initial prompt's; an unsupported media type or unreadable file **throws synchronously** (distinct from the `false` return, which only means the channel was closed).
- **`user_message` event** — emitted the moment a push is accepted, before the model responds to it; carries `images` when the push included any.
- **Multiple `result` events** — `execute()` stays alive across turns until the channel drains (no pending push after a `result`) or you call `abort()`. With `streamingInput` off, behavior is unchanged: a single `result`, then the stream ends.
- **Capability** — only `claude-code` (and its provider variants) supports this today; `architectureCapabilities(arch).midTurnPush` is `false` for `codex`, `gemini`, `opencode`, and unknown architectures. For those, use the after-turn path (re-dispatch with `resumeSessionId`).

> **Mid-turn ≠ instantaneous.** The contract is "delivered as early as the runtime allows." Whether the underlying SDK hands a pushed message to the model *between tool calls* within a turn or only at the *next turn boundary* is a property of the runtime. For `claude-code` (riding `@anthropic-ai/claude-agent-sdk`'s streaming-input mode) the observed behavior is **true mid-turn delivery**: a message pushed after the model's first tool call is acted on within the *same* turn (the model issues a follow-up tool call before the single `result`) — see the streaming-input E2E in `src/testing/e2e/claude-code.e2e.test.ts`. A push that lands exactly at the turn boundary instead runs as the next turn in the same session and yields an additional `result`.

## Token usage

Every `result` event carries **two distinct metrics** — pick the right one for your UI:

| Metric                 | Field on `result`                       | Bounded by              | Use for                                          |
|------------------------|-----------------------------------------|-------------------------|--------------------------------------------------|
| **USAGE BILLING TOKENS**  | `result.usage` (per-`execute()` call) | unbounded across turns  | cost, billing alarms, USD estimation             |
| **USAGE CONTEXT WINDOW**  | `result.contextSize`                  | model's context window  | "tokens left", IDE-style `12.6k / 200k` bars     |

Both are emitted by every adapter (claude-code, codex, gemini, opencode) on every `result`. They mean different things: billing totals can grow without bound across resumed turns (replayed history is re-billed, often at a cache-discounted rate), while context-window utilization is capped by the model and can never exceed it.

### USAGE CONTEXT WINDOW — show "X / 200k" utilization

Take the LAST turn's `contextSize` and divide by the model's window. `getModelContextWindow(architecture, model)` returns the cap.

```ts
import { createAdapter, getModelContextWindow } from '@inharness-ai/agent-adapters';

const architecture = 'claude-code';
const model = 'sonnet-4.6';
const adapter = createAdapter(architecture);

let lastContextSize = 0;
for await (const event of adapter.execute({
  prompt: 'Summarize today\'s standup.',
  systemPrompt: 'Be concise.',
  model,
})) {
  if (event.type === 'result') lastContextSize = event.contextSize;
}

const cap = getModelContextWindow(architecture, model) ?? 200_000;
const pct = ((lastContextSize / cap) * 100).toFixed(1);
console.log(`Context: ${lastContextSize.toLocaleString()} / ${cap.toLocaleString()} (${pct}%)`);
// → Context: 12,624 / 200,000 (6.3%)
```

`contextSize = usage.inputTokens + usage.outputTokens` after THIS turn — do NOT sum it across turns. Each turn's `inputTokens` already includes the full conversation up to that point (the model is re-fed the history every turn); adding `outputTokens` gives the post-turn conversation size. The `contextSize()` helper from `@inharness-ai/agent-adapters` exposes the same calculation if you only have a `UsageStats` in hand.

### USAGE BILLING TOKENS — sum across turns for session totals

`result.usage` is the cost of THIS `execute()` call only. On a resumed session (`resumeSessionId`), the new turn's `usage` does NOT include prior turns. To show a running session-level total, sum across calls:

```ts
import { addUsage, sumUsage, sumUsageFromEvents } from '@inharness-ai/agent-adapters';

const turn1 = await collectEvents(adapter.execute({ prompt: '...' }));
const r1 = turn1.find((e) => e.type === 'result')!;

const turn2 = await collectEvents(adapter.execute({
  prompt: '...',
  resumeSessionId: r1.sessionId,
}));
const r2 = turn2.find((e) => e.type === 'result')!;

const total = sumUsage(r1.usage, r2.usage);
console.log(`session billing: ${total.inputTokens} in / ${total.outputTokens} out`);

// Equivalent if you keep the raw event lists:
const total2 = addUsage(sumUsageFromEvents(turn1), sumUsageFromEvents(turn2));
```

This pattern matches the [Anthropic Agent SDK cost-tracking docs](https://code.claude.com/docs/en/agent-sdk/cost-tracking): *"each result only reflects the cost of that individual call… accumulate the totals yourself."*

### Cache fields

`cacheReadInputTokens` and `cacheCreationInputTokens` are **subsets** of `inputTokens`, not separate buckets (OpenAI convention; the claude-code adapter normalizes Anthropic's three additive fields to match). To compute "fresh" input billed at the full rate:

```ts
const fresh = usage.inputTokens - (usage.cacheReadInputTokens ?? 0) - (usage.cacheCreationInputTokens ?? 0);
```

Per-adapter coverage: codex surfaces `cacheReadInputTokens`; claude-code surfaces both; gemini and opencode currently surface neither.

### Helpers

All exported from `@inharness-ai/agent-adapters`:

| Helper                                             | Purpose                                                                  |
|----------------------------------------------------|--------------------------------------------------------------------------|
| `addUsage(a, b)` / `sumUsage(...)` / `sumUsageFromEvents(events)` | Aggregate per-call usage across turns (BILLING totals)         |
| `subtractUsage(a, b)`                              | Field-wise floored subtraction (used internally by codex; exposed for symmetry) |
| `contextSize(usage)`                               | `usage.inputTokens + usage.outputTokens` — same as `result.contextSize`  |
| `getModelContextWindow(architecture, model)` / `MODEL_CONTEXT_WINDOWS` | Per-model context-window caps (returns `undefined` for unknown models)  |

All are pure, stateless, and never mutate their inputs.

### Cross-process resume (codex only)

Codex's underlying SDK reports session-level cumulative usage (issue [openai/codex#17539](https://github.com/openai/codex/issues/17539)); the adapter converts it to per-`execute()` delta via a module-scoped LRU. In a single long-running process this is transparent. If your runtime spawns a new Node process per `execute()` call (per-request workers, serverless, CLI invoked per turn), pass the prior turn's raw cumulative as `priorUsage` so the per-call delta stays accurate:

```ts
const r2 = await adapter.execute({
  prompt: '...',
  resumeSessionId,
  priorUsage: priorTurnRawCumulative, // your own bookkeeping
});
```

Without `priorUsage` in a cross-process setup, the first resumed turn after each restart returns the full session cumulative as `result.usage` — a known artifact, documented in `.claude/skills/codex-sdk/SKILL.md` quirk #9. Other adapters ignore `priorUsage` (their SDKs already report per-call).

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
| codex | `OPENAI_API_KEY` env var, or local ChatGPT OAuth via `codex login` (`~/.codex/auth.json`) | `providerConfig.apiKey` or `codex_apiKey` in architectureConfig |
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
  skills?: InlineSkill[];                      // inline skills materialized to a tmpdir for this call
  cwd?: string;                                // working directory
  resumeSessionId?: string;                    // session resumption
  priorUsage?: UsageStats;                     // codex cross-process resume only — see "Token usage"
  streamingInput?: boolean;                    // open input channel for pushMessage() — see "Mid-turn message injection"
  maxTurns?: number;                           // max conversation turns (claude-code: cumulative across resume)
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
    streaming-input.ts     # Mid-turn pushMessage() into a live session
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
