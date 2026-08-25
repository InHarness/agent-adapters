// Unit tests: codex maps M18 deny-groups onto the only two primitives
// `ThreadOptions` offers — the whole-run `sandboxMode` posture and the
// web-search toggle — and REFUSES `shell` / `file-read`, which it cannot
// express at all. This is codex's one fail-closed exception to its usual
// warn-and-degrade posture.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { AdapterToolPolicyError } from '../types.js';
import type { UnifiedEvent } from '../types.js';

let capturedThreadOptions: Record<string, unknown> | null = null;
let threadsStarted = 0;

vi.mock('@openai/codex-sdk', () => {
  class FakeThread {
    async runStreamed(_prompt: string, _opts: unknown) {
      return { events: (async function* () {})() };
    }
  }
  class Codex {
    constructor(_opts: unknown) {}
    startThread(opts: Record<string, unknown>) {
      capturedThreadOptions = opts;
      threadsStarted += 1;
      return new FakeThread();
    }
    resumeThread(_id: string, opts: Record<string, unknown>) {
      capturedThreadOptions = opts;
      threadsStarted += 1;
      return new FakeThread();
    }
  }
  return { Codex };
});

beforeEach(() => {
  capturedThreadOptions = null;
  threadsStarted = 0;
  process.env.OPENAI_API_KEY ??= 'test-key';
});

async function run(params: Parameters<typeof createTestParams>[0]): Promise<UnifiedEvent[]> {
  const { CodexAdapter } = await import('./codex.js');
  return collectEvents(new CodexAdapter().execute(createTestParams(params)));
}

describe('codex tool gating — what it can express', () => {
  it('maps file-write onto the read-only sandbox posture', async () => {
    await run({ disallowedToolGroups: ['file-write'] });
    expect(capturedThreadOptions?.sandboxMode).toBe('read-only');
  });

  it('maps web onto the SDK web-search toggle, setting both spellings', async () => {
    await run({ disallowedToolGroups: ['web'] });
    expect(capturedThreadOptions?.webSearchMode).toBe('disabled');
    expect(capturedThreadOptions?.webSearchEnabled).toBe(false);
  });

  it('leaves the web toggle untouched when web is not denied', async () => {
    await run({});
    expect(capturedThreadOptions?.webSearchMode).toBeUndefined();
    expect(capturedThreadOptions?.webSearchEnabled).toBeUndefined();
  });

  it('defaults to workspace-write when nothing is denied (byte-for-byte no-op)', async () => {
    await run({});
    expect(capturedThreadOptions?.sandboxMode).toBe('workspace-write');
  });
});

// Three inputs land on the single `sandboxMode` field. They compose by
// NARROWEST WINS and the field is assigned exactly once — never written twice
// and overwritten.
describe('codex tool gating — sandboxMode composes narrowest-wins', () => {
  it('an M18 file-write deny narrows a consumer workspace-write', async () => {
    await run({
      disallowedToolGroups: ['file-write'],
      architectureConfig: { codex_sandboxMode: 'workspace-write' },
    });
    expect(capturedThreadOptions?.sandboxMode).toBe('read-only');
  });

  it('a consumer read-only survives when M18 asks for nothing', async () => {
    await run({ architectureConfig: { codex_sandboxMode: 'read-only' } });
    expect(capturedThreadOptions?.sandboxMode).toBe('read-only');
  });

  it('allowedPaths still extend additionalDirectories alongside a deny', async () => {
    await run({ disallowedToolGroups: ['file-write'], allowedPaths: ['/work/a'] });
    expect(capturedThreadOptions?.additionalDirectories).toEqual(['/work/a']);
    expect(capturedThreadOptions?.sandboxMode).toBe('read-only');
  });
});

describe('codex tool gating — refusal is total and pre-dispatch', () => {
  it.each(['shell', 'file-read'] as const)(
    'refuses %s, which ThreadOptions cannot express at all',
    async (group) => {
      const events = await run({ disallowedToolGroups: [group] });
      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBeInstanceOf(AdapterToolPolicyError);
      expect(errors[0].phase).toBe('init');
      // Nothing was dispatched — no thread was ever started.
      expect(threadsStarted).toBe(0);
      expect(events.some((e) => e.type === 'result')).toBe(false);
      expect(events.some((e) => e.type === 'adapter_ready')).toBe(false);
    },
  );

  // No partial application: the enforceable half of the request must not be
  // applied on its own.
  it('does not apply the enforceable remainder of a refused request', async () => {
    await run({ disallowedToolGroups: ['file-write', 'shell'] });
    expect(threadsStarted).toBe(0);
    expect(capturedThreadOptions).toBeNull();
  });

  // planMode desugars into ['file-write','shell'] — so it now refuses here,
  // rather than silently delivering a read-only sandbox with a live shell.
  it('refuses planMode: true instead of half-honouring it', async () => {
    const events = await run({ planMode: true });
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0].error as AdapterToolPolicyError).unenforceable).toEqual(['shell']);
    expect(threadsStarted).toBe(0);
  });

  it('does not throw out of the iterator', async () => {
    await expect(run({ planMode: true })).resolves.toBeDefined();
  });
});

describe('codex tool gating — degradation warnings', () => {
  it('warns once that a file-write deny is not a filesystem boundary', async () => {
    const events = await run({ disallowedToolGroups: ['file-write'] });
    expect(
      events.filter((e) => e.type === 'warning' && /not a filesystem boundary/i.test(e.message)),
    ).toHaveLength(1);
  });

  it('warns once that autoApproveTools has no primitive here', async () => {
    const events = await run({ autoApproveTools: ['Bash'] });
    expect(
      events.filter((e) => e.type === 'warning' && /autoApproveTools/.test(e.message)),
    ).toHaveLength(1);
  });

  it('says nothing about autoApproveTools when the field is absent', async () => {
    const events = await run({});
    expect(events.filter((e) => e.type === 'warning' && /autoApproveTools/.test(e.message))).toEqual([]);
  });
});
