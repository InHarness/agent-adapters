// Unit test: the peer-SDK version gate is wired into gemini's execute(),
// right after the lazy import succeeds and before the missing-exports check.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterInitError } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

vi.mock('../sdk-version.js', () => ({
  checkPeerSdkVersion: vi.fn(() => 'mocked mismatch reason'),
}));

beforeEach(() => {
  process.env.GOOGLE_API_KEY ??= 'test-key';
});

describe('gemini peer-SDK version gate', () => {
  it('emits a non-suppressible AdapterInitError when the installed SDK version is out of range', async () => {
    const { GeminiAdapter } = await import('./gemini.js');
    const adapter = new GeminiAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'gemini-2.5-pro' })));

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toMatchObject({ type: 'error', phase: 'init' });
    const err = (errorEvent as { error: unknown }).error;
    expect(err).toBeInstanceOf(AdapterInitError);
    expect((err as Error).message).toContain('mocked mismatch reason');
  });
});
