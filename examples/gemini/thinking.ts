// Gemini adapter with thinking budget and generation parameters
// Shows: gemini_thinkingBudget + gemini_temperature + gemini_topP + gemini_topK
// Usage: npx tsx examples/gemini/thinking.ts
// Auth: GOOGLE_API_KEY or GEMINI_API_KEY env var
// Note: Gemini adapter is EXPERIMENTAL — requires @google/gemini-cli-core infrastructure

import { createAdapter } from '../../src/index.js';

async function main() {
  const adapter = createAdapter('gemini');

  console.log('Gemini with thinking budget (experimental)\n');

  for await (const event of adapter.execute({
    prompt: 'Explain how garbage collection works in JavaScript, step by step.',
    systemPrompt: 'Think through the problem carefully, then give a clear explanation.',
    model: 'gemini-2.5-flash',
    maxTurns: 1,
    architectureConfig: {
      gemini_thinkingBudget: 4096,
      gemini_temperature: 0.5,
      gemini_topP: 0.95,
      gemini_topK: 40,
    },
  })) {
    switch (event.type) {
      case 'thinking':
        console.log(`[Thought] ${event.text.slice(0, 200)}${event.text.length > 200 ? '...' : ''}`);
        break;
      case 'text_delta':
        process.stdout.write(event.text);
        break;
      case 'result':
        console.log(`\n\nTokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`);
        break;
      case 'error':
        console.error('\nError:', event.error.message);
        break;
    }
  }
}

main().catch(console.error);
