// Unit test: the peer-SDK version gate is wired into codex's execute(),
// right after the lazy import succeeds and before the SDK is used.

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
vi.mock('@openai/codex-sdk', () => {
  class FakeThread {
    async runStreamed() {
      return {
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'sdk-version-test' };
          yield { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } };
        })(),
      };
    }
  }
  class Codex {
    startThread() {
      return new FakeThread();
    }
  }
  return { Codex };
});

beforeEach(() => {
  vi.mocked(checkPeerSdkVersion).mockReset();
  process.env.OPENAI_API_KEY ??= 'test-key';
});

describe('codex peer-SDK version gate', () => {
  it('emits a non-suppressible AdapterInitError when the installed SDK version is out of range', async () => {
    vi.mocked(checkPeerSdkVersion).mockReturnValue({ status: 'mismatch', message: 'mocked mismatch reason' });
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })));

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
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })));

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    const warningEvent = events.find((e) => e.type === 'warning');
    expect(warningEvent).toMatchObject({ type: 'warning', message: 'mocked undeterminable reason' });
  });
});
