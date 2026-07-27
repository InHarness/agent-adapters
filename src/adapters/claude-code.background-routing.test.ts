// M17 routing: the SDK multiplexes real subagents and engine-backgrounded side work
// onto ONE `task_*` channel, and only `task_started` carries the discriminator
// (`task_type`). These tests pin the split — subagent kinds stay on `subagent_*`
// (M06), shell/monitor/workflow move to `background_task_*` (M17) — plus the L3
// disable lever.
//
// Why it matters beyond tidiness: before the split, a backgrounded `sleep` surfaced
// as `subagent_started` / `subagent_completed`, so consumer UIs rendered "3 subagents
// stopped" for three shell commands. See spec/modules/M17-background-tasks.md.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import type { UnifiedEvent } from '../types.js';

type QueryArgs = { prompt: AsyncIterable<unknown> | string; options: Record<string, unknown> };

let script: ((args: QueryArgs) => AsyncGenerator<unknown>) | null = null;
let capturedOptions: Record<string, unknown> | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: (args: QueryArgs) => {
      capturedOptions = args.options;
      return script!(args);
    },
  };
});

beforeEach(() => {
  script = null;
  capturedOptions = null;
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

/**
 * One task's full lifecycle (started → progress → notification), settled inside the
 * turn so the run ends at its `result` without entering the background hold.
 */
async function runTaskLifecycle(started: Record<string, unknown>): Promise<UnifiedEvent[]> {
  script = async function* ({ prompt }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();

    yield sdk({ type: 'system', subtype: 'task_started', task_id: 't-1', description: 'do a thing', ...started });
    yield sdk({
      type: 'system',
      subtype: 'task_progress',
      task_id: 't-1',
      description: 'still going',
      last_tool_name: 'Bash',
      status: 'running',
      output_file: '/tmp/t-1.log',
    });
    yield sdk({
      type: 'system',
      subtype: 'task_notification',
      task_id: 't-1',
      status: 'completed',
      summary: 'all done',
      output_file: '/tmp/t-1.log',
      usage: { total_tokens: 12, tool_uses: 2, duration_ms: 30 },
    });
    yield resultMessage();
  };

  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return collectEvents(new ClaudeCodeAdapter().execute(createTestParams({})), 10_000);
}

describe('claude-code — task_type routing (M17 vs M06)', () => {
  it("task_type 'shell' routes the whole lifecycle to background_task_*", async () => {
    const events = await runTaskLifecycle({ task_type: 'shell', tool_use_id: 'toolu_bash' });

    expect(events.filter((e) => e.type.startsWith('subagent_'))).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'background_task_started', taskId: 't-1', taskType: 'shell' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'background_task_progress',
        taskId: 't-1',
        taskType: 'shell',
        status: 'running',
        outputFile: '/tmp/t-1.log',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'background_task_completed',
        taskId: 't-1',
        taskType: 'shell',
        status: 'completed',
        outputFile: '/tmp/t-1.log',
        summary: 'all done',
      }),
    );
  });

  it("the SDK's real spelling for backgrounded bash — 'local_bash' — routes to background_task_*", async () => {
    // Probed live against @anthropic-ai/claude-agent-sdk 0.3.153: a
    // `run_in_background` Bash command reports `task_type: 'local_bash'`, not
    // 'shell'. Guessing 'shell' alone silently kept the old mislabelling.
    const events = await runTaskLifecycle({ task_type: 'local_bash', tool_use_id: 'toolu_bash' });

    expect(events.filter((e) => e.type.startsWith('subagent_'))).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'background_task_started', taskId: 't-1', taskType: 'shell' }),
    );
  });

  it("task_type 'subagent' stays on the subagent_* family", async () => {
    const events = await runTaskLifecycle({ task_type: 'subagent', subagent_type: 'reviewer', tool_use_id: 'toolu_task' });

    expect(events.filter((e) => e.type.startsWith('background_task_'))).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'subagent_started', taskId: 't-1', toolUseId: 'toolu_task' }),
    );
    expect(events.some((e) => e.type === 'subagent_completed')).toBe(true);
  });

  it('an absent task_type keeps the legacy subagent path', async () => {
    // Degradation rule: an SDK that stops sending the discriminator must fall back
    // to the pre-M17 shape rather than relabel real subagents as shell work.
    const events = await runTaskLifecycle({ tool_use_id: 'toolu_legacy' });

    expect(events.filter((e) => e.type.startsWith('background_task_'))).toHaveLength(0);
    expect(events.some((e) => e.type === 'subagent_started')).toBe(true);
  });

  it("an unknown task_type keeps the legacy subagent path too", async () => {
    const events = await runTaskLifecycle({ task_type: 'something_new', tool_use_id: 'toolu_new' });

    expect(events.filter((e) => e.type.startsWith('background_task_'))).toHaveLength(0);
    expect(events.some((e) => e.type === 'subagent_started')).toBe(true);
  });

  it('a task settled inside the turn leaves no in-flight signal on result', async () => {
    const events = await runTaskLifecycle({ task_type: 'shell' });
    const result = events.find((e) => e.type === 'result');

    expect(result && 'backgroundTasks' in result ? result.backgroundTasks : undefined).toBeUndefined();
  });
});

// --- What `backgroundTasks` is allowed to carry (M17) ---
//
// The field means "engine-backgrounded side work still running, so this `result` is
// NOT end-of-run". M17 and types.ts both say it is never a subagent — subagents have
// the `subagent_*` family, and they hold the session through the hold, not through
// this signal. Shipping one here tells a consumer to keep iterating for a
// `background_task_completed` that is never coming.

/**
 * Run to a `result` with work still outstanding. The generator returns straight
 * after, so the SDK stream is `done` and the run ends without waiting out the hold —
 * the hold's own bounds are covered in claude-code.background-tasks.test.ts.
 */
async function resultWithInFlight(opts: {
  started?: Record<string, unknown>[];
  resultBackgroundTasks?: unknown[];
  stopHookTasks?: unknown[];
}): Promise<UnifiedEvent[]> {
  script = async function* ({ prompt, options }) {
    const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    await input.next();

    for (const s of opts.started ?? []) {
      yield sdk({ type: 'system', subtype: 'task_started', ...s });
    }

    if (opts.stopHookTasks) {
      // How the engine really publishes this today: on the Stop hook, just before the
      // `result` it belongs to (measured ~3ms ahead, on 0.3.153 and 0.3.210).
      const stopHooks = (options.hooks as Record<string, { hooks: ((i: unknown) => Promise<unknown>)[] }[]>).Stop;
      for (const entry of stopHooks ?? []) {
        for (const h of entry.hooks) await h({ background_tasks: opts.stopHookTasks });
      }
    }

    yield sdk({
      type: 'result',
      subtype: 'success',
      result: 'ok',
      usage: { input_tokens: 1, output_tokens: 1 },
      session_id: 'sess-1',
      ...(opts.resultBackgroundTasks ? { background_tasks: opts.resultBackgroundTasks } : {}),
    });
  };

  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return collectEvents(new ClaudeCodeAdapter().execute(createTestParams({})), 10_000);
}

function backgroundTasksOn(events: UnifiedEvent[]) {
  const result = events.find((e) => e.type === 'result');
  return result && 'backgroundTasks' in result ? result.backgroundTasks : undefined;
}

describe('claude-code — backgroundTasks carries background work only (M17)', () => {
  it('omits an in-flight subagent and keeps an in-flight shell task', async () => {
    const events = await resultWithInFlight({
      started: [
        { task_id: 'sub-1', task_type: 'local_agent', tool_use_id: 'toolu_task', description: 'review the diff' },
        { task_id: 'bg-1', task_type: 'local_bash', description: 'sleep 30' },
      ],
    });

    expect(backgroundTasksOn(events)).toEqual([
      { taskId: 'bg-1', taskType: 'shell', description: 'sleep 30' },
    ]);
  });

  it('a lone in-flight subagent leaves the signal absent entirely', async () => {
    const events = await resultWithInFlight({
      started: [{ task_id: 'sub-1', task_type: 'local_agent', tool_use_id: 'toolu_task', description: 'review' }],
    });

    // Not `[]` — absent. A non-empty list is what tells consumers the result is not
    // terminal, so a subagent must not manufacture one.
    expect(backgroundTasksOn(events)).toBeUndefined();
    expect(events.some((e) => e.type === 'subagent_started')).toBe(true);
  });

  it("normalizes the engine's friendly label and drops its 'subagent' entries", async () => {
    // `BackgroundTaskSummary.type` is a display label, not the `task_type`
    // discriminant — sdk.d.ts documents 'subagent' as one of its values, and 0.3.210
    // emits exactly that for helper agents. Passing it through unclassified both
    // leaked subagents into the signal and mislabelled `local_bash`.
    const events = await resultWithInFlight({
      resultBackgroundTasks: [
        { id: 'x', type: 'local_bash', status: 'running', description: 'sleep 30' },
        { id: 'y', type: 'subagent', status: 'running', description: 'Reply with gamma' },
      ],
    });

    expect(backgroundTasksOn(events)).toEqual([
      { taskId: 'x', taskType: 'shell', description: 'sleep 30' },
    ]);
  });

  it('reads the same list off the Stop hook, with the same filtering', async () => {
    const events = await resultWithInFlight({
      stopHookTasks: [
        { id: 'bg-9', type: 'shell', status: 'running', description: 'sleep 25', command: 'sleep 25' },
        { id: 'sub-9', type: 'subagent', status: 'running', description: 'Reply with beta' },
      ],
    });

    expect(backgroundTasksOn(events)).toEqual([
      { taskId: 'bg-9', taskType: 'shell', description: 'sleep 25' },
    ]);
  });

  it('an entry with no usable id is skipped rather than shipped malformed', async () => {
    const events = await resultWithInFlight({
      resultBackgroundTasks: [{ type: 'shell', status: 'running' }, { id: 42, type: 'shell' }],
    });

    expect(backgroundTasksOn(events)).toBeUndefined();
  });
});

describe('claude-code — claude_disallowBackgroundBash (M17 L3 lever)', () => {
  async function hookFor(config: Record<string, unknown>) {
    script = async function* ({ prompt }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield resultMessage();
    };
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    await collectEvents(
      new ClaudeCodeAdapter().execute(createTestParams({ architectureConfig: config })),
      10_000,
    );
    const hooks = capturedOptions?.hooks as
      | { PreToolUse?: { matcher?: string; hooks: ((input: unknown) => Promise<unknown>)[] }[] }
      | undefined;
    return hooks?.PreToolUse?.[0];
  }

  it('off by default — no hooks are synthesized', async () => {
    expect(await hookFor({})).toBeUndefined();
  });

  it('denies a Bash call requesting run_in_background, and only that', async () => {
    const matcher = await hookFor({ claude_disallowBackgroundBash: true });
    expect(matcher?.matcher).toBe('Bash');

    const hook = matcher!.hooks[0];
    const denied = (await hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'sleep 60', run_in_background: true },
    })) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(denied.hookSpecificOutput?.permissionDecision).toBe('deny');
    // The reason is what the model acts on — it must say how to succeed instead.
    expect(denied.hookSpecificOutput?.permissionDecisionReason).toMatch(/without run_in_background/);

    const allowed = (await hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    })) as { hookSpecificOutput?: unknown };
    expect(allowed.hookSpecificOutput).toBeUndefined();
  });
});
