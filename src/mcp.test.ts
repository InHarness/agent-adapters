import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterInitError } from './types.js';
import { checkPeerSdkVersion } from './sdk-version.js';

vi.mock('./sdk-version.js', () => ({
  checkPeerSdkVersion: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(checkPeerSdkVersion).mockReset();
});

describe('createMcpServer peer-SDK version gate', () => {
  it('throws AdapterInitError when the installed @modelcontextprotocol/sdk version is out of range', async () => {
    vi.mocked(checkPeerSdkVersion).mockReturnValue({ status: 'mismatch', message: 'mocked mismatch reason' });
    const { createMcpServer } = await import('./mcp.js');
    try {
      createMcpServer({ name: 'test-server' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterInitError);
      expect((err as Error).message).toContain('mocked mismatch reason');
    }
  });

  it('proceeds (no throw) when the installed version cannot be determined — no event stream to warn through', async () => {
    vi.mocked(checkPeerSdkVersion).mockReturnValue({
      status: 'undeterminable',
      message: 'mocked undeterminable reason',
    });
    const { createMcpServer } = await import('./mcp.js');
    const { config } = createMcpServer({ name: 'test-server' });
    expect(config).toMatchObject({ type: 'sdk', name: 'test-server' });
  });
});

describe('createMcpServer (real install, in-range)', () => {
  it('builds a server successfully when no mismatch is mocked', async () => {
    vi.resetModules();
    vi.doUnmock('./sdk-version.js');
    const { createMcpServer } = await import('./mcp.js');
    const { config } = createMcpServer({ name: 'test-server' });
    expect(config).toMatchObject({ type: 'sdk', name: 'test-server' });
  });
});
