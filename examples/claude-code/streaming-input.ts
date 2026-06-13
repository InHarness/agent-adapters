// Streaming-input example: keep the session open and push a follow-up message
// mid-turn via pushMessage(). The adapter feeds the SDK an open input channel
// (seeded with the prompt); a push injected while the turn is live is delivered
// to the same session, and execute() yields a second `result` for it.
//
// Usage: npx tsx examples/claude-code/streaming-input.ts

import { createAdapter, architectureCapabilities } from '../../src/index.js';

async function main() {
  if (!architectureCapabilities('claude-code').midTurnPush) {
    console.error('claude-code does not report midTurnPush support');
    return;
  }

  const adapter = createAdapter('claude-code');
  let pushed = false;

  console.log('Starting streaming-input session...\n');

  for await (const event of adapter.execute({
    prompt: 'Use the Bash tool to run `echo first`, then briefly say what you did.',
    systemPrompt: 'Use the Bash tool when asked. Keep responses short.',
    model: 'sonnet-4.6',
    streamingInput: true, // <-- opt into mid-turn injection
  })) {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.text);
        break;
      case 'tool_use':
        console.log(`\n[tool_use] ${event.toolName}`);
        // The moment the model makes its first tool call, inject a follow-up
        // into the live session.
        if (!pushed) {
          pushed = true;
          const accepted = adapter.pushMessage?.('Now also run `echo second`.') ?? false;
          console.log(`[pushMessage] accepted=${accepted}`);
        }
        break;
      case 'user_message':
        console.log(`\n[user_message @ ${event.timestamp}] ${event.text}`);
        break;
      case 'result':
        console.log(
          `\n[result] ${event.usage.inputTokens} in / ${event.usage.outputTokens} out` +
            ` | contextSize=${event.contextSize}`,
        );
        break;
      case 'error':
        console.error('\n[error]', event.error.message);
        break;
    }
  }

  // After the stream ends the channel is closed — a late push is rejected.
  console.log(`\nlate pushMessage accepted=${adapter.pushMessage?.('too late') ?? false}`);
}

main().catch(console.error);
