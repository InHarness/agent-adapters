// Adapter-as-blackbox tests for opencode normalization.
// Mocks @opencode-ai/sdk + the v2 client. Drives OpencodeAdapter.execute()
// by feeding fixture SSE events; asserts normalization into NormalizedMessage
// blocks and message-id-change flush behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnifiedEvent } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { assertNormalization } from '../testing/normalization.js';
import {
  scenarioTextOnly,
  scenarioToolFlow,
  scenarioMultiMessage,
  scenarioThinking,
  scenarioToolError,
  scenarioWithUserEcho,
} from './__fixtures__/opencode-sse.js';

const FAKE_SESSION_ID = 'sess_test_1';
let currentEvents: ReadonlyArray<unknown> = [];

vi.mock('@opencode-ai/sdk', () => {
  const fakeClient = {
    session: {
      create: vi.fn(async () => ({ data: { id: FAKE_SESSION_ID } })),
      promptAsync: vi.fn(async () => undefined),
    },
    event: {
      subscribe: vi.fn(async () => ({
        stream: (async function* () {
          for (const e of currentEvents) yield e;
        })(),
      })),
    },
  };
  return {
    createOpencode: vi.fn(async () => ({
      client: fakeClient,
      server: { close: () => undefined },
    })),
  };
});

// v2 client is only initialized when params.onUserInput is provided. Our tests
// don't pass it, so this mock is defensive — never called in the tested paths.
vi.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: vi.fn(() => ({
    event: { subscribe: async () => ({ stream: (async function* () {})() }) },
    question: { reply: async () => undefined, reject: async () => undefined },
  })),
}));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY ??= 'test-key';
});

async function runOpencode(events: ReadonlyArray<unknown>): Promise<UnifiedEvent[]> {
  currentEvents = events;
  const { OpencodeAdapter } = await import('./opencode.js');
  const adapter = new OpencodeAdapter();
  return collectEvents(
    adapter.execute(createTestParams({ model: 'openrouter/anthropic/claude-sonnet-4' })),
  );
}

describe('opencode normalization (fixture replay)', () => {
  it('scenarioTextOnly: text part → assistant NormalizedMessage with single text block', async () => {
    const events = await runOpencode(scenarioTextOnly(FAKE_SESSION_ID));
    assertNormalization(events, {
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Hello world' }],
    });
    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result?.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
  });

  it('scenarioToolFlow: tool part (running→completed) → text + toolUse + toolResult bundled in one NormalizedMessage', async () => {
    const events = await runOpencode(scenarioToolFlow(FAKE_SESSION_ID));

    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result?.rawMessages).toHaveLength(1);
    expect(result?.rawMessages[0].content.map((b) => b.type)).toEqual([
      'text',
      'toolUse',
      'toolResult',
    ]);

    assertNormalization(events, {
      role: 'assistant',
      blocks: [
        { type: 'text' },
        { type: 'toolUse', toolName: 'echo' },
        { type: 'toolResult' },
      ],
    });
  });

  it('scenarioMultiMessage: change in messageID flushes currentBlocks → 2 separate NormalizedMessages', async () => {
    const events = await runOpencode(scenarioMultiMessage(FAKE_SESSION_ID));
    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result?.rawMessages).toHaveLength(2);
    expect(result?.rawMessages[0].content[0]).toMatchObject({ type: 'text', text: 'First message' });
    expect(result?.rawMessages[1].content[0]).toMatchObject({ type: 'text', text: 'Second message' });
  });

  it('scenarioThinking: reasoning part → thinking block + thinking event', async () => {
    const events = await runOpencode(scenarioThinking(FAKE_SESSION_ID));
    const thinkings = events.filter((e) => e.type === 'thinking');
    expect(thinkings.length).toBeGreaterThanOrEqual(1);
    assertNormalization(events, {
      role: 'assistant',
      blocks: [{ type: 'thinking' }, { type: 'text', text: 'OK' }],
    });
  });

  it('scenarioToolError: tool state.status=error → toolResult.isError=true + tool_result event with isError', async () => {
    const events = await runOpencode(scenarioToolError(FAKE_SESSION_ID));
    const toolResultEvent = events.find((e) => e.type === 'tool_result') as
      | Extract<UnifiedEvent, { type: 'tool_result' }>
      | undefined;
    expect(toolResultEvent?.isError).toBe(true);

    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    const errBlock = result?.rawMessages
      .flatMap((m) => m.content)
      .find((b) => b.type === 'toolResult') as { isError?: boolean } | undefined;
    expect(errBlock?.isError).toBe(true);
  });

  it('skips text_delta and rawMessages for user message parts (no prompt echo)', async () => {
    const events = await runOpencode(scenarioWithUserEcho(FAKE_SESSION_ID));

    const textDeltas = events.filter(
      (e): e is Extract<UnifiedEvent, { type: 'text_delta' }> => e.type === 'text_delta',
    );
    expect(textDeltas.map((e) => e.text)).not.toContain('PROMPT_ECHO');
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0].text).toBe('Hi');

    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result?.rawMessages).toHaveLength(1);
    expect(result?.rawMessages[0].role).toBe('assistant');
    expect(result?.output).toBe('Hi');
    expect(result?.output).not.toContain('PROMPT_ECHO');
    expect(result?.usage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  it('missing OPENROUTER_API_KEY yields {type:error, phase:init} instead of throwing', async () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const { OpencodeAdapter } = await import('./opencode.js');
      const adapter = new OpencodeAdapter();
      // Must not throw — the generator should yield an error event and return.
      const events = await collectEvents(
        adapter.execute(createTestParams({ model: 'openrouter/anthropic/claude-sonnet-4' })),
      );
      const errors = events.filter((e) => e.type === 'error') as Extract<UnifiedEvent, { type: 'error' }>[];
      expect(errors).toHaveLength(1);
      expect(errors[0].phase).toBe('init');
      expect(errors[0].error.message).toMatch(/Failed to initialize opencode adapter/);
      const cause = (errors[0].error as Error & { cause?: Error }).cause;
      expect(cause?.message).toMatch(/OPENROUTER_API_KEY/);
      expect(events.some((e) => e.type === 'adapter_ready')).toBe(false);
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
    }
  });
});
