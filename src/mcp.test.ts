import { describe, it, expect, vi } from 'vitest';
import { AdapterInitError } from './types.js';

vi.mock('./sdk-version.js', () => ({
  checkPeerSdkVersion: vi.fn(() => 'mocked mismatch reason'),
}));

describe('createMcpServer peer-SDK version gate', () => {
  it('throws AdapterInitError when the installed @modelcontextprotocol/sdk version is out of range', async () => {
    const { createMcpServer } = await import('./mcp.js');
    expect(() => createMcpServer({ name: 'test-server' })).toThrow(AdapterInitError);
    try {
      createMcpServer({ name: 'test-server' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterInitError);
      expect((err as Error).message).toContain('mocked mismatch reason');
    }
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
