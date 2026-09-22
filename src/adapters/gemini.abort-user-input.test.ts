// M13 on gemini: abort() / timeoutMs while the consumer's onUserInput handler is
// still pending must terminate the run and answer the ask_user confirmation
// `cancel`. Mirrors the claude-code regression test in
// claude-code.background-tasks.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterAbortError, AdapterTimeoutError } from '../types.js';
import type { UnifiedEvent } from '../types.js';
import { createTestParams } from '../testing/helpers.js';

/** Whether the scripted session raises an ask_user confirmation before going quiet. */
let askQuestion = true;
const publish = vi.fn(async (_msg: Record<string, unknown>) => {});
let lastBus: { fire(type: string, msg: Record<string, unknown>): void } | null = null;

vi.mock('@google/gemini-cli-core', () => {
  class Bus {
    private listeners = new Map<string, Array<(msg: Record<string, unknown>) => void>>();
    subscribe(type: string, listener: (msg: Record<string, unknown>) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    publish = publish;
    fire(type: string, msg: Record<string, unknown>) {
      for (const l of this.listeners.get(type) ?? []) l(msg);
    }
  }
  class Config {
    storage = { getProjectTempDir: () => '/tmp/gemini-abort-user-input-test' };
    messageBus = new Bus();
    constructor() {
      lastBus = this.messageBus;
    }
    async initialize() {}
    async refreshAuth() {}
  }
  class GeminiClient {
    async initialize() {}
    async resumeChat() {}
  }
  class LegacyAgentSession {
    async *sendStream() {
      if (askQuestion) {
        // Asynchronously, as the real scheduler does — after the adapter's pump race is armed.
        await new Promise((r) => setTimeout(r, 10));
        lastBus!.fire('tool-calls-update', {
          toolCalls: [
            {
              status: 'awaiting_approval',
              correlationId: 'c1',
              confirmationDetails: { type: 'ask_user', questions: [{ type: 'text', question: 'Name?' }] },
            },
          ],
        });
      }
      // Parks forever, and session.abort() does NOT unpark it: termination must come
      // from the adapter's own stop signal, not from engine cooperation.
      await new Promise<never>(() => {});
    }
    async abort() {}
  }
  return {
    Config,
    GeminiClient,
    LegacyAgentSession,
    AuthType: { USE_GEMINI: 'gemini-api-key' },
    MCPServerConfig: class {},
    MessageBusType: { TOOL_CALLS_UPDATE: 'tool-calls-update', TOOL_CONFIRMATION_RESPONSE: 'tool-confirmation-response' },
    ToolConfirmationOutcome: { ProceedOnce: 'proceed_once', Cancel: 'cancel' },
  };
});

beforeEach(() => {
  process.env.GOOGLE_API_KEY ??= 'test-key';
  askQuestion = true;
  publish.mockClear();
});

const PULL_TIMEOUT_MS = 2_000;
const HUNG = Symbol('hung');

/**
 * Pump the stream by hand rather than with `for await`, so a stall is a failed
 * assertion instead of a hung suite. `onEvent` is where the test injects `abort()`.
 */
async function pumpUntilDone(
  stream: AsyncIterable<UnifiedEvent>,
  onEvent: (e: UnifiedEvent) => void = () => {},
): Promise<{ events: UnifiedEvent[]; terminated: boolean }> {
  const iterator = stream[Symbol.asyncIterator]();
  const events: UnifiedEvent[] = [];
  for (;;) {
    const winner = await Promise.race([
      iterator.next(),
      new Promise<typeof HUNG>((r) => setTimeout(() => r(HUNG), PULL_TIMEOUT_MS)),
    ]);
    if (winner === HUNG) {
      // Not awaited: the generator is parked on an await, so return() would hang too.
      void iterator.return?.();
      return { events, terminated: false };
    }
    if (winner.done) return { events, terminated: true };
    events.push(winner.value);
    onEvent(winner.value);
  }
}

async function newAdapter() {
  const { GeminiAdapter } = await import('./gemini.js');
  return new GeminiAdapter();
}

const neverAnswers = () => new Promise<never>(() => {});
const params = (extra: Record<string, unknown> = {}) =>
  createTestParams({ model: 'gemini-2.5-pro', onUserInput: neverAnswers, ...extra });

function terminalError(events: UnifiedEvent[]) {
  const errs = events.filter((e) => e.type === 'error');
  expect(errs).toHaveLength(1);
  expect(errs[0]).toMatchObject({ phase: 'runtime' });
  return (errs[0] as { error: Error }).error;
}

const cancelAnswer = expect.objectContaining({
  type: 'tool-confirmation-response',
  correlationId: 'c1',
  confirmed: false,
  outcome: 'cancel',
});

describe('gemini — abort while a user-input request is outstanding', () => {
  it('abort() terminates a run parked on an unanswered question and answers it cancel', async () => {
    const adapter = await newAdapter();
    let sawRequest = false;
    const { events, terminated } = await pumpUntilDone(adapter.execute(params()), (e) => {
      if (e.type === 'user_input_request') {
        sawRequest = true;
        adapter.abort();
      }
    });

    expect(sawRequest, 'the question should have surfaced before aborting').toBe(true);
    expect(terminated, 'abort() must end a run parked on an unanswered user-input request').toBe(true);
    expect(terminalError(events)).toBeInstanceOf(AdapterAbortError);
    expect(publish).toHaveBeenCalledWith(cancelAnswer);
  });

  it('timeoutMs expiring while the question is pending ends the run with AdapterTimeoutError', async () => {
    const adapter = await newAdapter();
    const { events, terminated } = await pumpUntilDone(adapter.execute(params({ timeoutMs: 300 })));

    expect(events.some((e) => e.type === 'user_input_request')).toBe(true);
    expect(terminated).toBe(true);
    expect(terminalError(events)).toBeInstanceOf(AdapterTimeoutError);
    expect(publish).toHaveBeenCalledWith(cancelAnswer);
  });

  it('abort() terminates a run parked on a silent engine stream', async () => {
    askQuestion = false;
    const adapter = await newAdapter();
    const { events, terminated } = await pumpUntilDone(adapter.execute(params()), (e) => {
      if (e.type === 'adapter_ready') setTimeout(() => adapter.abort(), 50);
    });

    expect(terminated).toBe(true);
    expect(terminalError(events)).toBeInstanceOf(AdapterAbortError);
  });
});
