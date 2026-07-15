// Unit test: the peer-SDK version gate is wired into claude-code's execute(),
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
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: () =>
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          usage: { input_tokens: 1, output_tokens: 1 },
          session_id: 'sess-sdk-version-test',
        };
      })(),
  };
});

beforeEach(() => {
  vi.mocked(checkPeerSdkVersion).mockReset();
});

describe('claude-code peer-SDK version gate', () => {
  it('emits a non-suppressible AdapterInitError when the installed SDK version is out of range', async () => {
    vi.mocked(checkPeerSdkVersion).mockReturnValue({ status: 'mismatch', message: 'mocked mismatch reason' });
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6' })));

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
    const { ClaudeCodeAdapter } = await import('./claude-code.js');
    const adapter = new ClaudeCodeAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'sonnet-4.6' })));

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    const warningEvent = events.find((e) => e.type === 'warning');
    expect(warningEvent).toMatchObject({ type: 'warning', message: 'mocked undeterminable reason' });
  });
});
