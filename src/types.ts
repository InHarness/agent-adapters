// @inharness/agent-adapters — Core types
// Based on InHarness M04 spec (m04-orchestration.md)

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

export type BuiltinArchitecture = 'claude-code' | 'claude-code-ollama' | 'codex' | 'opencode' | 'gemini';
export type Architecture = BuiltinArchitecture | (string & {});

// --- MCP ---

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// --- Runtime Adapter ---

export interface RuntimeExecuteParams {
  prompt: string;
  systemPrompt: string;
  model: string;
  allowedTools?: string[];
  builtinMCPServers?: string[];
  allowedMCPTools?: string[];
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
