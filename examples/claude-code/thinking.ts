// Claude Code with extended thinking and effort control
// Shows: claude_thinking + claude_effort architectureConfig
// Usage: npx tsx examples/claude-code/thinking.ts
//        MODEL=sonnet-4.5 npx tsx examples/claude-code/thinking.ts
// Auth:  ANTHROPIC_API_KEY or SDK-managed OAuth
//
// Defaults to Opus 4.7. Set MODEL=opus-4.6 or MODEL=sonnet-4.5 to compare modes:
//   - Opus 4.6/4.7  → adapter forces `{ type: 'adaptive' }` (budget ignored, model decides when to think)
//   - Sonnet/Haiku  → `{ type: 'enabled', budgetTokens: 5000 }` (fixed budget, thinks every time)

import { createAdapter } from '../../src/index.js';

// Bear puzzle — the classic reasoning fixture, mirrors src/testing/e2e/shared.ts THINKING_PROMPT.
// Inlined because the testing barrel imports vitest, which fails when run via `tsx`.
const THINKING_PROMPT =
  'A traveler headed south. After walking 1 km he turned east and after 1 km he saw a bear ahead, so he turned north. After walking another 1 km he was back at the starting point. What color was the bear? Explain your reasoning.';
const THINKING_SYSTEM_PROMPT =
  'Think through your reasoning step by step before answering. This is a classic lateral thinking puzzle.';

const ADAPTIVE_MODELS = new Set(['fable-5', 'opus-4.6', 'opus-4.7', 'opus-4.8']);

async function main() {
  const model = process.env.MODEL || 'opus-4.7';
  const appliedMode = ADAPTIVE_MODELS.has(model) ? 'adaptive (budget ignored)' : 'enabled (5000-token budget)';

  console.log(`Model: ${model}`);
  console.log(`Mode applied: ${appliedMode}\n`);

  const adapter = createAdapter('claude-code');
  let thinkingBlocks = 0;

  for await (const event of adapter.execute({
    prompt: THINKING_PROMPT,
    systemPrompt: THINKING_SYSTEM_PROMPT,
    model,
    maxTurns: 1,
    // Adaptive is the only thinking mode Opus 4.6/4.7 accept; for Sonnet/Haiku the
    // adapter would still respect it (model decides when to think). claude_thinking_display
    // is set explicitly so we can verify it reaches the SDK on the wire below.
    architectureConfig: {
      claude_thinking: 'adaptive',
      claude_thinking_display: 'summarized',
      claude_effort: 'high',
    },
  })) {
    switch (event.type) {
      case 'thinking':
        thinkingBlocks++;
        console.log(`[Thinking] ${event.text.slice(0, 200)}${event.text.length > 200 ? '...' : ''}`);
        break;
      case 'text_delta':
        process.stdout.write(event.text);
        break;
      case 'result':
        console.log(`\n\nThinking blocks: ${thinkingBlocks}`);
        console.log(`Tokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`);
        break;
      case 'error':
        console.error('\nError:', event.error.message);
        break;
    }
  }
}

main().catch(console.error);
