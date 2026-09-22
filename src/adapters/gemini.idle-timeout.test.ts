// M01 `idleTimeoutMs` on gemini: an open subagent thread is outstanding work, and a
// silent session with nothing outstanding ends with AdapterIdleTimeoutError.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterIdleTimeoutError } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

/** `{ sleep: ms }` pauses the scripted stream; `session.abort()` ends it as `aborted`. */
let scriptedEvents: Array<Record<string, unknown>> = [];

vi.mock('@google/gemini-cli-core', () => {
  class Config {
    storage = { getProjectTempDir: () => '/tmp/gemini-idle-timeout-test' };
    async initialize() {}
    async refreshAuth() {}
  }
  class GeminiClient {
    async initialize() {}
    async resumeChat() {}
  }
  class LegacyAgentSession {
    private wakeOnAbort: (() => void) | null = null;
    private aborted = false;
    async *sendStream() {
      for (const e of scriptedEvents) {
        if (typeof e.sleep === 'number') {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, e.sleep as number);
            this.wakeOnAbort = () => {
              clearTimeout(t);
              resolve();
            };
          });
          if (this.aborted) {
            yield { id: 'abort', type: 'agent_end', streamId: 's-run', reason: 'aborted' };
            return;
          }
          continue;
        }
        yield e;
      }
    }
    async abort() {
      this.aborted = true;
      this.wakeOnAbort?.();
    }
  }
  return {
    Config,
    GeminiClient,
    LegacyAgentSession,
    AuthType: { USE_GEMINI: 'gemini-api-key' },
    MCPServerConfig: class {},
    MessageBusType: {},
    ToolConfirmationOutcome: {},
  };
});

beforeEach(() => {
  process.env.GOOGLE_API_KEY ??= 'test-key';
});

const IDLE_MS = 150;

async function run() {
  const { GeminiAdapter } = await import('./gemini.js');
  return collectEvents(new GeminiAdapter().execute(createTestParams({ model: 'gemini-2.5-pro', idleTimeoutMs: IDLE_MS })), 10_000);
}

describe('gemini — idleTimeoutMs', () => {
  it('an open subagent does not expire on the idle clock, however long it runs', async () => {
    scriptedEvents = [
      { id: 'e1', type: 'tool_request', threadId: 'thread-1', name: 'delegate', requestId: 'req-1', args: {} },
      { sleep: 5 * IDLE_MS },
      { id: 'e2', type: 'agent_end', threadId: 'thread-1', streamId: 's1', reason: 'completed' },
      { id: 'e3', type: 'agent_end', streamId: 's-run', reason: 'completed' },
    ];
    const events = await run();

    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([{ taskId: 'thread-1', status: 'completed' }]);
  });

  it('a silent session with nothing outstanding ends with AdapterIdleTimeoutError', async () => {
    scriptedEvents = [{ sleep: 60_000 }, { id: 'e3', type: 'agent_end', streamId: 's-run', reason: 'completed' }];
    const events = await run();

    const errs = events.filter((e) => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ phase: 'runtime' });
    expect((errs[0] as { error: Error }).error).toBeInstanceOf(AdapterIdleTimeoutError);
  });
});
