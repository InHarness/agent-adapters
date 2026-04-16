// Ollama provider preset — local inference backend for Claude Code
// Migrated from the inline claude-code-ollama logic in factory.ts

import type { ProviderPreset, ProviderConfig } from '../types.js';

export const ollamaProvider: ProviderPreset = {
  name: 'ollama',
  architectures: ['claude-code'],

  resolve(architecture: string, config: ProviderConfig): Record<string, unknown> {
    if (architecture !== 'claude-code') {
      throw new Error(
        `ollama provider does not support architecture "${architecture}". ` +
        `Supported: ${this.architectures.join(', ')}`,
      );
    }

    return {
      custom_env: {
        ANTHROPIC_BASE_URL: config.baseUrl ?? 'http://localhost:11434',
      },
    };
  },
};
