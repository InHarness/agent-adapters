// Provider registry — resolve backend providers to adapter-specific config

import type { ProviderPreset, ProviderConfig } from '../types.js';
import { minimaxProvider } from './minimax.js';
import { ollamaProvider } from './ollama.js';
import { openrouterProvider } from './openrouter.js';

const builtinProviders: Record<string, ProviderPreset> = {
  minimax: minimaxProvider,
  ollama: ollamaProvider,
  openrouter: openrouterProvider,
};

const customProviders = new Map<string, ProviderPreset>();

/**
 * Register a custom provider preset.
 *
 * @example
 * ```ts
 * registerProvider({
 *   name: 'openrouter',
 *   architectures: ['claude-code', 'opencode'],
 *   resolve(arch, config) { return { custom_env: { ... } }; },
 * });
 * ```
 */
export function registerProvider(preset: ProviderPreset): void {
  customProviders.set(preset.name, preset);
}

/** Resolve a provider by name. Returns undefined if not found. */
export function resolveProvider(name: string): ProviderPreset | undefined {
  return customProviders.get(name) ?? builtinProviders[name];
}

/** List all registered provider names (builtin + custom). */
export function listProviders(): string[] {
  return [...Object.keys(builtinProviders), ...customProviders.keys()];
}

/**
 * Resolve a provider config into architectureConfig for a given adapter.
 * Merges provider-resolved config with any existing architectureConfig (provider takes precedence).
 */
export function resolveProviderConfig(
  architecture: string,
  providerConfig: ProviderConfig,
  existingConfig?: Record<string, unknown>,
): Record<string, unknown> {
  const preset = resolveProvider(providerConfig.provider);
  if (!preset) {
    throw new Error(
      `Unknown provider: "${providerConfig.provider}". ` +
      `Available: ${listProviders().join(', ')}. ` +
      `Use registerProvider() to add custom providers.`,
    );
  }

  if (!preset.architectures.includes(architecture)) {
    throw new Error(
      `Provider "${providerConfig.provider}" does not support architecture "${architecture}". ` +
      `Supported: ${preset.architectures.join(', ')}`,
    );
  }

  const resolved = preset.resolve(architecture, providerConfig);
  return { ...existingConfig, ...resolved };
}

// Re-export provider presets for direct use
export { minimaxProvider } from './minimax.js';
export { ollamaProvider } from './ollama.js';
export { openrouterProvider } from './openrouter.js';
