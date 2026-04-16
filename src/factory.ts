// Adapter factory — create adapters by architecture name, with plugin registry and provider support

import type { Architecture, RuntimeAdapter, AdapterFactory, ProviderConfig } from './types.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { CodexAdapter } from './adapters/codex.js';
import { OpencodeAdapter } from './adapters/opencode.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { resolveProviderConfig } from './providers/index.js';

const builtinFactories: Record<string, AdapterFactory> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  codex: () => new CodexAdapter(),
  opencode: () => new OpencodeAdapter(),
  gemini: () => new GeminiAdapter(),
};

/** Architecture aliases that resolve to a base architecture + provider config. */
const architectureAliases: Record<string, { architecture: string; providerConfig: ProviderConfig }> = {
  'claude-code-ollama': {
    architecture: 'claude-code',
    providerConfig: { provider: 'ollama' },
  },
  'claude-code-minimax': {
    architecture: 'claude-code',
    providerConfig: { provider: 'minimax' },
  },
  'opencode-openrouter': {
    architecture: 'opencode',
    providerConfig: { provider: 'openrouter' },
  },
};

const customFactories = new Map<string, AdapterFactory>();

/**
 * Create an adapter for the given architecture, optionally with a provider backend.
 *
 * @example
 * ```ts
 * // Default backend
 * const adapter = createAdapter('claude-code');
 *
 * // With provider
 * const mmx = createAdapter('claude-code', { provider: 'minimax', apiKey: 'sk-...' });
 *
 * // Convenience alias (equivalent to above)
 * const mmx2 = createAdapter('claude-code-minimax');
 * ```
 */
export function createAdapter(
  architecture: Architecture,
  providerConfig?: ProviderConfig,
): RuntimeAdapter {
  // Resolve aliases (e.g. 'claude-code-ollama' → 'claude-code' + ollama provider)
  const alias = architectureAliases[architecture];
  let resolvedArchitecture = architecture;
  let mergedProviderConfig = providerConfig;

  if (alias && !providerConfig) {
    resolvedArchitecture = alias.architecture;
    mergedProviderConfig = alias.providerConfig;
  }

  const factory = customFactories.get(resolvedArchitecture) ?? builtinFactories[resolvedArchitecture];
  if (!factory) {
    throw new Error(
      `Unknown architecture: "${architecture}". ` +
      `Available: ${listArchitectures().join(', ')}. ` +
      `Use registerAdapter() to add custom adapters.`,
    );
  }

  const adapter = factory();

  // Apply provider config — resolves to architectureConfig entries
  if (mergedProviderConfig) {
    const resolvedConfig = resolveProviderConfig(resolvedArchitecture, mergedProviderConfig);
    // Store resolved provider config so execute() can use it
    (adapter as { _providerConfig?: Record<string, unknown> })._providerConfig = resolvedConfig;
    // Set architecture name to include provider for identification
    (adapter as { architecture: string }).architecture = alias
      ? architecture
      : `${resolvedArchitecture}-${mergedProviderConfig.provider}`;
  }

  return adapter;
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

/** List all available architecture names (builtin + aliases + custom). */
export function listArchitectures(): string[] {
  return [
    ...Object.keys(builtinFactories),
    ...Object.keys(architectureAliases),
    ...customFactories.keys(),
  ];
}
