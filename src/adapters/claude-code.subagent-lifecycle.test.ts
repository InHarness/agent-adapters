// M06 subagent lifecycle on claude-code: the STATUS MAP and the TERMINATION FLUSH.
//
// Two contracts, both invisible to the e2e tier in practice. Delegation is
// model-driven — the M17 wake-up matrix's own subagent cells come back
// [INCONCLUSIVE] on live runs often enough that the unit tier is where this is
// actually pinned:
//
//   1. `subagent_completed.status` is a unified four-value vocabulary
//      (`completed | failed | aborted | stopped`) that the adapter MAPS onto. The
//      SDK's `task_notification.status` is never forwarded raw — the sibling
//      `task_updated.patch.status` channel already shows a wider engine vocabulary,
//      so a peer-SDK bump inside the declared range could widen the notification
//      union too.
//   2. A run-level termination (`abort()`, `timeoutMs`, a hold-cap expiry) CLOSES
//      every subagent the adapter still has open, with `status: 'aborted'`, before
//      the stream ends. A consumer that pairs started/completed live otherwise waits
//      forever for a cleanup step that never fires.
//
// See spec/modules/M06-subagents.md and spec/adapters/A01-claude-code.md.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { assertSubagentLifecycle } from '../testing/contract.js';
import { AdapterAbortError } from '../types.js';
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

function taskStarted(taskId: string, extra: Record<string, unknown> = {}): SDKMessage {
  return sdk({
    type: 'system',
    subtype: 'task_started',
    task_id: taskId,
    task_type: 'agent',
    description: `work for ${taskId}`,
    tool_use_id: `toolu_${taskId}`,
    ...extra,
  });
}

function taskNotification(taskId: string, status: string): SDKMessage {
  return sdk({ type: 'system', subtype: 'task_notification', task_id: taskId, status, summary: 'done' });
}

/** A subagent's full lifecycle, settled inside the turn — the run ends at `result`. */
async function runWithStatus(status: string, extraNotifications: string[] = []): Promise<UnifiedEvent[]> {
  script = async function* ({ prompt }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();
    yield taskStarted('s-1');
    yield taskNotification('s-1', status);
    for (const [i, extra] of extraNotifications.entries()) {
      yield taskStarted(`s-${i + 2}`);
      yield taskNotification(`s-${i + 2}`, extra);
    }
    yield resultMessage();
  };
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return collectEvents(new ClaudeCodeAdapter().execute(createTestParams({})), 10_000);
}

function completions(events: UnifiedEvent[]): Extract<UnifiedEvent, { type: 'subagent_completed' }>[] {
  return events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'subagent_completed' }> => e.type === 'subagent_completed',
  );
}

describe('claude-code — subagent_completed.status is mapped, not forwarded', () => {
  it("maps the SDK's declared union onto the unified one, `stopped` included", async () => {
    // `stopped` is native here: `Query.stopTask()` is a PER-TASK lever, so it must
    // stay distinct from `aborted` (which means the whole run is over). Collapsing
    // the two would destroy the only signal a consumer has for telling "my subagent
    // was cancelled but the agent is still working" from "everything is over".
    for (const [raw, unified] of [
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['stopped', 'stopped'],
    ]) {
      const events = await runWithStatus(raw);
      expect(completions(events).map((e) => e.status), `SDK status ${raw}`).toEqual([unified]);
      expect(events.filter((e) => e.type === 'warning')).toEqual([]);
    }
  });

  it('maps an unrecognized but cancellation-shaped status to `aborted`, silently', async () => {
    // The `task_updated` channel already shows `cancelled`/`canceled` today, so a
    // peer-SDK bump widening the notification union to match is a live possibility.
    // Cancellation-shaped is a SHAPE the adapter understands — no drift warning.
    for (const raw of ['cancelled', 'canceled', 'interrupted']) {
      const events = await runWithStatus(raw);
      expect(completions(events).map((e) => e.status), `SDK status ${raw}`).toEqual(['aborted']);
      expect(events.filter((e) => e.type === 'warning')).toEqual([]);
    }
  });

  it('maps a status of no known shape to `failed` — never to `completed`', async () => {
    const events = await runWithStatus('quantum_superposition');
    expect(completions(events).map((e) => e.status)).toEqual(['failed']);
    // The accepted cost, stated explicitly: a subagent that actually succeeded under
    // some new SDK wording is reported as failed. A false negative is chosen
    // deliberately over a false positive — claiming success is the one error a
    // consumer would act on irreversibly.
    expect(completions(events).some((e) => e.status === 'completed')).toBe(false);
  });

  it('raises the drift warning exactly ONCE per run, however many unknown statuses arrive', async () => {
    const events = await runWithStatus('quantum_superposition', ['banana', 'also_unknown']);
    expect(completions(events).map((e) => e.status)).toEqual(['failed', 'failed', 'failed']);

    const warnings = events.filter(
      (e): e is Extract<UnifiedEvent, { type: 'warning' }> => e.type === 'warning',
    );
    expect(warnings, 'three unknown statuses, one signal').toHaveLength(1);
    expect(warnings[0].message).toMatch(/unrecognized subagent status/i);
    expect(warnings[0].message).toContain('quantum_superposition');
  });

  it('the dedup is per RUN, not per module — the next run still gets its signal', async () => {
    // A module-level flag would leak across runs and silence every run after the
    // first, turning the drift signal into a one-shot for the whole process.
    const first = await runWithStatus('banana');
    const second = await runWithStatus('banana');
    expect(first.filter((e) => e.type === 'warning')).toHaveLength(1);
    expect(second.filter((e) => e.type === 'warning')).toHaveLength(1);
  });
});

describe('claude-code — a run-level termination closes every open subagent', () => {
  /**
   * A run parked past its `result` with tasks still in flight: the background hold
   * keeps the input channel open, so `abort()` lands while subagents are genuinely
   * open. `settle` names the tasks that report their own notification first.
   */
  function heldRun(opts: { open: string[]; settled?: string[]; background?: string[] }): Script {
    return async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      for (const id of opts.open) yield taskStarted(id);
      for (const id of opts.background ?? []) yield taskStarted(id, { task_type: 'local_bash' });
      for (const id of opts.settled ?? []) {
        yield taskStarted(id);
        yield taskNotification(id, 'completed');
      }
      yield resultMessage();
      // Stays pending while the adapter holds the channel — the real SDK's read of
      // our iterable, which resolves `done` only when the adapter closes it.
      await input.next();
    };
  }

  async function abortOnFirstSubagent(): Promise<UnifiedEvent[]> {
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();
    const events: UnifiedEvent[] = [];
    let aborted = false;
    for await (const e of adapter.execute(createTestParams({ streamingInput: true }))) {
      events.push(e);
      if (e.type === 'result' && !aborted) {
        aborted = true;
        adapter.abort();
      }
    }
    return events;
  }

  it('synthesizes `subagent_completed { status: aborted }` before the terminal error', async () => {
    script = heldRun({ open: ['s-1', 's-2'] });
    const events = await abortOnFirstSubagent();

    const closed = completions(events);
    expect(closed.map((e) => e.taskId).sort()).toEqual(['s-1', 's-2']);
    expect(closed.every((e) => e.status === 'aborted')).toBe(true);

    const errorIdx = events.findIndex((e) => e.type === 'error');
    expect(errorIdx, 'the run still ends with its terminal error').toBeGreaterThanOrEqual(0);
    expect((events[errorIdx] as Extract<UnifiedEvent, { type: 'error' }>).error).toBeInstanceOf(AdapterAbortError);
    // BEFORE the error, and nothing of the family after it: a consumer that stops
    // reading at the error must still have seen every pair closed.
    for (const c of closed) expect(events.indexOf(c)).toBeLessThan(errorIdx);
    expect(events.slice(errorIdx + 1).filter((e) => e.type.startsWith('subagent_'))).toEqual([]);
  });

  it('does not close a subagent that already reported its own end', async () => {
    script = heldRun({ open: ['s-open'], settled: ['s-done'] });
    const events = await abortOnFirstSubagent();

    const byId = completions(events).filter((e) => e.taskId === 's-done');
    expect(byId, 'at most one subagent_completed per subagent_started').toHaveLength(1);
    expect(byId[0].status).toBe('completed');
    expect(completions(events).filter((e) => e.taskId === 's-open')).toHaveLength(1);
  });

  it('skips backgrounded work — that lifecycle is M17s, and it is ABANDONED, not closed', async () => {
    // The deliberate asymmetry: a background task outlives the run and only the
    // engine can honestly report its completion, so it is abandoned. A subagent ends
    // WITH the run, so the adapter can report its end truthfully. Synthesizing a
    // subagent event for a backgrounded shell command would be a category error —
    // it is what made consumer UIs render "3 subagents stopped" for three `sleep`s.
    script = heldRun({ open: ['s-1'], background: ['bg-1'] });
    const events = await abortOnFirstSubagent();

    expect(completions(events).map((e) => e.taskId)).toEqual(['s-1']);
    expect(events.filter((e) => e.type.startsWith('subagent_') && (e as { taskId?: string }).taskId === 'bg-1')).toEqual(
      [],
    );
    expect(events.some((e) => e.type === 'background_task_completed')).toBe(false);
  });

  it('leaves the shared conformance invariants green on the aborted run', async () => {
    script = heldRun({ open: ['s-1', 's-2'], settled: ['s-done'] });
    const result = assertSubagentLifecycle(await abortOnFirstSubagent());
    expect(result.assertions.filter((a) => !a.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('closes a subagent the engine never reported on, even when the run ends normally', async () => {
    // `error_max_turns` (and an SDK stream that simply ends) closes the run while an
    // Agent-tool notification is still owed — those land seconds after the tool_result.
    // Once this generator returns, nothing can ever close that pair, so the ordinary
    // exit carries the same obligation as the terminal ones. No error follows here.
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield taskStarted('s-1');
      yield resultMessage();
    };
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events = await collectEvents(new ClaudeCodeAdapter().execute(createTestParams({})), 10_000);

    expect(completions(events).map((e) => e.status)).toEqual(['aborted']);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(assertSubagentLifecycle(events).passed).toBe(true);
  });

  it('closes them when the SDK stream throws for a reason of its own', async () => {
    // Not an abort and not a timeout: a transport failure or CLI crash. The run ends
    // all the same, and the flush belongs BEFORE that error like every other one.
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield taskStarted('s-1');
      throw new Error('transport died');
    };
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events = await collectEvents(new ClaudeCodeAdapter().execute(createTestParams({})), 10_000);

    expect(completions(events).map((e) => e.status)).toEqual(['aborted']);
    const errorIdx = events.findIndex((e) => e.type === 'error');
    expect(errorIdx).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(completions(events)[0])).toBeLessThan(errorIdx);
    expect(assertSubagentLifecycle(events).passed).toBe(true);
  });

  it('a timeout closes them too — the obligation is on run-level termination, not on abort()', async () => {
    script = heldRun({ open: ['s-1'] });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const events = await collectEvents(
      new ClaudeCodeAdapter().execute(createTestParams({ streamingInput: true, timeoutMs: 300 })),
      10_000,
    );

    expect(completions(events).map((e) => e.status)).toEqual(['aborted']);
    const errorIdx = events.findIndex((e) => e.type === 'error');
    expect(errorIdx).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(completions(events)[0])).toBeLessThan(errorIdx);
  });
});
