// M06 × M17 subagent RE-ENTRY on claude-code (0.9.12).
//
// The model can continue a backgrounded helper it already spawned with
// `SendMessage`. Measured live on SDK 0.3.263, one re-entry cycle is:
//
//   Agent (tool_use A) → system/task_started (task_id T, tool_use_id A)
//                      → task_updated(completed) → task_notification
//   SendMessage (tool_use S, to = T)
//                      → system/task_started (task_id T, tool_use_id S, is_backgrounded, prompt)
//                      → assistant / stream_event (parent_tool_use_id = A — the ORIGINAL spawn)
//                      → task_updated(completed) → task_notification
//
// Contracts pinned here:
//   1. `taskId` names the agent, `toolUseId` the invocation — the re-entry is a
//      SECOND lifecycle pair for T, its start marked `resumed: true` and carrying S.
//   2. Attribution is unchanged — deltas under A still resolve to T.
//   3. Termination synthesis is per termination: a re-opened cycle is closed exactly
//      once; a settled, not-yet-re-entered one gets nothing.
//   4. The hold does not expire inside a re-entered cycle — including when the
//      engine had patched T finished but not yet notified it.
//   5. Teammates are not subagents: nothing reaches the unified stream.
//
// See spec/modules/M06-subagents.md, M17-background-tasks.md, spec/adapters/A01-claude-code.md.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents, splitBySubagent } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { assertSubagentLifecycle } from '../testing/contract.js';
import type { UnifiedEvent } from '../types.js';

type QueryArgs = { prompt: AsyncIterable<unknown> | string; options: Record<string, unknown> };
type Script = (args: QueryArgs) => AsyncGenerator<unknown>;

let script: Script | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return { ...actual, query: (args: QueryArgs) => script!(args) };
});

beforeEach(() => {
  script = null;
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function sdk(msg: Record<string, unknown>): SDKMessage {
  return msg as unknown as SDKMessage;
}

function resultMessage(): SDKMessage {
  return sdk({
    type: 'result',
    subtype: 'success',
    result: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    session_id: 'sess-1',
  });
}

function taskStarted(taskId: string, toolUseId: string, extra: Record<string, unknown> = {}): SDKMessage {
  return sdk({
    type: 'system',
    subtype: 'task_started',
    task_id: taskId,
    task_type: 'local_agent',
    description: `work for ${taskId}`,
    tool_use_id: toolUseId,
    ...extra,
  });
}

function taskUpdatedCompleted(taskId: string): SDKMessage {
  return sdk({ type: 'system', subtype: 'task_updated', task_id: taskId, patch: { status: 'completed' } });
}

function taskNotification(taskId: string, status = 'completed', extra: Record<string, unknown> = {}): SDKMessage {
  return sdk({ type: 'system', subtype: 'task_notification', task_id: taskId, status, summary: 'done', ...extra });
}

function subagentDelta(parentToolUseId: string, text: string): SDKMessage {
  return sdk({
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  });
}

/** The re-entry sequence as a prefix of a script (without the trailing result). */
function* reentryCycles(): Generator<SDKMessage> {
  yield taskStarted('T', 'toolu_A');
  yield subagentDelta('toolu_A', 'first');
  yield taskUpdatedCompleted('T');
  yield taskNotification('T');
  yield taskStarted('T', 'toolu_S', { is_backgrounded: true, prompt: 'one more thing' });
  yield subagentDelta('toolu_A', 'second');
  yield taskUpdatedCompleted('T');
  yield taskNotification('T');
}

function starts(events: UnifiedEvent[]) {
  return events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'subagent_started' }> => e.type === 'subagent_started',
  );
}
function completions(events: UnifiedEvent[]) {
  return events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'subagent_completed' }> => e.type === 'subagent_completed',
  );
}

async function run(params: Parameters<typeof createTestParams>[0] = {}): Promise<UnifiedEvent[]> {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return collectEvents(new ClaudeCodeAdapter().execute(createTestParams(params)), 10_000);
}

describe('claude-code — subagent re-entry is a second lifecycle pair for the same taskId', () => {
  it('emits two pairs; only the second start is `resumed` and it carries the SendMessage id', async () => {
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield* reentryCycles();
      yield resultMessage();
    };
    const events = await run();

    const s = starts(events);
    expect(s.map((e) => [e.taskId, e.toolUseId, e.resumed])).toEqual([
      ['T', 'toolu_A', undefined],
      ['T', 'toolu_S', true],
    ]);
    // Absent — not `false` — on the first start.
    expect('resumed' in s[0]).toBe(false);
    expect(completions(events).map((e) => [e.taskId, e.status])).toEqual([
      ['T', 'completed'],
      ['T', 'completed'],
    ]);
    // Sequenced, never nested: the resumed start follows the first cycle's completion.
    expect(events.indexOf(s[1])).toBeGreaterThan(events.indexOf(completions(events)[0]));
    expect(assertSubagentLifecycle(events).passed).toBe(true);
  });

  it('keeps attribution on the ORIGINAL spawn — deltas of both cycles resolve to the same taskId', async () => {
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield* reentryCycles();
      yield resultMessage();
    };
    const events = await run();

    const deltas = events.filter(
      (e): e is Extract<UnifiedEvent, { type: 'text_delta' }> => e.type === 'text_delta' && e.isSubagent,
    );
    expect(deltas.map((d) => [d.text, d.subagentTaskId])).toEqual([
      ['first', 'T'],
      ['second', 'T'],
    ]);
  });

  it('splitBySubagent keeps both cycles in the one subagent bucket, in stream order', async () => {
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield* reentryCycles();
      yield resultMessage();
    };
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const { subagent } = await splitBySubagent(new ClaudeCodeAdapter().execute(createTestParams({})));

    const lifecycle = subagent
      .filter((e) => e.type === 'subagent_started' || e.type === 'subagent_completed')
      .map((e) => (e.type === 'subagent_started' ? `start${e.resumed ? '(resumed)' : ''}` : 'completed'));
    expect(lifecycle).toEqual(['start', 'completed', 'start(resumed)', 'completed']);
    // The agent's terminator is the LAST completion for its taskId.
    const lastIdx = subagent.map((e) => e.type).lastIndexOf('subagent_completed');
    expect(subagent.slice(lastIdx + 1).filter((e) => e.type.startsWith('subagent_'))).toEqual([]);
  });
});

describe('claude-code — termination synthesis is per termination, not per taskId', () => {
  it('a run ending inside the re-entered cycle closes it exactly once', async () => {
    // The pre-0.9.12 run-wide "already flushed this id" guard is gone; what matters is
    // that the re-opened cycle is closed, and closed once.
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield taskStarted('T', 'toolu_A');
      yield taskNotification('T');
      yield taskStarted('T', 'toolu_S', { is_backgrounded: true });
      throw new Error('transport died');
    };
    const events = await run();

    expect(completions(events).map((e) => e.status)).toEqual(['completed', 'aborted']);
    expect(assertSubagentLifecycle(events).passed).toBe(true);
  });

  it('a run ending BETWEEN settle and re-entry synthesizes nothing — there is no unpaired start', async () => {
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield taskStarted('T', 'toolu_A');
      yield taskNotification('T');
      throw new Error('transport died');
    };
    const events = await run();

    expect(completions(events).map((e) => e.status)).toEqual(['completed']);
    expect(starts(events)).toHaveLength(1);
  });
});

describe('claude-code — the hold does not expire inside a re-entered cycle', () => {
  const GRACE = 150;

  /**
   * The first cycle is patched finished but NOT yet notified when the turn's `result`
   * lands — so the hold parks on grace (everything tracked reads as settled). Re-entry
   * arrives inside that grace window and runs LONGER than grace before reporting.
   * Before the fix, the finished mark survived re-entry and grace closed the control
   * transport under the live cycle.
   */
  function reentryInsideGrace(observed: { closedEarly?: boolean }, lateFirstNotification: boolean): Script {
    return async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield taskStarted('T', 'toolu_A');
      yield taskUpdatedCompleted('T');
      yield resultMessage();
      // Pending until the adapter closes the channel.
      let closed = false;
      const closing = input.next().then(() => {
        closed = true;
      });
      await sleep(GRACE / 3);
      yield taskStarted('T', 'toolu_S', { is_backgrounded: true });
      await sleep(GRACE * 3);
      observed.closedEarly = closed;
      yield subagentDelta('toolu_A', 'resumed work');
      // The first cycle's notification, arriving only now — or never.
      // Notifications echo their cycle's tool_use_id, as on the wire (0.3.263).
      if (lateFirstNotification) yield taskNotification('T', 'completed', { tool_use_id: 'toolu_A' });
      yield taskUpdatedCompleted('T');
      yield taskNotification('T', 'completed', { tool_use_id: 'toolu_S' });
      yield resultMessage();
      await closing;
    };
  }

  it.each([
    ['the first cycle\'s notification lands late', true],
    ['the first cycle is never notified', false],
  ])('keeps the control channel open until the resumed agent reports (%s)', async (_label, late) => {
    const observed: { closedEarly?: boolean } = {};
    script = reentryInsideGrace(observed, late);
    const events = await run({ architectureConfig: { claude_backgroundGraceMs: GRACE } });

    expect(observed.closedEarly, 'grace armed inside the live re-entered cycle').toBe(false);
    expect(starts(events).map((e) => e.resumed)).toEqual([undefined, true]);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    // Pairs still sequence: the unnotified first cycle is closed AT re-entry with the
    // status the engine patched, and the late notification (if any) is not a second close.
    expect(completions(events).map((e) => e.status)).toEqual(['completed', 'completed']);
    const lifecycle = assertSubagentLifecycle(events);
    expect(lifecycle.assertions.filter((a) => !a.passed)).toEqual([]);
  });

  it('a re-entry while the previous cycle is still RUNNING opens no second pair', async () => {
    // No finished patch yet — there is no cycle boundary to report, so emitting a
    // start would nest two pairs. The open cycle simply continues.
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield taskStarted('T', 'toolu_A');
      yield taskStarted('T', 'toolu_S', { is_backgrounded: true });
      yield taskUpdatedCompleted('T');
      yield taskNotification('T');
      yield resultMessage();
    };
    const events = await run();

    expect(starts(events)).toHaveLength(1);
    expect(completions(events)).toHaveLength(1);
    expect(assertSubagentLifecycle(events).passed).toBe(true);
  });

  it.each([
    ['matched by tool_use_id', true],
    ['without tool_use_id on the notifications', false],
  ])(
    'a stale notification landing AFTER the live cycle was patched does not close it twice (%s)',
    async (_label, withIds) => {
      // Cycle 1 patched → re-entry (cycle 1 closed there) → cycle 2 patched → only NOW
      // cycle 1's late notification → cycle 2's own notification.
      const ids = (id: string) => (withIds ? { tool_use_id: id } : {});
      script = async function* ({ prompt }) {
        const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
        await input.next();
        yield taskStarted('T', 'toolu_A');
        yield taskUpdatedCompleted('T');
        yield taskStarted('T', 'toolu_S', { is_backgrounded: true });
        yield taskUpdatedCompleted('T');
        yield sdk({ ...taskNotification('T', 'failed', ids('toolu_A')), summary: 'stale' });
        yield sdk({ ...taskNotification('T', 'completed', ids('toolu_S')), summary: 'live' });
        yield resultMessage();
      };
      const events = await run();

      expect(starts(events).map((e) => e.resumed)).toEqual([undefined, true]);
      // One close per cycle: cycle 1 at re-entry, cycle 2 from ITS notification.
      expect(completions(events).map((e) => [e.status, e.summary])).toEqual([
        ['completed', undefined],
        ['completed', 'live'],
      ]);
      expect(assertSubagentLifecycle(events).assertions.filter((a) => !a.passed)).toEqual([]);
    },
  );
});

describe('claude-code — teammates are not subagents', () => {
  it('emits nothing on the unified stream for an in-process teammate task', async () => {
    const GRACE = 5_000;
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield taskStarted('mate-1', 'toolu_M', { task_type: 'in_process_teammate' });
      yield sdk({ type: 'system', subtype: 'task_progress', task_id: 'mate-1', description: 'x' });
      yield taskUpdatedCompleted('mate-1');
      yield taskNotification('mate-1');
      yield resultMessage();
      // Pending until the adapter closes the channel — a teammate must not park the
      // run in the background hold's grace window.
      await input.next();
    };
    const t0 = Date.now();
    const events = await run({ architectureConfig: { claude_backgroundGraceMs: GRACE } });
    expect(Date.now() - t0, 'the teammate held the run open for the grace window').toBeLessThan(GRACE / 2);

    expect(events.filter((e) => e.type.startsWith('subagent_') || e.type.startsWith('background_task_'))).toEqual(
      [],
    );
    // And it does not hold the session: the run ends at its `result` with no error.
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });
});
