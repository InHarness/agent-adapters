// Unit tests: the gemini adapter's `subagent_completed.status` mapping (M06).
//
// The point of these cases is the binding rule from M06: an SDK terminal reason
// outside the known vocabulary must NEVER resolve to `'completed'`. gemini is the
// adapter where that is easiest to get wrong, because its `StreamEndReason` union is
// far wider than the four unified literals — `max_turns`, `max_budget`, `max_time`,
// `refusal` and `elicitation` all sit outside them, and an inline ternary used to
// funnel every one of them into `'completed'`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

// Events the mocked SDK stream should yield, set per test.
let scriptedEvents: Array<Record<string, unknown>> = [];

vi.mock('@google/gemini-cli-core', () => {
  class Config {
    storage = { getProjectTempDir: () => '/tmp/gemini-subagent-status-test' };
    async initialize() {}
    async refreshAuth() {}
  }
  class GeminiClient {
    async initialize() {}
    async resumeChat() {}
  }
  class LegacyAgentSession {
    async *sendStream() {
      for (const e of scriptedEvents) yield e;
    }
    async abort() {}
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

const THREAD = 'thread-sub-1';

/** Open a subagent bracket, then close the thread with `reason`. */
function scriptSubagentEndingWith(reason: unknown): Array<Record<string, unknown>> {
  return [
    { id: 'e1', type: 'tool_request', threadId: THREAD, name: 'delegate', requestId: 'req-1', args: {} },
    { id: 'e2', type: 'agent_end', threadId: THREAD, streamId: 's1', reason },
    // The RUN's own end — no threadId, so it is the run-level `agent_end`.
    { id: 'e3', type: 'agent_end', streamId: 's-run', reason: 'completed' },
  ];
}

async function runWith(reason: unknown) {
  scriptedEvents = scriptSubagentEndingWith(reason);
  const { GeminiAdapter } = await import('./gemini.js');
  return collectEvents(new GeminiAdapter().execute(createTestParams({ model: 'gemini-2.5-pro' })));
}

beforeEach(() => {
  process.env.GOOGLE_API_KEY ??= 'test-key';
  scriptedEvents = [];
});

describe('gemini subagent_completed.status (M06)', () => {
  it('maps the three unified spellings the SDK shares, without a drift warning', async () => {
    for (const [reason, status] of [
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['aborted', 'aborted'],
    ] as const) {
      const events = await runWith(reason);
      expect(events.filter((e) => e.type === 'subagent_completed'), reason).toMatchObject([
        { taskId: THREAD, status },
      ]);
      expect(events.some((e) => e.type === 'warning' && e.message.includes('unrecognized')), reason).toBe(false);
    }
  });

  it('maps the resource caps and a refusal to `stopped` — ended by a boundary, not by an error', async () => {
    // The axis: `'failed'` is the error path, `'stopped'` is "ended without an error
    // and without a result". A turn/budget/time cap and a model's refusal are the
    // latter — nothing broke, the work simply was not delivered.
    for (const reason of ['max_turns', 'max_budget', 'max_time', 'refusal']) {
      const events = await runWith(reason);
      expect(events.filter((e) => e.type === 'subagent_completed'), reason).toMatchObject([
        { taskId: THREAD, status: 'stopped' },
      ]);
      // Declared, so no drift warning.
      expect(events.some((e) => e.type === 'warning' && e.message.includes('unrecognized')), reason).toBe(false);
    }
  });

  it('never resolves an UNRECOGNIZED reason to `completed`, and warns once about the drift', async () => {
    // The regression this whole file exists for: before the fix every one of these
    // reported `'completed'`, which a consumer cannot detect downstream.
    for (const reason of ['some_future_reason', undefined, 42]) {
      const events = await runWith(reason);
      const completed = events.filter((e) => e.type === 'subagent_completed');
      expect(completed, String(reason)).toHaveLength(1);
      expect(completed[0], String(reason)).toMatchObject({ taskId: THREAD, status: 'failed' });
      expect((completed[0] as { status: string }).status, String(reason)).not.toBe('completed');

      const warnings = events.filter((e) => e.type === 'warning' && e.message.includes('unrecognized'));
      expect(warnings, String(reason)).toHaveLength(1);
    }
  });

  it('maps a cancellation-shaped reason to `aborted` via the shared backstop', async () => {
    const events = await runWith('cancelled');
    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([
      { taskId: THREAD, status: 'aborted' },
    ]);
  });

  it('treats `elicitation` as a SUSPENSION: no close is emitted while the run lives', async () => {
    // `AgentEnd` carries `elicitationIds` and the SDK resumes the same thread on an
    // `elicitation_response`, so closing the bracket here would risk a SECOND
    // `subagent_completed` for this taskId — and M06 allows at most one.
    scriptedEvents = [
      { id: 'e1', type: 'tool_request', threadId: THREAD, name: 'delegate', requestId: 'req-1', args: {} },
      { id: 'e2', type: 'agent_end', threadId: THREAD, streamId: 's1', reason: 'elicitation', elicitationIds: ['el-1'] },
      // The thread RESUMES and ends for real.
      { id: 'e3', type: 'agent_end', threadId: THREAD, streamId: 's1', reason: 'completed' },
      { id: 'e4', type: 'agent_end', streamId: 's-run', reason: 'completed' },
    ];
    const { GeminiAdapter } = await import('./gemini.js');
    const events = await collectEvents(
      new GeminiAdapter().execute(createTestParams({ model: 'gemini-2.5-pro' })),
    );

    const closes = events.filter((e) => e.type === 'subagent_completed');
    // Exactly one close, and it is the REAL end — not the suspension.
    expect(closes).toMatchObject([{ taskId: THREAD, status: 'completed' }]);
    expect(events.filter((e) => e.type === 'subagent_started')).toHaveLength(1);
  });

  it('a subagent left suspended on `elicitation` is still closed when the run ends', async () => {
    // The other half of the suspension decision: leaving the taskId open is only safe
    // because the run-level flush closes whatever is still unpaired (M06's synthesis).
    scriptedEvents = [
      { id: 'e1', type: 'tool_request', threadId: THREAD, name: 'delegate', requestId: 'req-1', args: {} },
      { id: 'e2', type: 'agent_end', threadId: THREAD, streamId: 's1', reason: 'elicitation', elicitationIds: ['el-1'] },
      { id: 'e3', type: 'agent_end', streamId: 's-run', reason: 'completed' },
    ];
    const { GeminiAdapter } = await import('./gemini.js');
    const events = await collectEvents(
      new GeminiAdapter().execute(createTestParams({ model: 'gemini-2.5-pro' })),
    );

    expect(events.filter((e) => e.type === 'subagent_started')).toHaveLength(1);
    // Closed exactly once, by the run-end flush, as `aborted`.
    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([
      { taskId: THREAD, status: 'aborted' },
    ]);
  });
});
