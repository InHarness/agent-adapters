import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/claude-code': 'src/adapters/claude-code.ts',
    'adapters/codex': 'src/adapters/codex.ts',
    'adapters/opencode': 'src/adapters/opencode.ts',
    'adapters/gemini': 'src/adapters/gemini.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  outDir: 'dist',
  external: [
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex-sdk',
    '@opencode-ai/sdk',
    '@google/gemini-cli-core',
  ],
});
