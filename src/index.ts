// @inharness/agent-adapters — main entry point

// Types
export type {
  ContentBlock,
  NormalizedMessage,
  UsageStats,
  UnifiedEvent,
  BuiltinArchitecture,
  Architecture,
  McpServerConfig,
  McpStdioServerConfig,
  McpSseServerConfig,
  McpHttpServerConfig,
  McpSdkServerConfig,
  RuntimeExecuteParams,
  RuntimeAdapter,
  AdapterFactory,
  ProviderConfig,
  ProviderPreset,
  ContractAssertion,
  ContractResult,
} from './types.js';

// Errors
export {
  AdapterError,
  AdapterInitError,
  AdapterTimeoutError,
  AdapterAbortError,
} from './types.js';

// Adapters
export { ClaudeCodeAdapter } from './adapters/claude-code.js';
export { CodexAdapter } from './adapters/codex.js';
export { OpencodeAdapter, isOpencodeAvailable } from './adapters/opencode.js';
export { GeminiAdapter } from './adapters/gemini.js';

// Factory
export { createAdapter, registerAdapter, listArchitectures } from './factory.js';

// Observer
export type { StreamObserver } from './observer.js';
export { dispatchEvent, observeStream } from './observer.js';

// MCP server builder
export { createMcpServer, mcpTool } from './mcp.js';
export type {
  McpToolDefinition,
  McpToolHandler,
  McpToolResult,
  CreateMcpServerOptions,
  McpServerInstance,
} from './mcp.js';

// Providers
export { registerProvider, resolveProvider, listProviders } from './providers/index.js';
export { minimaxProvider } from './providers/minimax.js';
export { ollamaProvider } from './providers/ollama.js';
export { openrouterProvider } from './providers/openrouter.js';

// Models
export type {
  ClaudeCodeModel,
  ClaudeCodeOllamaModel,
  ClaudeCodeMinimaxModel,
  CodexModel,
  OpencodeOpenrouterModel,
  GeminiModel,
  ArchitectureModelMap,
  ArchitectureWithModels,
} from './models.js';
export { MODEL_ALIASES, resolveModel, getModelsForArchitecture } from './models.js';

// Utilities
export { collectEvents, filterByType, takeUntilResult, splitBySubagent, extractText } from './utils.js';

// Architecture-specific option schemas
export type { ArchOption, ArchOptionType } from './options.js';
export {
  getArchitectureOptions,
  CLAUDE_CODE_OPTIONS,
  CODEX_OPTIONS,
  OPENCODE_OPTIONS,
  GEMINI_OPTIONS,
} from './options.js';
