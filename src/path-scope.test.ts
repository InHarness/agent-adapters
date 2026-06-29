import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  normalizePaths,
  isPathScopeRequested,
  detectOsSandbox,
  probePathScope,
  getClaudeSandboxConfig,
} from './path-scope.js';

describe('normalizePaths', () => {
  it('passes absolute paths through unchanged', () => {
    expect(normalizePaths(['/work/a', '/work/b'], '/cwd')).toEqual(['/work/a', '/work/b']);
  });

  it('resolves relative entries against cwd (normalized, not rejected)', () => {
    expect(normalizePaths(['sub', '../sibling'], '/cwd')).toEqual([
      resolve('/cwd', 'sub'),
      resolve('/cwd', '../sibling'),
    ]);
  });

  it('returns [] for undefined or empty input', () => {
    expect(normalizePaths(undefined, '/cwd')).toEqual([]);
    expect(normalizePaths([], '/cwd')).toEqual([]);
  });
});

describe('isPathScopeRequested', () => {
  it('is false when both fields are absent or empty', () => {
    expect(isPathScopeRequested({})).toBe(false);
    expect(isPathScopeRequested({ allowedPaths: [], disallowedPaths: [] })).toBe(false);
  });

  it('is true when either field is non-empty', () => {
    expect(isPathScopeRequested({ allowedPaths: ['/a'] })).toBe(true);
    expect(isPathScopeRequested({ disallowedPaths: ['/a'] })).toBe(true);
  });
});

describe('getClaudeSandboxConfig', () => {
  it('reads claude_sandbox object from architectureConfig', () => {
    expect(getClaudeSandboxConfig({ claude_sandbox: { enabled: true } })).toEqual({ enabled: true });
  });

  it('ignores missing / non-object values', () => {
    expect(getClaudeSandboxConfig(undefined)).toBeUndefined();
    expect(getClaudeSandboxConfig({})).toBeUndefined();
    expect(getClaudeSandboxConfig({ claude_sandbox: 'nope' })).toBeUndefined();
    expect(getClaudeSandboxConfig({ claude_sandbox: ['arr'] })).toBeUndefined();
  });
});

describe('detectOsSandbox', () => {
  it('returns a boolean for the current host', () => {
    expect(typeof detectOsSandbox()).toBe('boolean');
  });
});

describe('probePathScope', () => {
  it('is a no-op when nothing is requested (backward compatible)', () => {
    const scope = probePathScope('claude-code', { cwd: '/cwd' });
    expect(scope).toEqual({
      requested: false,
      allowed: [],
      disallowed: [],
      strength: 'none',
      unenforceable: [],
    });
  });

  it('normalizes paths and records the precedence inputs (allowed + disallowed)', () => {
    const scope = probePathScope('claude-code', {
      cwd: '/cwd',
      allowedPaths: ['/work', 'rel'],
      disallowedPaths: ['/work/secret'],
    });
    expect(scope.requested).toBe(true);
    expect(scope.allowed).toEqual(['/work', resolve('/cwd', 'rel')]);
    expect(scope.disallowed).toEqual(['/work/secret']);
  });

  it('claude-code defaults to a soft gate without an OS sandbox opt-in', () => {
    const scope = probePathScope('claude-code', { cwd: '/cwd', allowedPaths: ['/work'] });
    expect(scope.strength).toBe('soft');
  });

  it('claude-code with claude_sandbox.enabled is hard iff the host has an OS sandbox', () => {
    const scope = probePathScope('claude-code', {
      cwd: '/cwd',
      allowedPaths: ['/work'],
      architectureConfig: { claude_sandbox: { enabled: true } },
    });
    expect(scope.strength).toBe(detectOsSandbox() ? 'hard' : 'soft');
  });

  it('codex is a hard (OS) gate but cannot enforce disallowedPaths', () => {
    const scope = probePathScope('codex', {
      cwd: '/cwd',
      allowedPaths: ['/work'],
      disallowedPaths: ['/work/secret'],
    });
    expect(scope.strength).toBe('hard');
    expect(scope.unenforceable).toEqual(['/work/secret']);
  });

  it('gemini is a soft gate and surfaces disallowedPaths as unenforceable', () => {
    const scope = probePathScope('gemini', {
      cwd: '/cwd',
      allowedPaths: ['/work'],
      disallowedPaths: ['/work/secret'],
    });
    expect(scope.strength).toBe('soft');
    expect(scope.unenforceable).toEqual(['/work/secret']);
  });

  it('opencode has no native gate (strength none) even when requested', () => {
    const scope = probePathScope('opencode', { cwd: '/cwd', allowedPaths: ['/work'] });
    expect(scope.requested).toBe(true);
    expect(scope.strength).toBe('none');
  });

  it('unknown architectures fall back to no enforcement', () => {
    const scope = probePathScope('does-not-exist', { cwd: '/cwd', allowedPaths: ['/work'] });
    expect(scope.strength).toBe('none');
  });
});
