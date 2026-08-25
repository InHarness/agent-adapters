// Unit tests: claude-code maps M18 deny-groups onto the SDK Options — a residual
// ALLOW-LIST on `options.tools` with `options.disallowedTools` as backstop.
//
// These assert the SHAPE HANDED TO THE SDK, not merely today's tool-set
// behaviour: the residual-allow-list invariant is about what happens to a
// built-in nobody has heard of yet, which only the shape can express.
//
// Mocks @anthropic-ai/claude-agent-sdk's `query` to capture the built `options`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { AdapterToolPolicyError } from '../types.js';
import type { UnifiedEvent } from '../types.js';

let capturedOptions: Record<string, unknown> | null = null;
let queryCalls = 0;

function successResult(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: 'ok',
    usage: { input_tokens: 10, output_tokens: 5 },
    session_id: 'sess-1',
  } as unknown as SDKMessage;
}

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: ({ options }: { options: Record<string, unknown> }) => {
      capturedOptions = options;
      queryCalls += 1;
      return (async function* () {
        yield successResult();
      })();
    },
  };
});

beforeEach(() => {
  capturedOptions = null;
  queryCalls = 0;
});

async function run(params: Parameters<typeof createTestParams>[0]): Promise<UnifiedEvent[]> {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return collectEvents(new ClaudeCodeAdapter().execute(createTestParams(params)));
}

describe('claude-code tool gating — the shape sent to the SDK', () => {
  it('leaves tools/disallowedTools unset when nothing is denied (byte-for-byte no-op)', async () => {
    await run({});
    expect(capturedOptions?.tools).toBeUndefined();
    expect(capturedOptions?.disallowedTools).toBeUndefined();
  });

  it('treats an explicit empty array the same way — the documented opt-out', async () => {
    await run({ disallowedToolGroups: [] });
    expect(capturedOptions?.tools).toBeUndefined();
  });

  it('sends a residual ALLOW-list, not just a deny enumeration', async () => {
    await run({ disallowedToolGroups: ['shell'] });
    const tools = capturedOptions?.tools as string[];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toContain('Read');
    expect(tools).not.toContain('Bash');
    // The invariant: a built-in this library has never heard of is BLOCKED,
    // because it simply is not on the list.
    expect(tools).not.toContain('SomeFutureBuiltin');
  });

  it('sets disallowedTools as a backstop covering every alias of the denied group', async () => {
    await run({ disallowedToolGroups: ['shell'] });
    const deny = capturedOptions?.disallowedTools as string[];
    expect(deny).toEqual(expect.arrayContaining(['Bash', 'BashOutput', 'KillBash', 'KillShell']));
  });

  it('keeps task-tracking and delegation available under any deny', async () => {
    await run({ disallowedToolGroups: ['shell', 'file-read', 'file-write', 'web'] });
    const tools = capturedOptions?.tools as string[];
    expect(tools).toEqual(expect.arrayContaining(['TodoWrite', 'ToolSearch', 'Task', 'Agent']));
  });

  it('suppresses Skill when shell is denied — a skill is a shell-shaped instruction channel', async () => {
    await run({ disallowedToolGroups: ['shell'] });
    expect(capturedOptions?.tools as string[]).not.toContain('Skill');
  });

  it('keeps Skill when shell is not denied', async () => {
    await run({ disallowedToolGroups: ['file-write'] });
    expect(capturedOptions?.tools as string[]).toContain('Skill');
  });

  it('routes planMode through the deny-groups (no per-adapter plan-mode path left)', async () => {
    await run({ planMode: true });
    const tools = capturedOptions?.tools as string[];
    // file-write + shell denied; reads and web still available to research with.
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'WebFetch']));
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Bash');
  });
});

describe('claude-code tool gating — a deny outranks everything else', () => {
  it('strips a denied tool from autoApproveTools rather than letting it re-widen', async () => {
    await run({ disallowedToolGroups: ['shell'], autoApproveTools: ['Bash', 'Read'] });
    expect(capturedOptions?.allowedTools).toEqual(['Read']);
  });

  it('generates no path-scope allow rule for a denied group', async () => {
    await run({
      cwd: '/work',
      allowedPaths: ['/work/a'],
      disallowedToolGroups: ['file-write'],
    });
    const settings = capturedOptions?.settings as { permissions: { allow: string[]; deny: string[] } };
    // Reads are still allowed within the ceiling...
    expect(settings.permissions.allow.some((r) => r.startsWith('Read('))).toBe(true);
    // ...but the M18 deny is applied last: no Edit/Write allow rule is emitted
    // at all, so path-scope cannot re-widen the denied group.
    expect(settings.permissions.allow.some((r) => r.startsWith('Edit('))).toBe(false);
    expect(settings.permissions.allow.some((r) => r.startsWith('Write('))).toBe(false);
  });

  it('still denies path-scope carve-outs for groups that remain allowed', async () => {
    await run({
      cwd: '/work',
      allowedPaths: ['/work/a'],
      disallowedPaths: ['/work/a/secret'],
      disallowedToolGroups: ['file-write'],
    });
    const settings = capturedOptions?.settings as { permissions: { deny: string[] } };
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(['Read(/work/a/secret/**)']),
    );
  });
});

describe('claude-code tool gating — subagent propagation', () => {
  it('narrows a definition that names a denied tool, silently', async () => {
    const events = await run({
      disallowedToolGroups: ['shell'],
      subagents: [
        { name: 'helper', description: 'd', prompt: 'p', tools: ['Read', 'Bash'] },
      ],
    });
    const agents = capturedOptions?.agents as Record<string, { tools: string[]; disallowedTools: string[] }>;
    expect(agents.helper.tools).toEqual(['Read']);
    expect(agents.helper.disallowedTools).toEqual(expect.arrayContaining(['Bash']));
    // Silently: naming a denied tool is not an error and does not fail the run.
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('gives a definition with no toolset the run\'s residual allow-list', async () => {
    await run({
      disallowedToolGroups: ['shell'],
      subagents: [{ name: 'helper', description: 'd', prompt: 'p' }],
    });
    const agents = capturedOptions?.agents as Record<string, { tools: string[] }>;
    expect(agents.helper.tools).not.toContain('Bash');
    expect(agents.helper.tools).toContain('Read');
  });
});

describe('claude-code tool gating — the porous-combination warning', () => {
  it('warns exactly once when file-write is denied but the shell is live', async () => {
    const events = await run({ disallowedToolGroups: ['file-write'] });
    const warnings = events.filter(
      (e) => e.type === 'warning' && /not a filesystem boundary/i.test(e.message),
    );
    expect(warnings).toHaveLength(1);
  });

  it('does not warn once the shell is denied too', async () => {
    const events = await run({ disallowedToolGroups: ['file-write', 'shell'] });
    expect(
      events.filter((e) => e.type === 'warning' && /not a filesystem boundary/i.test(e.message)),
    ).toEqual([]);
  });

  it('does not block the run', async () => {
    const events = await run({ disallowedToolGroups: ['file-read'] });
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });
});

describe('claude-code tool gating — refusal', () => {
  it('refuses an unknown group before dispatch, with nothing sent to the SDK', async () => {
    const events = await run({ disallowedToolGroups: ['shel' as 'shell'] });
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBeInstanceOf(AdapterToolPolicyError);
    expect(errors[0].phase).toBe('init');
    // Nothing ran: no result, and the SDK was never called.
    expect(events.some((e) => e.type === 'result')).toBe(false);
    expect(queryCalls).toBe(0);
  });

  it('does not throw out of the iterator — the refusal is an event', async () => {
    await expect(run({ disallowedToolGroups: ['nope' as 'shell'] })).resolves.toBeDefined();
  });
});
