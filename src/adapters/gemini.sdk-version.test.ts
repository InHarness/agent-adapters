// Unit test: the peer-SDK version gate is wired into gemini's execute(),
// right after the lazy import succeeds and before the missing-exports check.

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
vi.mock('@google/gemini-cli-core', () => {
  class Config {
    storage = { getProjectTempDir: () => '/tmp/sdk-version-test' };
    async initialize() {}
    async refreshAuth() {}
  }
  class GeminiClient {
    async initialize() {}
    async resumeChat() {}
  }
  class LegacyAgentSession {
    async *sendStream() {
      yield {
        id: 'evt-1',
        type: 'agent_end',
        streamId: 'stream-1',
        timestamp: new Date(0).toISOString(),
        reason: 'completed',
      };
    }
    async abort() {}
  }
  return {
    Config,
    GeminiClient,
    LegacyAgentSession,
    AuthType: { USE_GEMINI: 'gemini-api-key' },
    MCPServerConfig: class {},
    MessageBusType: {},
    ToolConfirmationOutcome: {},
  };
});

beforeEach(() => {
  vi.mocked(checkPeerSdkVersion).mockReset();
  process.env.GOOGLE_API_KEY ??= 'test-key';
});

describe('gemini peer-SDK version gate', () => {
  it('emits a non-suppressible AdapterInitError when the installed SDK version is out of range', async () => {
    vi.mocked(checkPeerSdkVersion).mockReturnValue({ status: 'mismatch', message: 'mocked mismatch reason' });
    const { GeminiAdapter } = await import('./gemini.js');
    const adapter = new GeminiAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'gemini-2.5-pro' })));

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
    const { GeminiAdapter } = await import('./gemini.js');
    const adapter = new GeminiAdapter();
    const events = await collectEvents(adapter.execute(createTestParams({ model: 'gemini-2.5-pro' })));

    const versionErrorEvent = events.find(
      (e) => e.type === 'error' && (e as { error: Error }).error.message.includes('mocked'),
    );
    expect(versionErrorEvent).toBeUndefined();
    const warningEvent = events.find((e) => e.type === 'warning' && (e as { message: string }).message.includes('mocked'));
    expect(warningEvent).toMatchObject({ type: 'warning', message: 'mocked undeterminable reason' });
  });
});
