// Unit tests: claude-code image input through execute(). Mocks the SDK `query`
// the same pull-based way as the streaming-input suite, capturing the prompt and
// the first user message so we can assert the seed carries image content blocks
// AND that a one-shot-with-images call still yields exactly one result.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UnifiedEvent } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

let capturedPrompt: unknown = null;
let capturedFirstMessage: SDKUserMessage | null = null;
// Every user message pulled from the channel, in order — lets a push test
// inspect the SECOND message (the mid-turn push), not just the seed.
let capturedMessages: SDKUserMessage[] = [];

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
        for await (const userMsg of prompt as AsyncIterable<SDKUserMessage>) {
          if (capturedMessages.length === 0) capturedFirstMessage = userMsg;
          capturedMessages.push(userMsg);
          yield result();
        }
      })();
    },
  };
});

beforeEach(() => {
  capturedPrompt = null;
  capturedFirstMessage = null;
  capturedMessages = [];
});

function messageContent(msg: SDKUserMessage): unknown {
  return (msg as unknown as { message: { content: unknown } }).message.content;
}

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

  it('streaming pushMessage with a base64 image → second message carries image blocks, user_message echoes images', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const images = [{ type: 'base64' as const, mediaType: 'image/png', data: PNG_1PX_B64 }];

    const events: UnifiedEvent[] = [];
    let pushed = false;
    let accepted: boolean | null = null;
    for await (const ev of adapter.execute(
      createTestParams({ model: 'sonnet-4.6', prompt: 'first', streamingInput: true }),
    )) {
      events.push(ev);
      // Synchronous push in direct response to the result lands before the
      // end-of-turn close check — the atomicity the sync contract guarantees.
      if (ev.type === 'result' && !pushed) {
        pushed = true;
        accepted = adapter.pushMessage('look', images);
      }
    }

    expect(accepted).toBe(true);
    // Seed is the plain 'first' string; the push is the second channel message.
    expect(capturedMessages).toHaveLength(2);
    expect(messageContent(capturedMessages[1])).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX_B64 } },
    ]);

    const userMsg = events.find(
      (e): e is Extract<UnifiedEvent, { type: 'user_message' }> => e.type === 'user_message',
    );
    expect(userMsg?.text).toBe('look');
    expect(userMsg?.images).toEqual(images);
  });

  it('streaming pushMessage with a file image → read via readFileSync into a base64 block', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const dir = mkdtempSync(join(tmpdir(), 'aa-push-img-'));
    const file = join(dir, 'pic.png');
    writeFileSync(file, Buffer.from(PNG_1PX_B64, 'base64'));

    let pushed = false;
    let accepted: boolean | null = null;
    for await (const ev of adapter.execute(
      createTestParams({ model: 'sonnet-4.6', prompt: 'first', streamingInput: true }),
    )) {
      if (ev.type === 'result' && !pushed) {
        pushed = true;
        accepted = adapter.pushMessage('see file', [{ type: 'file', path: file }]);
      }
    }

    expect(accepted).toBe(true);
    expect(messageContent(capturedMessages[1])).toEqual([
      { type: 'text', text: 'see file' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX_B64 } },
    ]);
  });

  it('pushMessage with an invalid image mediaType throws synchronously (not a false return)', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();

    let threw = false;
    for await (const ev of adapter.execute(
      createTestParams({ model: 'sonnet-4.6', prompt: 'first', streamingInput: true }),
    )) {
      if (ev.type === 'result') {
        try {
          adapter.pushMessage('bad', [{ type: 'base64', mediaType: 'image/svg+xml', data: 'x' }]);
        } catch {
          threw = true;
        }
        break; // stop draining; execute()'s finally closes the channel
      }
    }
    expect(threw).toBe(true);
    // The throw happens before enqueue → nothing was delivered.
    expect(capturedMessages).toHaveLength(1);
  });
});
