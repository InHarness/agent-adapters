// Observer pattern example: attach multiple observers to a stream
// Usage: npx tsx examples/advanced/observer-pattern.ts

import { createAdapter, observeStream, createConsoleObserver } from '../../src/index.js';
import type { StreamObserver } from '../../src/index.js';

// Observer 1: built-in console observer (prints text/tool/result/done/error)
const consoleObserver = createConsoleObserver();

// Observer 2: Metrics collector
const metrics = { events: 0, tools: 0, tokens: { input: 0, output: 0 } };
const metricsObserver: StreamObserver = {
  onTextDelta() { metrics.events++; },
  onToolUse() { metrics.events++; metrics.tools++; },
  onResult(_o, _m, usage) {
    metrics.tokens = { input: usage.inputTokens, output: usage.outputTokens };
  },
};

async function main() {
  const adapter = createAdapter('claude-code');

  const stream = adapter.execute({
    prompt: 'Read package.json and tell me the package name.',
    systemPrompt: 'Be concise.',
    model: 'sonnet-4.5',
    maxTurns: 3,
    cwd: process.cwd(),
  });

  for await (const _event of observeStream(stream, [consoleObserver, metricsObserver])) {
    // Events are dispatched to observers AND available here
  }

  console.log('\nMetrics:', metrics);
}

main().catch(console.error);
