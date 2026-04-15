// Session resumption: store a sessionId and resume a conversation
// Shows: result.sessionId capture + resumeSessionId param
// Usage: npx tsx examples/advanced/session-resumption.ts
// Auth: ANTHROPIC_API_KEY or SDK-managed OAuth
// Note: session resumption is supported by claude-code and codex adapters

import { createAdapter, extractText } from '../../src/index.js';

async function main() {
  const adapter = createAdapter('claude-code');

  // --- First call: establish context ---
  console.log('Session 1: Storing context...\n');

  let sessionId: string | undefined;

  for await (const event of adapter.execute({
    prompt: 'Remember this: the secret word is "pineapple". Confirm you understood.',
    systemPrompt: 'Be concise.',
    model: 'claude-sonnet-4-20250514',
    maxTurns: 1,
  })) {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.text);
        break;
      case 'result':
        sessionId = event.sessionId;
        console.log(`\n\nSession ID: ${sessionId ?? 'none'}`);
        break;
    }
  }

  if (!sessionId) {
    console.log('\nNo sessionId returned — session resumption not available.');
    return;
  }

  // --- Second call: resume and recall ---
  console.log('\n---\nSession 2: Resuming and recalling...\n');

  const text = await extractText(
    adapter.execute({
      prompt: 'What is the secret word I told you?',
      systemPrompt: 'Be concise.',
      model: 'claude-sonnet-4-20250514',
      maxTurns: 1,
      resumeSessionId: sessionId,
    }),
  );

  console.log(text);
}

main().catch(console.error);
