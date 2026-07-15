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
  it('under a soft gate: default-deny dontAsk + allow-confinement over cwd ∪ allowedPaths + Read/Edit/Write deny', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    await collectEvents(
      adapter.execute(
        createTestParams({
          cwd: '/work',
          allowedPaths: ['/work/a'],
          disallowedPaths: ['/work/a/secret'],
        }),
      ),
    );

    // bypassPermissions is dropped for a default-deny mode — a bare deny under
    // bypassPermissions never fired (the bug this fixes).
    expect(capturedOptions?.permissionMode).toBe('dontAsk');
    expect(capturedOptions?.allowDangerouslySkipPermissions).toBeUndefined();

    // allowedPaths still widen reach so the ceiling dirs are addressable.
    expect(capturedOptions?.additionalDirectories).toEqual(['/work/a']);

    // Config-discovery containment: the global `~/.claude` ('user') tier is excluded.
    expect(capturedOptions?.settingSources).toEqual(['project', 'local']);

    const perms = (
      capturedOptions?.settings as { permissions?: { allow?: string[]; deny?: string[] } } | undefined
    )?.permissions;

    // Allow-confinement over cwd ∪ allowedPaths, covering Read/Edit/Write.
    expect(perms?.allow).toEqual([
      'Read(/work/**)',
      'Edit(/work/**)',
      'Write(/work/**)',
      'Read(/work/a/**)',
      'Edit(/work/a/**)',
      'Write(/work/a/**)',
    ]);

    // Deny for disallowedPaths now also covers Write (a new file could be created).
    expect(perms?.deny).toEqual([
      'Read(/work/a/secret/**)',
      'Edit(/work/a/secret/**)',
      'Write(/work/a/secret/**)',
    ]);
  });

  it('without path-scope: keeps bypassPermissions and sets no confinement settings', async () => {
    const ClaudeCodeAdapter = await importAdapter();
    const adapter = new ClaudeCodeAdapter();
    await collectEvents(adapter.execute(createTestParams({ cwd: '/work' })));
    expect(capturedOptions?.permissionMode).toBe('bypassPermissions');
    expect(capturedOptions?.allowDangerouslySkipPermissions).toBe(true);
    expect(capturedOptions?.settings).toBeUndefined();
    expect(capturedOptions?.settingSources).toBeUndefined();
    expect(capturedOptions?.additionalDirectories).toBeUndefined();
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
