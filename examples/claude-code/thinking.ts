// Claude Code with extended thinking and effort control
// Shows: claude_thinking + claude_effort architectureConfig
// Usage: npx tsx examples/claude-code/thinking.ts
// Auth: ANTHROPIC_API_KEY or SDK-managed OAuth

import { createAdapter } from '../../src/index.js';

async function main() {
  const adapter = createAdapter('claude-code');

  console.log('Claude Code with extended thinking enabled\n');

  for await (const event of adapter.execute({
    prompt: 'What are the trade-offs between microservices and monolith architectures for a small startup?',
    systemPrompt: 'Think step by step. Be concise in your final answer.',
    model: 'claude-sonnet-4-20250514',
    maxTurns: 1,
    architectureConfig: {
      claude_thinking: { type: 'enabled', budgetTokens: 5000 },
      claude_effort: 'high',
    },
  })) {
    switch (event.type) {
      case 'thinking':
        console.log(`[Thinking] ${event.text.slice(0, 200)}${event.text.length > 200 ? '...' : ''}`);
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
