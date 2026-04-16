// Timeout and manual abort demo
// Shows: timeoutMs param + adapter.abort() method
// Usage: npx tsx examples/advanced/timeout-and-abort.ts
// Auth: ANTHROPIC_API_KEY or SDK-managed OAuth

import { createAdapter } from '../../src/index.js';

async function demoTimeout() {
  console.log('=== Timeout (5s) ===\n');

  const adapter = createAdapter('claude-code');

  try {
    for await (const event of adapter.execute({
      prompt: 'Write a very detailed essay about the entire history of computing from 1800 to today.',
      systemPrompt: 'Be extremely thorough and detailed.',
      model: 'sonnet-4.5',
      maxTurns: 1,
      timeoutMs: 5000,
    })) {
      if (event.type === 'text_delta') {
        process.stdout.write(event.text);
      } else if (event.type === 'error') {
        console.log(`\n[Timeout] ${event.error.message}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n[Caught] ${msg}`);
  }
}

async function demoAbort() {
  console.log('\n\n=== Manual abort (3s) ===\n');

  const adapter = createAdapter('claude-code');

  // Abort after 3 seconds
  const timer = setTimeout(() => {
    console.log('\n[Aborting...]');
    adapter.abort();
  }, 3000);

  try {
    for await (const event of adapter.execute({
      prompt: 'Explain quantum computing in great detail, covering all major algorithms.',
      systemPrompt: 'Be extremely thorough.',
      model: 'sonnet-4.5',
      maxTurns: 1,
    })) {
      if (event.type === 'text_delta') {
        process.stdout.write(event.text);
      } else if (event.type === 'error') {
        console.log(`\n[Aborted] ${event.error.message}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n[Caught] ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  await demoTimeout();
  await demoAbort();
}

main().catch(console.error);
