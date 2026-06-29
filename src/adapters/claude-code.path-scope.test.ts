// Unit tests: claude-code maps RuntimeExecuteParams.allowedPaths/disallowedPaths
// onto the SDK Options, and surfaces the runtime gate strength on `adapter_ready`.
//
// Mocks @anthropic-ai/claude-agent-sdk's `query` to capture the built `options`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { detectOsSandbox } from '../path-scope.js';

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

describe('claude-code path scoping', () => {
  it('maps allowedPaths → additionalDirectories and disallowedPaths → settings.permissions.deny', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    await collectEvents(
      adapter.execute(
        createTestParams({ allowedPaths: ['/work/a'], disallowedPaths: ['/work/a/secret'] }),
      ),
    );
    expect(capturedOptions?.additionalDirectories).toEqual(['/work/a']);
    const deny = (capturedOptions?.settings as { permissions?: { deny?: string[] } } | undefined)
      ?.permissions?.deny;
    expect(deny).toEqual(['Read(/work/a/secret/**)', 'Edit(/work/a/secret/**)']);
  });

  it('surfaces the resolved gate on adapter_ready (soft by default, no OS sandbox opt-in)', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(
      adapter.execute(createTestParams({ allowedPaths: ['/work/a'] })),
    );
    const ready = events.find((e) => e.type === 'adapter_ready') as
      | { pathScope?: { requested: boolean; strength: string } }
      | undefined;
    expect(ready?.pathScope?.requested).toBe(true);
    expect(ready?.pathScope?.strength).toBe('soft');
    // No opt-in sandbox config → the SDK sandbox is not engaged.
    expect(capturedOptions?.sandbox).toBeUndefined();
  });

  it('claude_sandbox.enabled engages the OS sandbox when available, else degrades hard→soft with a warning', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(
      adapter.execute(
        createTestParams({
          allowedPaths: ['/work/a'],
          disallowedPaths: ['/work/a/secret'],
          architectureConfig: { claude_sandbox: { enabled: true } },
        }),
      ),
    );
    const ready = events.find((e) => e.type === 'adapter_ready') as
      | { pathScope?: { strength: string } }
      | undefined;
    const downgradeWarning = events.find(
      (e) => e.type === 'warning' && /degraded hard→soft/.test((e as { message: string }).message),
    );

    if (detectOsSandbox()) {
      expect(ready?.pathScope?.strength).toBe('hard');
      const fs = (capturedOptions?.sandbox as { filesystem?: { allowWrite?: string[] } } | undefined)
        ?.filesystem;
      expect(fs?.allowWrite).toContain('/work/a');
      expect(downgradeWarning).toBeUndefined();
    } else {
      expect(ready?.pathScope?.strength).toBe('soft');
      expect(capturedOptions?.sandbox).toBeUndefined();
      expect(downgradeWarning).toBeDefined();
    }
  });
});
