// Codex adapter with sandbox mode and reasoning effort
// Shows: codex_sandboxMode + codex_reasoningEffort architectureConfig, tool events
// Usage: npx tsx examples/codex/sandbox.ts
// Auth: OPENAI_API_KEY env var

import { createAdapter } from '../../src/index.js';

async function main() {
  const adapter = createAdapter('codex');

  console.log('Codex in read-only sandbox with high reasoning effort\n');

  for await (const event of adapter.execute({
    prompt: 'Read the package.json and summarize what this project does.',
    systemPrompt: 'Be concise.',
    model: 'o4-mini',
    maxTurns: 3,
    cwd: process.cwd(),
    architectureConfig: {
      codex_sandboxMode: 'read-only',
      codex_reasoningEffort: 'high',
    },
  })) {
    switch (event.type) {
      case 'tool_use':
        console.log(`[Tool] ${event.toolName} (${event.toolUseId})`);
        break;
      case 'tool_result':
        console.log(`[Result] ${event.summary.slice(0, 120)}${event.summary.length > 120 ? '...' : ''}`);
        break;
      case 'thinking':
        console.log(`[Reasoning] ${event.text.slice(0, 200)}${event.text.length > 200 ? '...' : ''}`);
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
