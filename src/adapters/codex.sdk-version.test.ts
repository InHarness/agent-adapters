// Unit test: the peer-SDK version gate is wired into codex's execute(),
// right after the lazy import succeeds and before the SDK is used.

import { describe, it, expect, vi } from 'vitest';
import { AdapterInitError } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

vi.mock('../sdk-version.js', () => ({
  checkPeerSdkVersion: vi.fn(() => 'mocked mismatch reason'),
}));

describe('codex peer-SDK version gate', () => {
  it('emits a non-suppressible AdapterInitError when the installed SDK version is out of range', async () => {
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })));

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toMatchObject({ type: 'error', phase: 'init' });
    const err = (errorEvent as { error: unknown }).error;
    expect(err).toBeInstanceOf(AdapterInitError);
    expect((err as Error).message).toContain('mocked mismatch reason');
  });
});
