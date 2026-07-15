// Unit test: the peer-SDK version gate is wired into opencode's execute(),
// right after both lazy imports (v1 + v2 client) succeed and before either is used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterInitError } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

vi.mock('../sdk-version.js', () => ({
  checkPeerSdkVersion: vi.fn(() => 'mocked mismatch reason'),
}));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY ??= 'test-key';
});

describe('opencode peer-SDK version gate', () => {
  it('emits a non-suppressible AdapterInitError when the installed SDK version is out of range', async () => {
    const { OpencodeAdapter } = await import('./opencode.js');
    const adapter = new OpencodeAdapter();
    const events = await collectEvents(
      adapter.execute(createTestParams({ model: 'openrouter/anthropic/claude-sonnet-4' })),
    );

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toMatchObject({ type: 'error', phase: 'init' });
    const err = (errorEvent as { error: unknown }).error;
    expect(err).toBeInstanceOf(AdapterInitError);
    expect((err as Error).message).toContain('mocked mismatch reason');
  });
});
