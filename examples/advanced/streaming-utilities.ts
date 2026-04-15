// Streaming utility functions demo
// Shows: collectEvents, filterByType, takeUntilResult, splitBySubagent
// Usage: npx tsx examples/advanced/streaming-utilities.ts
// Auth: ANTHROPIC_API_KEY or SDK-managed OAuth

import {
  createAdapter,
  collectEvents,
  filterByType,
  takeUntilResult,
  splitBySubagent,
} from '../../src/index.js';
import type { RuntimeExecuteParams } from '../../src/index.js';

const baseParams: RuntimeExecuteParams = {
  prompt: 'What is 2 + 2? Answer in one word.',
  systemPrompt: 'Be concise.',
  model: 'claude-sonnet-4-20250514',
  maxTurns: 1,
};

async function main() {
  const adapter = createAdapter('claude-code');

  // --- 1. collectEvents: gather all events into an array ---
  console.log('=== collectEvents ===');
  const events = await collectEvents(adapter.execute(baseParams));
  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  console.log('Event counts:', typeCounts);

  // --- 2. filterByType: iterate only text_delta events ---
  console.log('\n=== filterByType("text_delta") ===');
  let text = '';
  for await (const delta of filterByType(adapter.execute(baseParams), 'text_delta')) {
    text += delta.text;
  }
  console.log('Extracted text:', text);

  // --- 3. takeUntilResult: stop after result event ---
  console.log('\n=== takeUntilResult ===');
  let count = 0;
  for await (const event of takeUntilResult(adapter.execute(baseParams))) {
    count++;
    if (event.type === 'result') {
      console.log(`Stopped after ${count} events (result received)`);
    }
  }

  // --- 4. splitBySubagent: separate main vs subagent events ---
  console.log('\n=== splitBySubagent ===');
  const { main, subagent } = await splitBySubagent(
    adapter.execute({
      ...baseParams,
      prompt: 'Read the file package.json and tell me the package name.',
      maxTurns: 3,
      cwd: process.cwd(),
    }),
  );
  console.log(`Main events: ${main.length}, Subagent events: ${subagent.length}`);
}

main().catch(console.error);
