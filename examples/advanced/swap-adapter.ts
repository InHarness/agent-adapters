// Swap adapter example: same prompt, different architectures
// Usage: npx tsx examples/advanced/swap-adapter.ts [claude-code|codex|opencode|gemini]

import { createAdapter, extractText } from '../../src/index.js';
import type { Architecture } from '../../src/index.js';

const architecture = (process.argv[2] ?? 'claude-code') as Architecture;

// Use model aliases — each architecture resolves these to full model IDs
const models: Record<string, string> = {
  'claude-code': 'sonnet-4.5',
  'codex': 'o4-mini',
  'opencode-openrouter': 'claude-sonnet-4',
  'gemini': 'gemini-2.5-flash',
};

async function main() {
  console.log(`Using adapter: ${architecture}`);
  console.log(`Model: ${models[architecture] ?? 'unknown'}\n`);

  const adapter = createAdapter(architecture);

  const text = await extractText(
    adapter.execute({
      prompt: 'What are the three most important design patterns? List them briefly.',
      systemPrompt: 'Be concise. Answer in English.',
      model: models[architecture] ?? 'default',
      maxTurns: 1,
    }),
  );

  console.log(text);
}

main().catch(console.error);
