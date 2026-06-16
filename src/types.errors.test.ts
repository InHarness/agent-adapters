// Unit tests for AdapterError/AdapterInitError reporting: the message and OS
// fields (code/path/syscall) must survive JSON serialization, since consumers
// stream errors over SSE via JSON.stringify and Error.message is non-enumerable.

import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { AdapterError, AdapterInitError } from './types.js';

describe('AdapterInitError', () => {
  it('surfaces message + OS fields through JSON.stringify (bridge-stripped cause)', () => {
    // Reproduces the user-reported shape: a cause that crossed a bridge and
    // arrived as a bare object with no Error prototype, no message, no path.
    const cause = { errno: -17, code: 'EEXIST', syscall: 'open' };
    const err = new AdapterInitError('claude-code', cause);

    const wire = JSON.parse(JSON.stringify({ type: 'error', error: err, phase: 'init' }));

    expect(wire.error.name).toBe('AdapterInitError');
    expect(wire.error.adapter).toBe('claude-code');
    expect(wire.error.code).toBe('EEXIST');
    expect(wire.error.errno).toBe(-17);
    expect(wire.error.syscall).toBe('open');
    // The message — previously lost in serialization — is now present and actionable.
    expect(wire.error.message).toContain('EEXIST');
    expect(wire.error.message).toContain('Failed to initialize claude-code adapter');
    expect(wire.error.message.toLowerCase()).toContain('leftover file already exists');
  });

  it('includes the filesystem path in message + payload when present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-adapters-errtest-'));
    const target = join(dir, 'collide');
    await writeFile(target, 'first', 'utf8');

    let caught: unknown;
    try {
      // Exclusive create over an existing file → real Node EEXIST on `open`.
      await writeFile(target, 'second', { flag: 'wx' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();

    const err = new AdapterInitError('claude-code', caught);
    expect(err.code).toBe('EEXIST');
    expect(err.path).toBe(target);
    expect(err.message).toContain(target);

    const wire = JSON.parse(JSON.stringify(err));
    expect(wire.path).toBe(target);
    expect(wire.message).toContain(target);
  });

  it('gives code-specific hints', () => {
    expect(new AdapterInitError('codex', { code: 'EACCES', syscall: 'open' }).message).toContain(
      'permission denied',
    );
    expect(new AdapterInitError('codex', { code: 'EROFS' }).message).toContain('read-only');
    expect(new AdapterInitError('codex', { code: 'ENOSPC' }).message).toContain('no space left');
  });

  it('falls back to the plain message when the cause is not a system error', () => {
    const err = new AdapterInitError('gemini', new Error('boom'));
    expect(err.message).toBe('Failed to initialize gemini adapter: boom');
    expect(err.code).toBeUndefined();
    // No code → no OS fields leak into the payload.
    const wire = JSON.parse(JSON.stringify(err));
    expect(wire.code).toBeUndefined();
    expect(wire.path).toBeUndefined();
  });

  it('handles a bare adapter init failure with no cause', () => {
    const err = new AdapterInitError('opencode');
    expect(err.message).toBe('Failed to initialize opencode adapter');
  });
});

describe('AdapterError', () => {
  it('exposes a serialization-safe toJSON without dumping the raw cause object', () => {
    const err = new AdapterError('wrapped', 'claude-code', {
      code: 'EEXIST',
      errno: -17,
      syscall: 'open',
      path: '/tmp/x',
    });
    const wire = JSON.parse(JSON.stringify(err));
    expect(wire).toEqual({
      name: 'AdapterError',
      message: 'wrapped',
      adapter: 'claude-code',
      code: 'EEXIST',
      errno: -17,
      syscall: 'open',
      path: '/tmp/x',
    });
    // The original cause is still available for programmatic access.
    expect((err.cause as { path: string }).path).toBe('/tmp/x');
  });
});
