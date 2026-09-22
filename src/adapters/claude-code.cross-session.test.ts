// M14/M06 cross-session posture on claude-code (0.9.12): peers are not subagents.
//
//   1. INBOUND — `crossSessionInbound: 'refuse'` is pinned on every run, through
//      `options.settings` (a `Settings` key, not a query option), MERGED with the
//      path-scope permission rules that share that object.
//   2. OBSERVABLE — the pinned value appears in the redacted `sdkConfig` on
//      `adapter_ready`: a posture the consumer could not choose is one they can see.
//   3. OUTBOUND — a `SendMessage` may address only a subagent this run spawned. The
//      gate is a PreToolUse hook on the argument, never the tool name (the same tool
//      re-enters this run's own helpers).
//
// See spec/adapters/A01-claude-code.md (Cross-session ingress / Outbound peer messaging).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import type { UnifiedEvent } from '../types.js';

type Hook = (input: unknown) => Promise<{
  continue?: boolean;
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
}>;
type QueryArgs = { prompt: AsyncIterable<unknown> | string; options: Record<string, unknown> };
type Script = (args: QueryArgs) => AsyncGenerator<unknown>;

let capturedOptions: Record<string, unknown> | null = null;
let script: Script | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: (args: QueryArgs) => {
      capturedOptions = args.options;
      return script
        ? script(args)
        : (async function* () {
            yield resultMessage();
          })();
    },
  };
});

beforeEach(() => {
  capturedOptions = null;
  script = null;
});

function resultMessage(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    session_id: 'sess-1',
  } as unknown as SDKMessage;
}

async function run(params: Parameters<typeof createTestParams>[0] = {}): Promise<UnifiedEvent[]> {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return collectEvents(new ClaudeCodeAdapter().execute(createTestParams(params)), 10_000);
}

/** The outbound gate — the one PreToolUse entry with no `matcher` (it sees every tool). */
function outboundGate(options: Record<string, unknown> | null): Hook {
  const entries = (options?.hooks as { PreToolUse?: { matcher?: string; hooks: Hook[] }[] })?.PreToolUse ?? [];
  const gate = entries.find((e) => e.matcher === undefined);
  expect(gate, 'the outbound SendMessage gate is installed on every run').toBeDefined();
  return gate!.hooks[0];
}

const call = (hook: Hook, tool_name: string, tool_input: Record<string, unknown>) =>
  hook({ hook_event_name: 'PreToolUse', tool_name, tool_input });

describe('claude-code — crossSessionInbound is pinned to refuse', () => {
  it('sets it on a plain run, where nothing else writes settings', async () => {
    await run();
    expect(capturedOptions?.settings).toEqual({ crossSessionInbound: 'refuse' });
    // Never via managedSettings, which drops a non-allowlisted key silently.
    expect(capturedOptions?.managedSettings).toBeUndefined();
  });

  it('merges with the soft path-scope permission rules instead of clobbering them', async () => {
    await run({ cwd: '/work', disallowedPaths: ['/work/secret'] });
    const settings = capturedOptions?.settings as {
      crossSessionInbound?: string;
      permissions?: { allow?: string[]; deny?: string[] };
    };
    expect(settings.crossSessionInbound).toBe('refuse');
    expect(settings.permissions?.deny).toEqual(expect.arrayContaining(['Read(/work/secret/**)']));
    expect(settings.permissions?.allow).toEqual(expect.arrayContaining(['Read(/work/**)']));
  });

  it('reports the pinned posture in the redacted sdkConfig on adapter_ready', async () => {
    const events = await run();
    const ready = events.find(
      (e): e is Extract<UnifiedEvent, { type: 'adapter_ready' }> => e.type === 'adapter_ready',
    );
    const sdkConfig = ready?.sdkConfig as { options?: { settings?: { crossSessionInbound?: string } } };
    expect(sdkConfig?.options?.settings?.crossSessionInbound).toBe('refuse');
  });
});

describe('claude-code — outbound SendMessage is confined to this run’s own subagents', () => {
  it('denies a `to` that names no task this run started, with a reason the model can act on', async () => {
    await run();
    const res = await call(outboundGate(capturedOptions), 'SendMessage', { to: 'some-other-session', message: 'hi' });
    expect(res.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(res.hookSpecificOutput?.permissionDecisionReason).toMatch(/only address its own subagents/);
  });

  it('allows a `to` naming a subagent this run spawned — by task id, id prefix, or spawn name', async () => {
    const outcomes: Record<string, string | undefined> = {};
    script = async function* ({ prompt, options }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      const gate = outboundGate(options);
      // The spawn goes through the same hook first — that is where the name is learned.
      await call(gate, 'Agent', { name: 'researcher', prompt: 'look around', run_in_background: true });
      yield {
        type: 'system',
        subtype: 'task_started',
        task_id: 'a1b2c3d4e5f6',
        task_type: 'local_agent',
        description: 'look around',
        tool_use_id: 'toolu_A',
      };
      for (const to of ['a1b2c3d4e5f6', 'a1b2c3', 'researcher', 'a1b', 'stranger']) {
        outcomes[to] = (await call(gate, 'SendMessage', { to, message: 'more' })).hookSpecificOutput
          ?.permissionDecision;
      }
      yield resultMessage();
    };
    await run();

    expect(outcomes).toEqual({
      a1b2c3d4e5f6: undefined, // allowed — no decision, the call proceeds
      a1b2c3: undefined,
      researcher: undefined,
      a1b: 'deny', // too short to be an unambiguous prefix
      stranger: 'deny',
    });
  });

  it('does not treat a teammate as one of the run’s own subagents', async () => {
    let decision: string | undefined;
    script = async function* ({ prompt, options }) {
      const input = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      await input.next();
      yield {
        type: 'system',
        subtype: 'task_started',
        task_id: 'mate-123456',
        task_type: 'in_process_teammate',
        description: 'teammate',
      };
      decision = (await call(outboundGate(options), 'SendMessage', { to: 'mate-123456', message: 'x' }))
        .hookSpecificOutput?.permissionDecision;
      yield resultMessage();
    };
    await run();
    expect(decision).toBe('deny');
  });

  it('lets every other tool through untouched', async () => {
    await run();
    const res = await call(outboundGate(capturedOptions), 'Bash', { command: 'ls' });
    expect(res).toEqual({ continue: true });
  });
});
