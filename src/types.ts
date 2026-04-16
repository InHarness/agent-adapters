// @inharness/agent-adapters — Core types
// Based on InHarness M04 spec (m04-orchestration.md)

import type { ArchitectureModelMap } from './models.js';

// --- Content & Messages ---

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'toolUse'; toolUseId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'toolResult'; toolUseId: string; content: string; isError?: boolean }
  | {
      type: 'image';
      source:
        | { type: 'base64'; mediaType: string; data: string }
        | { type: 'url'; url: string };
    };

export interface NormalizedMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: string;
  subagentTaskId?: string;
  usage?: UsageStats;
  native?: unknown;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
}

// --- Unified Events ---

export type UnifiedEvent =
  | { type: 'text_delta'; text: string; isSubagent: boolean }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: unknown; isSubagent: boolean }
  | { type: 'tool_result'; toolUseId: string; summary: string }
  | { type: 'thinking'; text: string; isSubagent: boolean }
  | { type: 'assistant_message'; message: NormalizedMessage }
  | { type: 'subagent_started'; taskId: string; description: string; toolUseId: string }
  | { type: 'subagent_progress'; taskId: string; description: string; lastToolName?: string }
  | { type: 'subagent_completed'; taskId: string; status: string; summary?: string; usage?: unknown }
  | { type: 'result'; output: string; rawMessages: NormalizedMessage[]; usage: UsageStats; sessionId?: string }
  | { type: 'error'; error: Error }
  | { type: 'flush' };

// --- Architecture ---

export type BuiltinArchitecture =
  | 'claude-code'
  | 'claude-code-ollama'
  | 'claude-code-minimax'
  | 'codex'
  | 'opencode'
  | 'opencode-openrouter'
  | 'gemini';
export type Architecture = BuiltinArchitecture | (string & {});

// --- Provider ---

/** Configuration for a custom API backend provider (e.g. MiniMax, Ollama, OpenRouter). */
export interface ProviderConfig {
  /** Provider name — used for preset resolution. */
  provider: string;
  /** API key for the provider. Falls back to provider-specific env vars if omitted. */
  apiKey?: string;
  /** Base URL override (provider presets have defaults). */
  baseUrl?: string;
  /** Model name override. */
  model?: string;
  /** Provider-specific options (e.g. region for MiniMax). */
  [key: string]: unknown;
}

/**
 * Provider preset — knows how to configure each adapter for a given backend.
 * Each provider resolves its config into adapter-specific `architectureConfig` keys.
 */
export interface ProviderPreset {
  name: string;
  /** Architectures this provider supports. */
  architectures: string[];
  /** Resolve provider config into architectureConfig entries for the given adapter. */
  resolve(architecture: string, config: ProviderConfig): Record<string, unknown>;
}

// --- MCP Server Config ---

/** Stdio-based MCP server — spawns a subprocess. */
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** SSE-based MCP server — connects via Server-Sent Events. */
export interface McpSseServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/** HTTP streaming MCP server — connects via streamable HTTP. */
export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * In-process MCP server — created via `createMcpServer()`.
 * The `instance` is an `McpServer` from `@modelcontextprotocol/sdk`.
 * Not serializable — contains a live server object.
 */
export interface McpSdkServerConfig {
  type: 'sdk';
  name: string;
  instance: unknown;
}

/** Union of all MCP server config types. */
export type McpServerConfig =
  | McpStdioServerConfig
  | McpSseServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfig;

// --- Runtime Adapter ---

export interface RuntimeExecuteParams<A extends Architecture = Architecture> {
  prompt: string;
  systemPrompt: string;
  model: A extends keyof ArchitectureModelMap ? ArchitectureModelMap[A] : string;
  allowedTools?: string[];

  /**
   * Names of builtin MCP servers to instantiate.
   * Consumer (e.g. InHarness CLI) should resolve these into concrete `mcpServers`
   * entries before calling the adapter. Adapters do not read this field directly.
   */
  builtinMCPServers?: string[];

  /**
   * Final filtered list of allowed MCP tool names.
   * Consumer should use this to filter tools when building MCP servers.
   * Adapters do not read this field directly — they receive pre-built servers via `mcpServers`.
   */
  allowedMCPTools?: string[];

  /** MCP servers to connect — adapters read this field. */
  mcpServers?: Record<string, McpServerConfig>;
  cwd?: string;
  resumeSessionId?: string;
  maxTurns?: number;
  timeoutMs?: number;
  architectureConfig?: Record<string, unknown>;
}

export interface RuntimeAdapter {
  architecture: Architecture;
  execute(params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent>;
  abort(): void;
}

export type AdapterFactory = () => RuntimeAdapter;

// --- Errors ---

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly adapter: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class AdapterInitError extends AdapterError {
  constructor(adapter: string, cause?: unknown) {
    super(`Failed to initialize ${adapter} adapter`, adapter, cause);
    this.name = 'AdapterInitError';
  }
}

export class AdapterTimeoutError extends AdapterError {
  constructor(adapter: string, timeoutMs: number) {
    super(`${adapter} adapter timed out after ${timeoutMs}ms`, adapter);
    this.name = 'AdapterTimeoutError';
  }
}

export class AdapterAbortError extends AdapterError {
  constructor(adapter: string) {
    super(`${adapter} adapter was aborted`, adapter);
    this.name = 'AdapterAbortError';
  }
}

// --- Contract Testing ---

export interface ContractAssertion {
  name: string;
  passed: boolean;
  message?: string;
}

export interface ContractResult {
  scenario: string;
  passed: boolean;
  events: UnifiedEvent[];
  assertions: ContractAssertion[];
}
