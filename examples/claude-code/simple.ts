// Simple example: run a prompt through claude-code, stream text to terminal
// Usage: npx tsx examples/claude-code/simple.ts

import { createAdapter } from '../../src/index.js';

async function main() {
  const adapter = createAdapter('claude-code');

  console.log('Sending prompt to Claude Code...\n');

  for await (const event of adapter.execute({
    prompt: 'What is TypeScript? Answer in one sentence.',
    systemPrompt: 'Be concise.',
    model: 'sonnet-4.5',
    maxTurns: 1,
  })) {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.text);
        break;
      case 'thinking':
        // Optionally show thinking
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
