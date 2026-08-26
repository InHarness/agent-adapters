// Unit tests: claude-code subagent definitions (RuntimeExecuteParams.subagents).
//
// Mocks @anthropic-ai/claude-agent-sdk's `query` to capture the `options` the
// adapter builds, so we can assert that `params.subagents` is mapped onto the
// SDK's `Options.agents` (Record<name, AgentDefinition>) with the right shape,
// and that validation / capability reporting behave as documented.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { architectureCapabilities } from '../capabilities.js';
import { validateSubagents } from '../subagents.js';
import { resolveModel } from '../models.js';
import { buildClaudeCodeToolPolicy } from './claude-code.js';
import type { SubagentDefinition } from '../types.js';

// What the most recent fake `query()` call received as its `options`.
let capturedOptions: Record<string, unknown> | null = null;

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
      return (async function* () {
        yield successResult();
      })();
    },
  };
});

beforeEach(() => {
  capturedOptions = null;
});

async function importAdapter() {
  const { ClaudeCodeAdapter } = await import('./claude-code.js');
  return ClaudeCodeAdapter;
}

describe('claude-code subagent definitions', () => {
  it('maps params.subagents onto Options.agents keyed by name', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [
      {
        name: 'code-explorer',
        description: 'Read-only codebase explorer',
        prompt: 'You explore code and report findings.',
        tools: ['Read', 'Grep', 'Glob'],
        disallowedTools: ['Write'],
        model: 'sonnet',
        skills: ['my-skill'],
        maxTurns: 5,
        effort: 'high',
      },
    ];

    await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6', subagents })));

    const agents = capturedOptions?.agents as Record<string, Record<string, unknown>> | undefined;
    expect(agents).toBeDefined();
    expect(Object.keys(agents!)).toEqual(['code-explorer']);
    expect(agents!['code-explorer']).toEqual({
      description: 'Read-only codebase explorer',
      prompt: 'You explore code and report findings.',
      tools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Write'],
      model: 'sonnet', // passed through verbatim, not re-resolved
      skills: ['my-skill'],
      maxTurns: 5,
      effort: 'high',
    });
  });

  it('omits optional fields that were not provided', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [
      { name: 'minimal', description: 'd', prompt: 'p' },
    ];

    await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6', subagents })));

    const agents = capturedOptions?.agents as Record<string, Record<string, unknown>>;
    expect(agents.minimal).toEqual({ description: 'd', prompt: 'p' });
    expect(agents.minimal).not.toHaveProperty('tools');
    expect(agents.minimal).not.toHaveProperty('model');
  });

  it('does not set Options.agents when no subagents are provided', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();

    await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6' })));

    expect(capturedOptions?.agents).toBeUndefined();
  });

  it('throws via validation on duplicate subagent names', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [
      { name: 'dup', description: 'd', prompt: 'p' },
      { name: 'dup', description: 'd2', prompt: 'p2' },
    ];

    await expect(
      collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6', subagents }))),
    ).rejects.toThrow(/collision/);

    // NEITHER colliding definition may be registered — validation throws BEFORE the
    // run, so the SDK is never reached and there is no half-built `agents` map. A
    // de-duplicating implementation would have registered one of them and passed.
    expect(capturedOptions).toBeNull();
  });

  // A definition that names no `tools` under a deny-policy run inherits the run's
  // RESIDUAL allow-list — never the SDK's full default toolset. Without this, "deny
  // the shell" would mean "deny the shell until the model delegates".
  it('omitted `tools` under a deny policy inherits the run residual allow-list', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [{ name: 'helper', description: 'd', prompt: 'p' }];

    await collectEvents(
      adapter.execute(
        createTestParams({ model: 'sonnet-4.6', subagents, disallowedToolGroups: ['shell'] }),
      ),
    );

    const residual = buildClaudeCodeToolPolicy(['shell'])!;
    const agents = capturedOptions?.agents as Record<string, Record<string, unknown>>;
    expect(agents.helper.tools).toEqual(residual.allow);
    expect(agents.helper.tools).not.toContain('Bash');
    // The run's denies are PROPAGATED onto the definition — claude-code subagents do
    // not inherit them natively.
    expect(agents.helper.disallowedTools).toEqual(residual.deny);
  });

  // `tools` narrows, never widens: naming a tool from a denied group does not hand it
  // back, and it is not an error either — the intersection wins SILENTLY.
  it('a `tools` allow-list cannot restore a tool the run denied', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [
      { name: 'sneaky', description: 'd', prompt: 'p', tools: ['Read', 'Bash'] },
    ];

    await collectEvents(
      adapter.execute(
        createTestParams({ model: 'sonnet-4.6', subagents, disallowedToolGroups: ['shell'] }),
      ),
    );

    const agents = capturedOptions?.agents as Record<string, Record<string, unknown>>;
    expect(agents.sneaky.tools).toEqual(['Read']);
    expect(agents.sneaky.tools).not.toContain('Bash');
  });

  // The M15 edge case, and it works by DIFFERENT machinery than the deny-group one
  // above: under a soft path-scope there is no tool policy, so `Bash` survives into
  // the SDK's agent definition verbatim. What withholds it is the session's
  // default-deny posture — `dontAsk` pre-approves the file built-ins ONLY, so no
  // allow rule is ever generated for `Bash`, for the parent or for the subagent.
  it('a `tools` allow-list naming Bash under soft path-scope gets no shell pre-approval', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [
      { name: 'sneaky', description: 'd', prompt: 'p', tools: ['Read', 'Bash'] },
    ];

    await collectEvents(
      adapter.execute(
        createTestParams({
          model: 'sonnet-4.6',
          subagents,
          cwd: '/tmp/scope-cwd',
          allowedPaths: ['/tmp/scope-extra'],
        }),
      ),
    );

    // Default-deny, not bypassPermissions — otherwise every rule below is decorative.
    expect(capturedOptions?.permissionMode).toBe('dontAsk');
    const settings = capturedOptions?.settings as {
      permissions: { allow: string[]; deny: string[] };
    };
    expect(settings.permissions.allow.every((r) => /^(Read|Edit|Write)\(/.test(r))).toBe(true);
    expect(settings.permissions.allow.some((r) => /Bash/.test(r))).toBe(false);
    // No per-agent override may re-open the session posture.
    const agents = capturedOptions?.agents as Record<string, Record<string, unknown>>;
    expect(agents.sneaky).not.toHaveProperty('permissionMode');
  });

  // Subagent models bypass the unified model catalog BY DESIGN: a unified alias the
  // catalog knows but the SDK does not is passed through unchanged (and rejected
  // SDK-side), rather than being resolved here.
  it('passes a subagent `model` through unresolved, bypassing the catalog', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [
      { name: 'aliased', description: 'd', prompt: 'p', model: 'sonnet-4.6' },
    ];

    await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6', subagents })));

    const agents = capturedOptions?.agents as Record<string, Record<string, unknown>>;
    // Verbatim — NOT the catalog's resolved id, which is what the run's own model got.
    expect(agents.aliased.model).toBe('sonnet-4.6');
    expect(agents.aliased.model).not.toBe(resolveModel('claude-code', 'sonnet-4.6'));
    expect(capturedOptions?.model).toBe(resolveModel('claude-code', 'sonnet-4.6'));
  });

  // `skills` NAMES skills, it does not deliver them. Naming one the skills module did
  // not deliver for this adapter is not an error — the subagent starts, the skill is
  // simply absent.
  it('starts a subagent that names an undelivered skill', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const subagents: SubagentDefinition[] = [
      { name: 'skilled', description: 'd', prompt: 'p', skills: ['never-delivered'] },
    ];

    const events = await collectEvents(
      adapter.execute(createTestParams({ model: 'sonnet-4.6', subagents })),
    );

    const agents = capturedOptions?.agents as Record<string, Record<string, unknown>>;
    expect(agents.skilled.skills).toEqual(['never-delivered']);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
  });
});

describe('subagentDefinition capability', () => {
  it('is true for claude-code* and false elsewhere', () => {
    expect(architectureCapabilities('claude-code').subagentDefinition).toBe(true);
    expect(architectureCapabilities('claude-code-ollama').subagentDefinition).toBe(true);
    expect(architectureCapabilities('claude-code-minimax').subagentDefinition).toBe(true);
    expect(architectureCapabilities('codex').subagentDefinition).toBe(false);
    expect(architectureCapabilities('gemini').subagentDefinition).toBe(false);
    expect(architectureCapabilities('opencode').subagentDefinition).toBe(false);
  });

  it('defaults to false for unknown architectures', () => {
    expect(architectureCapabilities('made-up-arch' as never).subagentDefinition).toBe(false);
  });
});

describe('validateSubagents', () => {
  it('is a no-op for empty/undefined input', () => {
    expect(() => validateSubagents(undefined)).not.toThrow();
    expect(() => validateSubagents([])).not.toThrow();
  });

  it('rejects missing name/description/prompt', () => {
    expect(() => validateSubagents([{ name: '', description: 'd', prompt: 'p' }])).toThrow(/name/);
    expect(() => validateSubagents([{ name: 'a', description: '', prompt: 'p' }])).toThrow(/description/);
    expect(() => validateSubagents([{ name: 'a', description: 'd', prompt: '' }])).toThrow(/prompt/);
  });
});
