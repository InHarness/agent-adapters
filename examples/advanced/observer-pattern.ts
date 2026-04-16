// Observer pattern example: attach multiple observers to a stream
// Usage: npx tsx examples/advanced/observer-pattern.ts

import { createAdapter, observeStream, dispatchEvent } from '../../src/index.js';
import type { StreamObserver } from '../../src/index.js';

// Observer 1: Live text output
const consoleObserver: StreamObserver = {
  onTextDelta(text) {
    process.stdout.write(text);
  },
  onToolUse(name, id) {
    console.log(`\n[Tool] ${name} (${id})`);
  },
  onToolResult(id, summary) {
    console.log(`[Result] ${summary.slice(0, 100)}`);
  },
  onThinking(text) {
    // Could show thinking indicator
  },
  onResult(_output, _msgs, usage) {
    console.log(`\n\n[Done] ${usage.inputTokens} in / ${usage.outputTokens} out`);
  },
  onError(error) {
    console.error(`\n[Error] ${error.message}`);
  },
};

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

  // Method 1: observeStream (passthrough — dispatch + yield)
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
