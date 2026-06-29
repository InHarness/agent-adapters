// Unit test: codex maps allowedPaths → ThreadOptions.additionalDirectories, and
// surfaces disallowedPaths as an unenforceable expressiveness limitation (the
// Codex sandbox is allow-list-only) via a one-shot warning — never throwing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

let capturedThreadOptions: Record<string, unknown> | null = null;

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
      return new FakeThread();
    }
    resumeThread(_id: string, opts: Record<string, unknown>) {
      capturedThreadOptions = opts;
      return new FakeThread();
    }
  }
  return { Codex };
});

beforeEach(() => {
  capturedThreadOptions = null;
  process.env.OPENAI_API_KEY ??= 'test-key';
});

describe('codex path scoping', () => {
  it('maps allowedPaths onto additionalDirectories', async () => {
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    await collectEvents(adapter.execute(createTestParams({ allowedPaths: ['/work/a', '/work/b'] })));
    expect(capturedThreadOptions?.additionalDirectories).toEqual(['/work/a', '/work/b']);
  });

  it('warns (without throwing) that disallowedPaths cannot be enforced', async () => {
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    const events = await collectEvents(
      adapter.execute(createTestParams({ disallowedPaths: ['/work/secret'] })),
    );
    const warning = events.find(
      (e) => e.type === 'warning' && /disallowedPaths cannot be enforced/.test((e as { message: string }).message),
    );
    expect(warning).toBeDefined();
    expect((warning as { message: string }).message).toContain('/work/secret');
    // And the run still reaches adapter_ready (no throw for "unsupported").
    expect(events.some((e) => e.type === 'adapter_ready')).toBe(true);
  });
});
