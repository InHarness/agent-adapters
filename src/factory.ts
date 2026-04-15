// Adapter factory — create adapters by architecture name, with plugin registry

import type { Architecture, RuntimeAdapter, AdapterFactory } from './types.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { CodexAdapter } from './adapters/codex.js';
import { OpencodeAdapter } from './adapters/opencode.js';
import { GeminiAdapter } from './adapters/gemini.js';

const builtinFactories: Record<string, AdapterFactory> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  'claude-code-ollama': () => {
    const adapter = new ClaudeCodeAdapter();
    // Architecture field override — the adapter itself handles ollama_baseUrl in architectureConfig
    (adapter as { architecture: string }).architecture = 'claude-code-ollama';
    return adapter;
  },
  codex: () => new CodexAdapter(),
  opencode: () => new OpencodeAdapter(),
  gemini: () => new GeminiAdapter(),
};

const customFactories = new Map<string, AdapterFactory>();

/**
 * Create an adapter for the given architecture.
 *
 * @example
 * ```ts
 * const adapter = createAdapter('claude-code');
 * for await (const event of adapter.execute(params)) {
 *   console.log(event.type);
 * }
 * ```
 */
export function createAdapter(architecture: Architecture): RuntimeAdapter {
  const factory = customFactories.get(architecture) ?? builtinFactories[architecture];
  if (!factory) {
    throw new Error(
      `Unknown architecture: "${architecture}". ` +
      `Available: ${[...Object.keys(builtinFactories), ...customFactories.keys()].join(', ')}. ` +
      `Use registerAdapter() to add custom adapters.`,
    );
  }
  return factory();
}

/**
 * Register a custom adapter factory for a new architecture.
 *
 * @example
 * ```ts
 * registerAdapter('aider', () => new AiderAdapter());
 * const adapter = createAdapter('aider');
 * ```
 */
export function registerAdapter(architecture: string, factory: AdapterFactory): void {
  customFactories.set(architecture, factory);
}

/** List all available architecture names (builtin + custom). */
export function listArchitectures(): string[] {
  return [...Object.keys(builtinFactories), ...customFactories.keys()];
}
