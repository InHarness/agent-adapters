// Unit tests: claude-code result-message error handling through execute().
// Mocks the SDK `query` the same pull-based way as the image/streaming suites,
// yielding synthetic `result` messages so we can assert that a failed turn
// surfaces as a `type:'error'` event (not a `result`) and that the message is
// built from the right field. Covers two failure shapes:
//   1. subtype:'success' + is_error:true (the API-500 case — the SDK still
//      emits a final result but flags it as an error; text in `result`).
//   2. a real error subtype (error_during_execution) carrying `errors[]`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UnifiedEvent } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

// The next `result` message the mocked query() will yield.
let nextResult: () => SDKMessage = () =>
  ({ type: 'result', subtype: 'success', result: 'ok', session_id: 's' }) as unknown as SDKMessage;
let capturedMessages: SDKUserMessage[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: ({ prompt }: { prompt: unknown }) => {
      if (typeof prompt === 'string') {
        return (async function* () {
          yield nextResult();
        })();
      }
      return (async function* () {
        for await (const userMsg of prompt as AsyncIterable<SDKUserMessage>) {
          capturedMessages.push(userMsg);
          yield nextResult();
        }
      })();
    },
  };
});

beforeEach(() => {
  capturedMessages = [];
  nextResult = () =>
    ({ type: 'result', subtype: 'success', result: 'ok', session_id: 's' }) as unknown as SDKMessage;
});

async function importAdapter() {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return ClaudeCodeAdapter;
}

function errorEvent(events: UnifiedEvent[]) {
  return events.find((e): e is Extract<UnifiedEvent, { type: 'error' }> => e.type === 'error');
}

describe('claude-code result error handling', () => {
  it("subtype:'success' + is_error:true → error event with message + status, no result", async () => {
    nextResult = () =>
      ({
        type: 'result',
        subtype: 'success',
        is_error: true,
        api_error_status: 500,
        result: 'API Error: 500 Internal server error',
        usage: { input_tokens: 0, output_tokens: 0 },
        session_id: 's',
      }) as unknown as SDKMessage;

    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6' })));

    expect(events.filter((e) => e.type === 'result')).toHaveLength(0);
    const err = errorEvent(events);
    expect(err).toBeDefined();
    expect(err?.phase).toBe('runtime');
    expect(err?.error.message).toContain('500');
    expect(err?.error.message).toContain('Internal server error');
  });

  it("error subtype → message from errors[], not 'Unknown error'", async () => {
    nextResult = () =>
      ({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['boom'],
        usage: { input_tokens: 0, output_tokens: 0 },
        session_id: 's',
      }) as unknown as SDKMessage;

    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6' })));

    expect(events.filter((e) => e.type === 'result')).toHaveLength(0);
    expect(errorEvent(events)?.error.message).toBe('boom');
  });

  it('clean success still yields a result, no error (regression guard)', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6' })));

    expect(events.filter((e) => e.type === 'result')).toHaveLength(1);
    expect(errorEvent(events)).toBeUndefined();
  });

  it('streaming-input: is_error result closes the channel even with a queued push', async () => {
    nextResult = () =>
      ({
        type: 'result',
        subtype: 'success',
        is_error: true,
        api_error_status: 500,
        result: 'API Error: 500 Internal server error',
        session_id: 's',
      }) as unknown as SDKMessage;

    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();

    let accepted: boolean | null = null;
    const events: UnifiedEvent[] = [];
    for await (const ev of adapter.execute(
      createTestParams({ model: 'sonnet-4.6', prompt: 'first', streamingInput: true }),
    )) {
      events.push(ev);
      // Push synchronously in response to the (error) result. Because the turn
      // failed, the end-of-turn policy must close the channel rather than run
      // the queued message — so this push is rejected and no 2nd turn happens.
      if (ev.type === 'error') {
        accepted = adapter.pushMessage('next');
      }
    }

    expect(errorEvent(events)).toBeDefined();
    expect(accepted).toBe(false); // channel closed on error → push rejected
    expect(capturedMessages).toHaveLength(1); // only the seed ran; no queued turn
  });
});
