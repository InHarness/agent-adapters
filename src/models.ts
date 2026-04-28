// Model aliases — simplified model names per architecture
// Provides compile-time autocomplete and runtime resolution/validation

import type { Architecture } from './types.js';

// --- Alias catalog ---

/** Map of simplified model aliases to full model IDs, per architecture. */
export const MODEL_ALIASES = {
  'claude-code': {
    'sonnet-4.6': 'claude-sonnet-4-6',
    'sonnet-4.5': 'claude-sonnet-4-5-20250929',
    'opus-4.7': 'claude-opus-4-7',
    'opus-4.6': 'claude-opus-4-6',
    'opus-4.5': 'claude-opus-4-5-20251101',
    'haiku-4.5': 'claude-haiku-4-5-20251001',
  },
  'claude-code-ollama': {
    'qwen-coder-32b': 'qwen2.5-coder:32b',
    'deepseek-coder': 'deepseek-coder-v2:latest',
    'codellama-70b': 'codellama:70b',
    'llama-3.1-70b': 'llama3.1:70b',
  },
  'claude-code-minimax': {
    'minimax-m2.7': 'MiniMax-M2.7',
  },
  codex: {
    'gpt-5.5': 'gpt-5.5',
    'gpt-5.5-codex': 'gpt-5.5-codex',
    'gpt-5.5-mini': 'gpt-5.5-mini',
    'gpt-5.4': 'gpt-5.4',
    'gpt-5.4-codex': 'gpt-5.4-codex',
    'gpt-5.4-mini': 'gpt-5.4-mini',
    'gpt-5': 'gpt-5',
    'gpt-5-codex': 'gpt-5-codex',
    'gpt-5-mini': 'gpt-5-mini',
  },
  'opencode-openrouter': {
    // Sorted by popularity (most-used first). Top entries match the
    // OpenRouter "Popular models" leaderboard at the time of writing.
    'kimi-k2.6': 'moonshotai/kimi-k2.6',
    'step-3.5-flash': 'stepfun/step-3.5-flash',
    'ling-2.6-1t-free': 'inclusionai/ling-2.6-1t:free',
    'minimax-m2.7': 'minimax/minimax-m2.7',
    'claude-sonnet-4.6': 'anthropic/claude-sonnet-4.6',
    'hy3-preview-free': 'tencent/hy3-preview:free',
    'gemini-2.5-flash': 'google/gemini-2.5-flash',
    'nemotron-3-super-free': 'nvidia/nemotron-3-super:free',
    'claude-opus-4.7': 'anthropic/claude-opus-4.7',
    // Existing aliases retained for backwards compatibility.
    'claude-sonnet-4': 'anthropic/claude-sonnet-4',
    'claude-opus-4': 'anthropic/claude-opus-4',
    'gemini-2.5-pro': 'google/gemini-2.5-pro',
    'deepseek-r1': 'deepseek/deepseek-r1',
  },
  gemini: {
    'gemini-3.1-pro': 'gemini-3.1-pro-preview',
    'gemini-3.1-flash': 'gemini-3-flash-preview',
    'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
    'gemini-2.0-flash': 'gemini-2.0-flash',
  },
} as const satisfies Record<string, Record<string, string>>;

/** Architectures that have model aliases defined. */
export type ArchitectureWithModels = keyof typeof MODEL_ALIASES;

// --- Per-architecture model types ---

/** Model aliases for the claude-code architecture. */
export type ClaudeCodeModel = keyof typeof MODEL_ALIASES['claude-code'] | (string & {});
/** Model aliases for the claude-code-ollama architecture. */
export type ClaudeCodeOllamaModel = keyof typeof MODEL_ALIASES['claude-code-ollama'] | (string & {});
/** Model aliases for the claude-code-minimax architecture. */
export type ClaudeCodeMinimaxModel = keyof typeof MODEL_ALIASES['claude-code-minimax'] | (string & {});
/** Model aliases for the codex architecture. */
export type CodexModel = keyof typeof MODEL_ALIASES['codex'] | (string & {});
/** Model aliases for the opencode-openrouter architecture. */
export type OpencodeOpenrouterModel = keyof typeof MODEL_ALIASES['opencode-openrouter'] | (string & {});
/** Model aliases for the gemini architecture. */
export type GeminiModel = keyof typeof MODEL_ALIASES['gemini'] | (string & {});

/** Maps each architecture to its model alias type. */
export interface ArchitectureModelMap {
  'claude-code': ClaudeCodeModel;
  'claude-code-ollama': ClaudeCodeOllamaModel;
  'claude-code-minimax': ClaudeCodeMinimaxModel;
  codex: CodexModel;
  'opencode-openrouter': OpencodeOpenrouterModel;
  gemini: GeminiModel;
}

// --- Model capabilities ---

/** Full model IDs that only support adaptive thinking (not fixed-budget `enabled`). */
export const ADAPTIVE_THINKING_ONLY: ReadonlySet<string> = new Set([
  'claude-opus-4-7',
]);

// --- Context window sizes ---

/**
 * Maximum input context window per model alias, in tokens.
 * Only aliases known at publish time are listed. For pass-through full IDs,
 * reverse-lookup via MODEL_ALIASES is attempted. Runtime-configurable windows
 * (Ollama num_ctx, custom providers) should be supplied by the consumer.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, Record<string, number>> = {
  'claude-code': {
    'sonnet-4.6': 200_000,
    'sonnet-4.5': 200_000,
    'opus-4.7': 200_000,
    'opus-4.6': 200_000,
    'opus-4.5': 200_000,
    'haiku-4.5': 200_000,
  },
  codex: {
    'gpt-5.5': 400_000,
    'gpt-5.5-codex': 400_000,
    'gpt-5.5-mini': 400_000,
    'gpt-5.4': 400_000,
    'gpt-5.4-codex': 400_000,
    'gpt-5.4-mini': 400_000,
    'gpt-5': 400_000,
    'gpt-5-codex': 400_000,
    'gpt-5-mini': 400_000,
  },
  gemini: {
    'gemini-3.1-pro': 1_048_576,
    'gemini-3.1-flash': 1_048_576,
    'gemini-3.1-flash-lite': 1_048_576,
    'gemini-2.5-pro': 2_097_152,
    'gemini-2.5-flash': 1_048_576,
    'gemini-2.5-flash-lite': 1_048_576,
    'gemini-2.0-flash': 1_048_576,
  },
  'opencode-openrouter': {
    'kimi-k2.6': 200_000,
    'claude-sonnet-4.6': 200_000,
    'gemini-2.5-flash': 1_048_576,
    'claude-opus-4.7': 200_000,
    'claude-sonnet-4': 200_000,
    'claude-opus-4': 200_000,
    'gemini-2.5-pro': 2_097_152,
    'deepseek-r1': 64_000,
    // step-3.5-flash, ling-2.6-1t-free, minimax-m2.7, hy3-preview-free,
    // nemotron-3-super-free: context windows unknown, intentionally omitted.
  },
  // claude-code-ollama, claude-code-minimax: intentionally empty
  // (depends on local/provider configuration, not on model name alone)
};

/**
 * Resolve the context window size (tokens) for a given architecture + model.
 * Accepts either an alias or the full model ID.
 * Returns undefined when unknown (custom adapters, pass-through IDs not in MODEL_ALIASES).
 */
export function getModelContextWindow(architecture: Architecture, model: string): number | undefined {
  const forArch = MODEL_CONTEXT_WINDOWS[architecture];
  if (!forArch) return undefined;
  if (model in forArch) return forArch[model];

  const aliases = (MODEL_ALIASES as Record<string, Record<string, string>>)[architecture];
  if (aliases) {
    const alias = Object.entries(aliases).find(([, fullId]) => fullId === model)?.[0];
    if (alias && alias in forArch) return forArch[alias];
  }
  return undefined;
}

// --- Runtime resolution ---

/**
 * Resolve a model alias to its full model ID for the given architecture.
 *
 * - Known alias → resolved to full ID
 * - Known full ID → pass-through
 * - Unknown string → pass-through with a console.warn (the SDK validates)
 * - Architecture without aliases (custom) → pass-through
 *
 * @example
 * ```ts
 * resolveModel('claude-code', 'sonnet-4.7')
 * // → 'claude-sonnet-4-7-20250219'
 *
 * resolveModel('claude-code', 'claude-sonnet-4-7-20250219')
 * // → 'claude-sonnet-4-7-20250219' (pass-through)
 *
 * resolveModel('claude-code', 'glm-5.1')
 * // → 'glm-5.1' (pass-through; warns)
 * ```
 *
 * Pass-through enables UIs to send a custom model ID (e.g. an OpenRouter
 * `provider/name` not yet listed in MODEL_ALIASES). The underlying SDK is
 * the source of truth for what's actually accepted.
 */
export function resolveModel(architecture: Architecture, model: string): string {
  const aliases = (MODEL_ALIASES as Record<string, Record<string, string>>)[architecture];
  if (!aliases) return model;

  if (model in aliases) {
    return aliases[model];
  }

  const knownFullIds = Object.values(aliases);
  if (knownFullIds.includes(model)) {
    return model;
  }

  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    const available = Object.keys(aliases).join(', ');
    console.warn(
      `[agent-adapters] Unknown model "${model}" for architecture "${architecture}" — ` +
        `passing through to the SDK. Known aliases: ${available}.`,
    );
  }
  return model;
}

/**
 * Get available model aliases for an architecture.
 * Returns undefined for architectures without aliases (custom adapters).
 */
export function getModelsForArchitecture(
  architecture: Architecture,
): { alias: string; fullId: string }[] | undefined {
  const aliases = (MODEL_ALIASES as Record<string, Record<string, string>>)[architecture];
  if (!aliases) return undefined;
  return Object.entries(aliases).map(([alias, fullId]) => ({ alias, fullId }));
}
