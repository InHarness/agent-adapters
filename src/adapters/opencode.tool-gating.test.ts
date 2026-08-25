// Unit tests: opencode derives SERVER-SIDE permission buckets from M18
// deny-groups instead of asserting a blanket allow.
//
// Bucket-name correctness is the whole game here. The server's permission
// schema ends in a catch-all, so a mistyped bucket is accepted and silently
// ignored with NO validation error — a typo would not fail, it would quietly
// enforce nothing. These tests pin the names against the vocabulary confirmed
// in the running opencode 1.4.6 server.

import { describe, it, expect } from 'vitest';
import { buildOpencodePermissions } from './opencode.js';
import { PLAN_MODE_DENY_GROUPS, TOOL_GROUPS } from '../tool-groups.js';

// Confirmed against the opencode 1.4.6 binary, whose own read-only agent preset
// is `{"*":"deny", grep, glob, list, bash, webfetch, websearch, codesearch,
// read, external_directory}`. A bucket outside this set is silently ignored.
const SERVER_BUCKETS = new Set([
  '*',
  'read',
  'grep',
  'glob',
  'list',
  'codesearch',
  'bash',
  'edit',
  'write',
  'patch',
  'webfetch',
  'websearch',
  'task',
  'todowrite',
  'doom_loop',
  'external_directory',
]);

describe('opencode permission derivation', () => {
  it('keeps the pre-M18 blanket allow when nothing is denied (byte-for-byte no-op)', () => {
    expect(buildOpencodePermissions([])).toEqual({ edit: 'allow', bash: 'allow' });
  });

  it('switches to a wildcard default the moment anything is denied', () => {
    expect(buildOpencodePermissions(['web'])['*']).toBe('allow');
  });

  it('denies the shell bucket for shell', () => {
    expect(buildOpencodePermissions(['shell']).bash).toBe('deny');
  });

  it('denies every write bucket for file-write', () => {
    const p = buildOpencodePermissions(['file-write']);
    for (const bucket of ['edit', 'write', 'patch']) expect(p[bucket]).toBe('deny');
  });

  it('denies both web buckets for web', () => {
    const p = buildOpencodePermissions(['web']);
    expect(p.webfetch).toBe('deny');
    expect(p.websearch).toBe('deny');
  });

  // file-read must cover the file, listing, search and code-search buckets —
  // and the DELEGATION bucket, or reads get laundered through a subagent.
  it('denies the file, listing and search buckets for file-read', () => {
    const p = buildOpencodePermissions(['file-read']);
    for (const bucket of ['read', 'list', 'grep', 'glob', 'codesearch']) {
      expect(p[bucket], bucket).toBe('deny');
    }
  });

  it('denies the delegation bucket too, so a subagent cannot launder the reads', () => {
    expect(buildOpencodePermissions(['file-read']).task).toBe('deny');
  });

  it('leaves untouched groups to the wildcard rather than denying them', () => {
    const p = buildOpencodePermissions(['shell']);
    expect(p.read).toBeUndefined();
    expect(p.edit).toBeUndefined();
  });

  it('enforces the plan-mode preset (writes and shell), leaving reads and web alone', () => {
    const p = buildOpencodePermissions([...PLAN_MODE_DENY_GROUPS]);
    expect(p.bash).toBe('deny');
    expect(p.edit).toBe('deny');
    expect(p.read).toBeUndefined();
    expect(p.webfetch).toBeUndefined();
  });

  // The silent-ignore escape surface makes this assertion load-bearing rather
  // than cosmetic: an unrecognised bucket name enforces nothing at all.
  it('emits only bucket names the running server actually consumes', () => {
    const p = buildOpencodePermissions([...TOOL_GROUPS]);
    for (const bucket of Object.keys(p)) {
      expect(SERVER_BUCKETS.has(bucket), `unknown bucket "${bucket}" would be silently ignored`).toBe(true);
    }
  });

  it('covers every group in the vocabulary — no group maps to an empty bucket set', () => {
    for (const group of TOOL_GROUPS) {
      const p = buildOpencodePermissions([group]);
      expect(Object.keys(p).filter((k) => k !== '*').length, group).toBeGreaterThan(0);
    }
  });
});
