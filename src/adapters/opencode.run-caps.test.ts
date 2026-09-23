// M06 `subagentTimeoutMs` on opencode: a `task` part is re-sent as `running` on every
// title/metadata update. Only the first opens the subagent — a repeat must neither
// duplicate the start pair nor re-arm the cap like a heartbeat.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterSubagentTimeoutError } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

const SESSION_ID = 'ses-1';
const CAP_MS = 200;

const runningTask = (title: string) => ({
  type: 'message.part.updated',
  properties: {
    part: {
      type: 'tool',
      tool: 'task',
      callID: 'call-task-1',
      sessionID: SESSION_ID,
      messageID: 'msg-1',
      state: { status: 'running', title, input: { prompt: 'look around' } },
    },
  },
});

/** Re-sends the running `task` part every CAP_MS/2, then never ends. */
function mainStream(): AsyncIterable<unknown> {
  return (async function* () {
    await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 6; i++) {
      yield runningTask(`step ${i}`);
      await new Promise((r) => setTimeout(r, CAP_MS / 2));
    }
    await new Promise(() => {});
  })();
}

vi.mock('@opencode-ai/sdk', () => ({
  createOpencode: async () => ({
    client: {
      session: {
        create: async () => ({ data: { id: SESSION_ID } }),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
      event: { subscribe: async () => ({ stream: mainStream() }) },
    },
    server: { close: () => {} },
  }),
}));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY ??= 'test-key';
});

describe('opencode — subagentTimeoutMs with a re-sent running task part', () => {
  it('opens the subagent once, and metadata updates do not re-arm its cap', async () => {
    const { OpencodeAdapter } = await import('./opencode.js');
    const started = Date.now();
    const events = await collectEvents(
      new OpencodeAdapter().execute(createTestParams({ model: 'openrouter/test/model', subagentTimeoutMs: CAP_MS })),
      5_000,
    );

    expect(events.filter((e) => e.type === 'subagent_started')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([{ taskId: 'call-task-1', status: 'aborted' }]);
    const errs = events.filter((e) => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect((errs[0] as { error: Error }).error).toBeInstanceOf(AdapterSubagentTimeoutError);
    // Cut at the cap from the FIRST running part, well before the updates stop.
    expect(Date.now() - started).toBeLessThan(CAP_MS * 2.5);
  });
});
