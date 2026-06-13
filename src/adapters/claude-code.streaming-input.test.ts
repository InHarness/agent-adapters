// Unit tests: claude-code streaming-input mode (mid-turn pushMessage).
//
// Mocks @anthropic-ai/claude-agent-sdk's `query` with a pull-based fake that
// emits one turn per input message — faithfully mirroring the real SDK's
// streaming-input semantics (the SDK only pulls the next user message at a
// turn boundary). This lets us exercise: prompt shape (string vs AsyncIterable),
// user_message emission, multi-result keep-open, and pushMessage lifecycle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UnifiedEvent } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { architectureCapabilities } from '../capabilities.js';

// What the most recent fake `query()` call received as its `prompt`.
let capturedPrompt: unknown = null;

function turnResult(turn: number): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: `turn ${turn}`,
    usage: { input_tokens: 10, output_tokens: 5 },
    session_id: 'sess-stream-1',
  } as unknown as SDKMessage;
}

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: ({ prompt }: { prompt: unknown }) => {
      capturedPrompt = prompt;
      if (typeof prompt === 'string') {
        // One-shot mode: a single scripted turn, then the stream ends.
        return (async function* () {
          yield turnResult(0);
        })();
      }
      // Streaming-input mode: emit exactly one turn per input message pulled
      // from the channel. When the adapter closes the channel, the for-await
      // ends and the generator returns — exactly like the real SDK.
      return (async function* () {
        let i = 0;
        for await (const _userMsg of prompt as AsyncIterable<SDKUserMessage>) {
          void _userMsg;
          yield turnResult(i);
          i++;
        }
      })();
    },
  };
});

beforeEach(() => {
  capturedPrompt = null;
});

async function importAdapter() {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return ClaudeCodeAdapter;
}

describe('claude-code streaming-input mode', () => {
  it('one-shot regression: string prompt, single result, no channel', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(
      adapter.execute(createTestParams({ model: 'sonnet-4.6' })),
    );

    expect(typeof capturedPrompt).toBe('string');
    const results = events.filter((e) => e.type === 'result');
    expect(results).toHaveLength(1);
    expect(events.some((e) => e.type === 'user_message')).toBe(false);
    // pushMessage is a no-op when not in streaming mode.
    expect(adapter.pushMessage('nope')).toBe(false);
  });

  it('streamingInput: true → query receives an AsyncIterable prompt', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    // Drain a single turn (no push) so execute() completes.
    await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6', streamingInput: true })));

    expect(typeof capturedPrompt).toBe('object');
    expect(
      typeof (capturedPrompt as AsyncIterable<unknown>)[Symbol.asyncIterator],
    ).toBe('function');
  });

  it('pushMessage mid-stream → emits user_message and a second result turn', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();

    const events: UnifiedEvent[] = [];
    let pushed = false;
    let pushAccepted: boolean | null = null;

    for await (const ev of adapter.execute(
      createTestParams({ model: 'sonnet-4.6', streamingInput: true }),
    )) {
      events.push(ev);
      // After the first turn's result, inject a follow-up exactly once.
      if (ev.type === 'result' && !pushed) {
        pushed = true;
        pushAccepted = adapter.pushMessage('second message');
      }
    }

    expect(pushAccepted).toBe(true);

    const results = events.filter((e) => e.type === 'result');
    expect(results).toHaveLength(2); // turn 0 + turn 1 (the pushed message)

    const userMessages = events.filter(
      (e): e is Extract<UnifiedEvent, { type: 'user_message' }> => e.type === 'user_message',
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].text).toBe('second message');
    expect(typeof userMessages[0].timestamp).toBe('number');

    // Ordering: user_message sits between the two results.
    const idxFirstResult = events.findIndex((e) => e.type === 'result');
    const idxUserMsg = events.findIndex((e) => e.type === 'user_message');
    const idxSecondResult = events.findIndex((e, i) => e.type === 'result' && i > idxFirstResult);
    expect(idxFirstResult).toBeLessThan(idxUserMsg);
    expect(idxUserMsg).toBeLessThan(idxSecondResult);
  });

  it('pushMessage after the stream ends returns false (channel closed)', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6', streamingInput: true })));
    // Channel closed in finally → late push is rejected, caller re-dispatches.
    expect(adapter.pushMessage('too late')).toBe(false);
  });
});

describe('architectureCapabilities', () => {
  it('claude-code variants support midTurnPush', () => {
    expect(architectureCapabilities('claude-code').midTurnPush).toBe(true);
    expect(architectureCapabilities('claude-code-ollama').midTurnPush).toBe(true);
    expect(architectureCapabilities('claude-code-minimax').midTurnPush).toBe(true);
  });

  it('other architectures do not support midTurnPush', () => {
    expect(architectureCapabilities('codex').midTurnPush).toBe(false);
    expect(architectureCapabilities('gemini').midTurnPush).toBe(false);
    expect(architectureCapabilities('opencode').midTurnPush).toBe(false);
    expect(architectureCapabilities('opencode-openrouter').midTurnPush).toBe(false);
  });

  it('unknown/custom architectures default to false', () => {
    expect(architectureCapabilities('totally-made-up').midTurnPush).toBe(false);
  });
});
