// Unit tests: claude-code image input through execute(). Mocks the SDK `query`
// the same pull-based way as the streaming-input suite, capturing the prompt and
// the first user message so we can assert the seed carries image content blocks
// AND that a one-shot-with-images call still yields exactly one result.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

let capturedPrompt: unknown = null;
let capturedFirstMessage: SDKUserMessage | null = null;

function result(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: 'ok',
    usage: { input_tokens: 10, output_tokens: 5 },
    session_id: 'sess-img-1',
  } as unknown as SDKMessage;
}

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: ({ prompt }: { prompt: unknown }) => {
      capturedPrompt = prompt;
      if (typeof prompt === 'string') {
        return (async function* () {
          yield result();
        })();
      }
      return (async function* () {
        let first = true;
        for await (const userMsg of prompt as AsyncIterable<SDKUserMessage>) {
          if (first) {
            capturedFirstMessage = userMsg;
            first = false;
          }
          yield result();
        }
      })();
    },
  };
});

beforeEach(() => {
  capturedPrompt = null;
  capturedFirstMessage = null;
});

async function importAdapter() {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return ClaudeCodeAdapter;
}

const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('claude-code image input', () => {
  it('no images → plain string prompt (unchanged one-shot path)', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6' })));
    expect(typeof capturedPrompt).toBe('string');
    expect(events.filter((e) => e.type === 'result')).toHaveLength(1);
  });

  it('one-shot with images → channel seed+close, exactly one result, no pushMessage', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(
      adapter.execute(
        createTestParams({
          model: 'sonnet-4.6',
          prompt: 'describe this',
          images: [{ type: 'base64', mediaType: 'image/png', data: PNG_1PX_B64 }],
        }),
      ),
    );

    // Routed through the AsyncIterable channel, not a plain string.
    expect(typeof capturedPrompt).toBe('object');
    expect(typeof (capturedPrompt as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe('function');

    // One-shot contract preserved: a single result, no mid-turn user_message.
    expect(events.filter((e) => e.type === 'result')).toHaveLength(1);
    expect(events.some((e) => e.type === 'user_message')).toBe(false);
    // Channel was closed → late push rejected.
    expect(adapter.pushMessage('late')).toBe(false);

    // The seed message content is [text, image-block].
    const content = (capturedFirstMessage as unknown as { message: { content: unknown } }).message.content;
    expect(content).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX_B64 } },
    ]);
  });

  it('invalid image mediaType → error event, no result', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(
      adapter.execute(
        createTestParams({
          model: 'sonnet-4.6',
          images: [{ type: 'base64', mediaType: 'image/svg+xml', data: 'x' }],
        }),
      ),
    );
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.filter((e) => e.type === 'result')).toHaveLength(0);
  });
});
