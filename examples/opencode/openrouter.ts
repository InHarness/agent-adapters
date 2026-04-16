// OpenCode adapter via OpenRouter with temperature and topP tuning
// Shows: opencode_temperature + opencode_topP architectureConfig, isOpencodeAvailable guard
// Usage: npx tsx examples/opencode/openrouter.ts
// Auth: OPENROUTER_API_KEY env var
// Requires: opencode CLI in PATH (npm i -g opencode)

import { createAdapter, extractText, isOpencodeAvailable } from '../../src/index.js';

async function main() {
  if (!isOpencodeAvailable()) {
    console.error('opencode CLI not found in PATH. Install it: npm i -g opencode');
    process.exit(1);
  }

  const adapter = createAdapter('opencode-openrouter');

  console.log('OpenCode via OpenRouter with creative temperature\n');

  const text = await extractText(
    adapter.execute({
      prompt: 'Write a haiku about TypeScript.',
      systemPrompt: 'Be creative.',
      model: 'claude-sonnet-4', // alias → 'anthropic/claude-sonnet-4'
      maxTurns: 1,
      architectureConfig: {
        opencode_temperature: 0.7,
        opencode_topP: 0.9,
      },
    }),
  );

  console.log(text);
}

main().catch(console.error);
