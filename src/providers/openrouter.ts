// OpenRouter provider preset — multi-provider gateway for OpenCode
// OpenCode already defaults to openrouter, but this preset enables the
// 'opencode-openrouter' architecture alias and explicit provider configuration.

import type { ProviderPreset, ProviderConfig } from '../types.js';

export const openrouterProvider: ProviderPreset = {
  name: 'openrouter',
  architectures: ['opencode'],

  resolve(architecture: string, config: ProviderConfig): Record<string, unknown> {
    if (architecture !== 'opencode') {
      throw new Error(
        `openrouter provider does not support architecture "${architecture}". ` +
          `Supported: ${this.architectures.join(', ')}`,
      );
    }

    return {
      opencode_providerID: 'openrouter',
      ...(config.apiKey && { opencode_apiKey: config.apiKey }),
      ...(config.baseUrl && { opencode_baseUrl: config.baseUrl }),
    };
  },
};
