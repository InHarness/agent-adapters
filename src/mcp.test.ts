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

describe('one SDK MCP server instance per run', () => {
  // Protocol.connect() throws "Already connected to a transport" on a server that is
  // already bound to one. The Agent SDK swallows that rejection into a debug log and
  // still advertises the server, so every later mcp_message fails with "SDK MCP server
  // not found" and the CLI renders each call as `(<tool> completed with no output)` —
  // the same silent signature as a severed control channel, from a different cause.
  // Catching it at claim time is the only place the message can still name what broke.
  it('rejects a second concurrent claim on the same instance, naming the server', async () => {
    const { claimSdkMcpInstances, releaseSdkMcpInstances, mcpInstanceReuseError } = await import('./mcp.js');
    const instance = { marker: 'live server' };
    const servers = { tools: { type: 'sdk' as const, name: 'tools', instance } };

    const first = claimSdkMcpInstances(servers);
    expect(first.ok).toBe(true);

    const second = claimSdkMcpInstances(servers);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.conflictingServer).toBe('tools');
    expect(mcpInstanceReuseError('claude-code', 'tools').message).toContain('"tools"');

    // Sequential reuse is FINE — the previous run released its transport. Only an
    // overlap is the bug, so the claim must not be a permanent mark on the instance.
    releaseSdkMcpInstances(first.ok ? first.claimed : []);
    expect(claimSdkMcpInstances(servers).ok).toBe(true);
    releaseSdkMcpInstances([instance]);
  });

  it('claims all-or-nothing, so a conflict cannot strand an unrelated server', async () => {
    const { claimSdkMcpInstances, releaseSdkMcpInstances } = await import('./mcp.js');
    const shared = { marker: 'shared' };
    const solo = { marker: 'solo' };

    const held = claimSdkMcpInstances({ shared: { type: 'sdk', name: 'shared', instance: shared } });
    // `solo` is claimed first and `shared` conflicts — `solo` must be given back.
    const attempt = claimSdkMcpInstances({
      solo: { type: 'sdk', name: 'solo', instance: solo },
      shared: { type: 'sdk', name: 'shared', instance: shared },
    });
    expect(attempt.ok).toBe(false);

    const soloOnly = claimSdkMcpInstances({ solo: { type: 'sdk', name: 'solo', instance: solo } });
    expect(soloOnly.ok, 'a failed claim must leave nothing behind').toBe(true);

    releaseSdkMcpInstances(held.ok ? held.claimed : []);
    releaseSdkMcpInstances(soloOnly.ok ? soloOnly.claimed : []);
  });

  it('ignores non-sdk server types — they carry no shared live object', async () => {
    const { claimSdkMcpInstances } = await import('./mcp.js');
    const stdio = { stdio: { type: 'stdio' as const, command: 'x' } };
    expect(claimSdkMcpInstances(stdio).ok).toBe(true);
    expect(claimSdkMcpInstances(stdio).ok).toBe(true);
    expect(claimSdkMcpInstances(undefined).ok).toBe(true);
  });
});
