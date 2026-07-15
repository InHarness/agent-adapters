// Unit test: the peer-SDK version gate is wired into opencode's execute(),
// right after both lazy imports (v1 + v2 client) succeed and before either is used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterInitError } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { checkPeerSdkVersion } from '../sdk-version.js';

vi.mock('../sdk-version.js', () => ({
  checkPeerSdkVersion: vi.fn(),
}));

// Only exercised by the 'undeterminable' test below, which proceeds past the gate —
// stub the real SDK so it doesn't attempt a live call.
vi.mock('@opencode-ai/sdk', () => {
  const fakeClient = {
    session: {
      create: vi.fn(async () => ({ data: { id: 'sdk-version-test-session' } })),
      promptAsync: vi.fn(async () => undefined),
    },
    event: {
      subscribe: vi.fn(async () => ({ stream: (async function* () {})() })),
    },
  };
  return {
    createOpencode: vi.fn(async () => ({
      client: fakeClient,
      server: { close: () => undefined },
    })),
  };
});

vi.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: vi.fn(() => ({
    event: { subscribe: async () => ({ stream: (async function* () {})() }) },
    question: { reply: async () => undefined, reject: async () => undefined },
  })),
}));

beforeEach(() => {
  vi.mocked(checkPeerSdkVersion).mockReset();
  process.env.OPENROUTER_API_KEY ??= 'test-key';
});

describe('opencode peer-SDK version gate', () => {
  it('emits a non-suppressible AdapterInitError when the installed SDK version is out of range', async () => {
    vi.mocked(checkPeerSdkVersion).mockReturnValue({ status: 'mismatch', message: 'mocked mismatch reason' });
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

  it('degrades to a warning and proceeds when the installed version cannot be determined', async () => {
    vi.mocked(checkPeerSdkVersion).mockReturnValue({
      status: 'undeterminable',
      message: 'mocked undeterminable reason',
    });
    const { OpencodeAdapter } = await import('./opencode.js');
    const adapter = new OpencodeAdapter();
    const events = await collectEvents(
      adapter.execute(createTestParams({ model: 'openrouter/anthropic/claude-sonnet-4' })),
    );

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    const warningEvent = events.find((e) => e.type === 'warning');
    expect(warningEvent).toMatchObject({ type: 'warning', message: 'mocked undeterminable reason' });
  });
});
