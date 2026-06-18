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
