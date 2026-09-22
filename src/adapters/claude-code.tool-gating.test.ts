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

describe('claude-code tool gating — the delegation group (0.9.12)', () => {
  const DELEGATION_CONTINUATION = ['SendMessage', 'ListAgents', 'ListPeers'];

  it('keeps the delegation family in the allow-list when another group is denied', async () => {
    // Without these the model can SPAWN a helper under a deny but never CONTINUE it —
    // measured at 0.3.263: `SendMessage: false` at system:init, and the model reports
    // the tool does not exist. They are deferred (discovery-gate only), so they must be
    // named explicitly rather than derived from any catalog.
    await run({ disallowedToolGroups: ['file-write'] });
    const tools = capturedOptions?.tools as string[];
    expect(tools).toEqual(expect.arrayContaining(['Agent', 'Task', ...DELEGATION_CONTINUATION]));
  });

  it('denying `delegation` removes spawn AND continuation, with a backstop naming every alias', async () => {
    await run({ disallowedToolGroups: ['delegation'] });
    const tools = capturedOptions?.tools as string[];
    for (const t of ['Agent', 'Task', ...DELEGATION_CONTINUATION]) expect(tools).not.toContain(t);
    expect(capturedOptions?.disallowedTools).toEqual(
      expect.arrayContaining(['Agent', 'Task', ...DELEGATION_CONTINUATION]),
    );
    // A deny removes a capability class, not unrelated tools: reads and planning stay.
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Bash', 'TodoWrite', 'ExitPlanMode']));
  });

  it('planMode does not deny delegation — a plan-mode run may still delegate its research', async () => {
    await run({ planMode: true });
    const tools = capturedOptions?.tools as string[];
    expect(tools).toEqual(expect.arrayContaining(['Agent', ...DELEGATION_CONTINUATION]));
    expect(tools).not.toContain('Bash');
    expect(tools).not.toContain('Write');
  });

  it('classifies the task inspector/stopper as `shell`, under every alias the SDK canonicalises', async () => {
    await run({ disallowedToolGroups: ['shell'] });
    const deny = capturedOptions?.disallowedTools as string[];
    expect(deny).toEqual(
      expect.arrayContaining([
        'TaskOutput',
        'BashOutput',
        'AgentOutput',
        'BashOutputTool',
        'AgentOutputTool',
        'TaskStop',
        'KillBash',
        'KillShell',
      ]),
    );
    // ...and with shell allowed they are present — previously they were stripped by
    // any deny at all, because the inventory did not know their canonical names.
    await run({ disallowedToolGroups: ['web'] });
    expect(capturedOptions?.tools).toEqual(expect.arrayContaining(['TaskOutput', 'TaskStop']));
  });

  it('keeps every known built-in with no denied capability in the residual allow-list', async () => {
    const { claudeCodeKnownBuiltins, CLAUDE_CODE_TOOL_GROUPS } = await import('./claude-code.js');
    await run({ disallowedToolGroups: ['web'] });
    const tools = new Set(capturedOptions?.tools as string[]);
    const web = new Set(CLAUDE_CODE_TOOL_GROUPS.web);
    const missing = claudeCodeKnownBuiltins().filter((t) => !web.has(t) && !tools.has(t));
    expect(missing).toEqual([]);
  });
});

describe('claude-code built-in inventory — drift guard against the pinned SDK', () => {
  it('knows every tool the SDK publishes an input schema for', async () => {
    // The residual allow-list is only correct against a COMPLETE inventory: a name the
    // inventory does not know is a gate that fails closed on it at the next deny.
    // At 0.9.11 the inventory knew 24 names against a catalog of 45. This guard fails
    // on the next pin bump that adds a tool, which is when the table must be audited.
    const { readFileSync } = await import('node:fs');
    // The package's `exports` map hides both package.json and sdk-tools.d.ts from
    // resolution, so read the installed copy by path.
    const dts = readFileSync(
      new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts', import.meta.url),
      'utf8',
    );
    const start = dts.indexOf('export type ToolInputSchemas');
    const union = dts.slice(start, dts.indexOf(';', start));
    const schemaNames = [...union.matchAll(/\|\s*(\w+)Input\b/g)].map((m) => m[1]);
    expect(schemaNames.length, 'parsed the ToolInputSchemas union').toBeGreaterThan(40);

    // Schema names that differ from the tool name the model sees.
    const TOOL_NAME: Record<string, string | null> = {
      FileRead: 'Read',
      FileEdit: 'Edit',
      FileWrite: 'Write',
      ListMcpResources: 'ListMcpResourcesTool',
      ReadMcpResource: 'ReadMcpResourceTool',
      ReadMcpResourceDir: 'ReadMcpResourceDirTool',
      // The generic MCP tool-call schema — every MCP tool is `mcp__*`, never gated by group.
      Mcp: null,
    };
    const { claudeCodeKnownBuiltins } = await import('./claude-code.js');
    const known = new Set(claudeCodeKnownBuiltins());
    const unknown = schemaNames
      .map((n) => (n in TOOL_NAME ? TOOL_NAME[n] : n))
      .filter((n): n is string => n !== null && !known.has(n));
    expect(unknown, 'add these to CLAUDE_CODE_TOOL_GROUPS or CLAUDE_CODE_UNGATED_BUILTINS').toEqual([]);
  });

  it('assigns every known built-in to at most one place', async () => {
    const { claudeCodeKnownBuiltins } = await import('./claude-code.js');
    const all = claudeCodeKnownBuiltins();
    const dupes = all.filter((t, i) => all.indexOf(t) !== i);
    expect(dupes).toEqual([]);
  });
});
