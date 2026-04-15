// Generic MCP server builder — thin wrapper over @modelcontextprotocol/sdk
// Provides the same capability as claude-agent-sdk's createSdkMcpServer()
// but as a standalone, adapter-agnostic utility.
//
// Requires: @modelcontextprotocol/sdk (peer dep) and zod (for tool input schemas).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { McpSdkServerConfig } from './types.js';

// Re-export McpServer for consumers who need the type
export type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
 * import { createMcpServer, mcpTool } from '@inharness/agent-adapters';
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
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServerInstance {
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
