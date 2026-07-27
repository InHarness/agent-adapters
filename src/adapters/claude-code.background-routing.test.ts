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
