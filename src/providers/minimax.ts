// MiniMax provider preset
// MiniMax exposes Anthropic-compatible and OpenAI-compatible endpoints,
// so it works as a backend for claude-code, opencode, and codex.
// Docs: https://platform.minimax.io/docs/token-plan/

import type { ProviderPreset, ProviderConfig } from '../types.js';

export const minimaxProvider: ProviderPreset = {
  name: 'minimax',
  architectures: ['claude-code', 'opencode', 'codex'],

  resolve(architecture: string, config: ProviderConfig): Record<string, unknown> {
    const region = (config.region as string) ?? 'global';
    const baseHost = region === 'cn' ? 'api.minimaxi.com' : 'api.minimax.io';
    const model = config.model ?? 'MiniMax-M2.7';

    switch (architecture) {
      case 'claude-code':
        return {
          custom_env: {
            ANTHROPIC_BASE_URL: `https://${baseHost}/anthropic`,
            ...(config.apiKey ? { ANTHROPIC_AUTH_TOKEN: config.apiKey } : {}),
            ANTHROPIC_MODEL: model,
            ANTHROPIC_SMALL_FAST_MODEL: model,
            ANTHROPIC_DEFAULT_SONNET_MODEL: model,
            ANTHROPIC_DEFAULT_OPUS_MODEL: model,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
            API_TIMEOUT_MS: '3000000',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
        };

      case 'opencode':
        return {
          opencode_providerID: 'anthropic',
          opencode_baseUrl: `https://${baseHost}/anthropic/v1`,
          ...(config.apiKey ? { opencode_apiKey: config.apiKey } : {}),
          opencode_model: `anthropic/${model}`,
        };

      case 'codex':
        return {
          codex_baseUrl: `https://${baseHost}/v1`,
          ...(config.apiKey ? { codex_apiKey: config.apiKey } : {}),
          codex_model: model,
        };

      default:
        throw new Error(
          `minimax provider does not support architecture "${architecture}". ` +
          `Supported: ${this.architectures.join(', ')}`,
        );
    }
  },
};
