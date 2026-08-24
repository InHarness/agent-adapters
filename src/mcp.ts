// Generic MCP server builder — thin wrapper over @modelcontextprotocol/sdk
// Provides the same capability as claude-agent-sdk's createSdkMcpServer()
// but as a standalone, adapter-agnostic utility.
//
// Requires: @modelcontextprotocol/sdk (peer dep) and zod (for tool input schemas).

import { createRequire } from 'node:module';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { McpSdkServerConfig, McpServerConfig } from './types.js';
import { AdapterInitError } from './types.js';
import { checkPeerSdkVersion } from './sdk-version.js';

// Re-export McpServer for consumers who need the type
export type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// @modelcontextprotocol/sdk is an optional peer dependency. Importing it at the
// top level would eagerly require it whenever the package's main entry is loaded
// (which re-exports createMcpServer/mcpTool), crashing consumers who don't have
// it installed. The SDK is CommonJS, so a synchronous createRequire lets us load
// it lazily on first use while keeping createMcpServer() synchronous.
const requireSdk = createRequire(import.meta.url);

/** Handler function for an MCP tool. */
export type McpToolHandler = (
  args: Record<string, unknown>,
  extra: unknown,
) => Promise<McpToolResult>;

/** Result returned from an MCP tool handler. */
export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
}

/**
 * Definition of a single MCP tool.
 *
 * `inputSchema` must be a Zod raw shape — a Record where each value is a Zod type.
 * Example: `{ name: z.string(), age: z.number().optional() }`
 *
 * Typed as `Record<string, unknown>` to avoid coupling to a specific Zod version.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: McpToolHandler;
  annotations?: ToolAnnotations;
}

/** Options for creating an MCP server. */
export interface CreateMcpServerOptions {
  name: string;
  version?: string;
  tools?: McpToolDefinition[];
}

/** Result of createMcpServer — contains the live server and a config object for adapters. */
export interface McpServerInstance {
  /** The live McpServer — use for advanced operations. */
  server: McpServer;
  /** Config object to pass in RuntimeExecuteParams.mcpServers. */
  config: McpSdkServerConfig;
}

/**
 * Creates an in-process MCP server with the given tools.
 * Returns a config object compatible with `RuntimeExecuteParams.mcpServers`.
 *
 * Requires `@modelcontextprotocol/sdk` and `zod` as peer dependencies.
 * Tool input schemas must be Zod raw shapes (e.g. `{ name: z.string() }`).
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { createMcpServer, mcpTool } from '@inharness-ai/agent-adapters';
 *
 * const { config } = createMcpServer({
 *   name: 'my-tools',
 *   tools: [
 *     mcpTool('greet', 'Say hello', { name: z.string() },
 *       async (args) => ({ content: [{ type: 'text', text: `Hello ${args.name}` }] })),
 *   ],
 * });
 * adapter.execute({ ...params, mcpServers: { 'my-tools': config } });
 * ```
 *
 * ONE SERVER PER RUN. The returned instance is bound to a single transport for the
 * duration of an `execute()` call, so build a fresh one per run (or await the
 * previous run) rather than sharing one across concurrent runs — see
 * {@link claimSdkMcpInstances} for what happens otherwise, and why it is refused
 * up front instead.
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServerInstance {
  let McpServer: typeof import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
  try {
    ({ McpServer } = requireSdk(
      '@modelcontextprotocol/sdk/server/mcp.js',
    ) as typeof import('@modelcontextprotocol/sdk/server/mcp.js'));
  } catch (err) {
    throw new AdapterInitError('mcp', err);
  }
  const versionCheck = checkPeerSdkVersion('@modelcontextprotocol/sdk');
  if (versionCheck.status === 'mismatch') {
    throw new AdapterInitError('mcp', new Error(versionCheck.message));
  }
  // 'undeterminable' proceeds: createMcpServer has no event stream to surface a warning
  // through, and the require() above already proved the SDK is installed and loadable.
  const server = new McpServer(
    { name: options.name, version: options.version ?? '1.0.0' },
    { capabilities: { tools: options.tools?.length ? {} : undefined } },
  );

  for (const t of options.tools ?? []) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputSchema as never,
        annotations: t.annotations,
      },
      t.handler as never,
    );
  }

  return {
    server,
    config: { type: 'sdk', name: options.name, instance: server },
  };
}

/**
 * Helper to create a tool definition for use with `createMcpServer`.
 * `inputSchema` must be a Zod raw shape — `{ paramName: z.string(), ... }`.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const tool = mcpTool(
 *   'save_memo',
 *   'Save a memo to agent memory',
 *   { content: z.string().describe('Memo text') },
 *   async (args) => {
 *     await saveMemo(args.content as string);
 *     return { content: [{ type: 'text', text: 'Saved' }] };
 *   },
 * );
 * ```
 */
export function mcpTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: McpToolHandler,
  annotations?: ToolAnnotations,
): McpToolDefinition {
  return { name, description, inputSchema, handler, annotations };
}

// --- One instance per run ---

/**
 * SDK-type MCP server instances currently bound to a live `execute()`.
 *
 * WHY THIS EXISTS. An `McpServer` is a single-transport object: the Agent SDK
 * connects it to the run's transport, and `Protocol.connect()` on an already
 * connected server throws `"Already connected to a transport"`. The SDK swallows
 * that rejection into a debug log and still advertises the server to the CLI, so
 * every later `mcp_message` for it fails with `"SDK MCP server not found"` — which
 * the CLI renders as `(<tool> completed with no output)`. That is the same silent
 * signature as a severed control channel, from a completely different cause, and
 * nothing in this library used to catch it.
 *
 * So the contract is: ONE server instance per `execute()` call. Reusing one across
 * concurrent runs is rejected eagerly, at init, where the message can still name
 * what went wrong.
 *
 * A `Set` of live claims, not a `WeakSet` of "ever used": a SEQUENTIAL reuse is
 * fine — the previous run released its transport — and only an overlap is the bug.
 */
const claimedSdkMcpInstances = new Set<object>();

/**
 * Claim every SDK-type instance in `servers` for one run. All-or-nothing: on a
 * conflict nothing stays claimed, so the failing run cannot strand another one's
 * ability to start.
 *
 * @returns the claimed instances (pass to {@link releaseSdkMcpInstances}), or the
 * name of the server that was already in use.
 */
export function claimSdkMcpInstances(
  servers: Record<string, McpServerConfig> | undefined,
): { ok: true; claimed: object[] } | { ok: false; conflictingServer: string } {
  const claimed: object[] = [];
  for (const [name, cfg] of Object.entries(servers ?? {})) {
    if ((cfg as McpSdkServerConfig).type !== 'sdk') continue;
    const instance = (cfg as McpSdkServerConfig).instance;
    if (typeof instance !== 'object' || instance === null) continue;
    if (claimedSdkMcpInstances.has(instance)) {
      for (const c of claimed) claimedSdkMcpInstances.delete(c);
      return { ok: false, conflictingServer: name };
    }
    claimedSdkMcpInstances.add(instance);
    claimed.push(instance);
  }
  return { ok: true, claimed };
}

/** Release a claim taken by {@link claimSdkMcpInstances}. Safe to call twice. */
export function releaseSdkMcpInstances(claimed: readonly object[]): void {
  for (const instance of claimed) claimedSdkMcpInstances.delete(instance);
}

/**
 * The error a reused instance produces. Exported so adapters phrase it identically.
 */
export function mcpInstanceReuseError(adapter: string, serverName: string): AdapterInitError {
  return new AdapterInitError(
    adapter,
    new Error(
      `MCP server "${serverName}" is already connected to another run on this process. ` +
        'An SDK-type MCP server instance can serve one execute() call at a time — build a ' +
        'fresh one with createMcpServer() per run, or await the previous run before starting ' +
        'the next. Reusing it would leave the server advertised but unreachable, and every ' +
        'tool call would come back empty.',
    ),
  );
}
