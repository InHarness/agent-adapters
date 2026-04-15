// Claude Code adapter with a local Ollama backend
// Shows: claude-code-ollama architecture + ollama_baseUrl config
// Usage: npx tsx examples/claude-code/ollama-local.ts
// Requires: Ollama running locally (ollama serve) with a model pulled (e.g. ollama pull llama3.1)

import { createAdapter } from '../../src/index.js';

async function main() {
  const adapter = createAdapter('claude-code-ollama');

  console.log('Sending prompt to local Ollama instance...\n');

  try {
    for await (const event of adapter.execute({
      prompt: 'List three benefits of running AI models locally.',
      systemPrompt: 'Be concise.',
      model: 'llama3.1',
      maxTurns: 1,
      architectureConfig: {
        ollama_baseUrl: 'http://localhost:11434',
      },
    })) {
      switch (event.type) {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch')) {
      console.error('Could not connect to Ollama. Make sure it is running: ollama serve');
    } else {
      throw err;
    }
  }
}

main().catch(console.error);
