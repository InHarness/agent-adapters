// Unit tests: the M18 group vocabulary, the plan-mode preset, the pre-dispatch
// gate and the per-adapter strength matrix. Pure-function level — no SDK calls.

import { describe, it, expect } from 'vitest';
import {
  TOOL_GROUPS,
  PLAN_MODE_DENY_GROUPS,
  resolveDeniedGroups,
  probeToolGating,
  checkToolPolicy,
  isPorousCombination,
  type ToolGroup,
} from './tool-groups.js';
import { AdapterToolPolicyError } from './types.js';

const ADAPTERS = ['claude-code', 'codex', 'opencode', 'gemini'] as const;

describe('resolveDeniedGroups', () => {
  it('is a no-op when nothing is requested (backward compatible)', () => {
    expect(resolveDeniedGroups({})).toEqual({ groups: [], unknown: [], requested: false });
  });

  it('treats an explicit empty array as a request for nothing — the documented plan-mode opt-out', () => {
    expect(resolveDeniedGroups({ disallowedToolGroups: [] })).toEqual({
      groups: [],
      unknown: [],
      requested: false,
    });
  });

  it('desugars planMode into the preset', () => {
    expect(resolveDeniedGroups({ planMode: true }).groups).toEqual([...PLAN_MODE_DENY_GROUPS].sort(byCanonicalOrder));
  });

  // A preset can never be weakened by omitting its groups: the two sets are
  // UNIONED, not replaced.
  it('unions preset-derived and explicitly requested groups', () => {
    const { groups } = resolveDeniedGroups({ planMode: true, disallowedToolGroups: ['web'] });
    expect(new Set(groups)).toEqual(new Set(['file-write', 'shell', 'web']));
  });

  it('cannot be weakened by naming fewer groups than the preset', () => {
    const { groups } = resolveDeniedGroups({ planMode: true, disallowedToolGroups: ['file-write'] });
    expect(new Set(groups)).toEqual(new Set(['file-write', 'shell']));
  });

  it('collapses duplicates and ignores order', () => {
    const a = resolveDeniedGroups({ disallowedToolGroups: ['web', 'shell', 'web'] });
    const b = resolveDeniedGroups({ disallowedToolGroups: ['shell', 'web'] });
    expect(a.groups).toEqual(b.groups);
    expect(a.groups.length).toBe(2);
  });

  it('separates unknown strings instead of silently dropping them', () => {
    const { groups, unknown } = resolveDeniedGroups({
      disallowedToolGroups: ['shell', 'netwrok' as ToolGroup],
    });
    expect(groups).toEqual(['shell']);
    expect(unknown).toEqual(['netwrok']);
  });
});

describe('probeToolGating', () => {
  it('returns one record per requested group', () => {
    const out = probeToolGating('claude-code', ['shell', 'web']);
    expect(out.map((r) => r.group)).toEqual(['shell', 'web']);
  });

  it('collapses duplicates', () => {
    expect(probeToolGating('claude-code', ['shell', 'shell'])).toHaveLength(1);
  });

  it('reports codex shell and file-read as unenforceable (no primitive at all)', () => {
    for (const group of ['shell', 'file-read'] as const) {
      const [report] = probeToolGating('codex', [group]);
      expect(report.enforceable).toBe(false);
      expect(report.strength).toBe('none');
    }
  });

  it('reports codex file-write and web as hard (OS posture / SDK toggle)', () => {
    for (const group of ['file-write', 'web'] as const) {
      const [report] = probeToolGating('codex', [group]);
      expect(report.enforceable).toBe(true);
      expect(report.strength).toBe('hard');
    }
  });

  it('caps every gemini group at soft — excludeTools has no allow-list counterpart', () => {
    for (const report of probeToolGating('gemini', [...TOOL_GROUPS])) {
      expect(report.strength).toBe('soft');
      expect(report.escapeSurfaces.length).toBeGreaterThan(0);
    }
  });

  it('reports opencode as hard across the board (server-side refusal, verified buckets)', () => {
    for (const report of probeToolGating('opencode', [...TOOL_GROUPS])) {
      expect(report.strength).toBe('hard');
    }
  });

  it('reports claude-code as soft across the board — a catalog gate is not a sandbox', () => {
    for (const report of probeToolGating('claude-code', [...TOOL_GROUPS])) {
      expect(report.strength).toBe('soft');
    }
  });

  it('unknown architectures fall back to no enforcement', () => {
    for (const report of probeToolGating('does-not-exist', [...TOOL_GROUPS])) {
      expect(report.enforceable).toBe(false);
      expect(report.strength).toBe('none');
    }
  });

  // The invariant that makes the strength axis trustworthy: a documented hole
  // means the gate is a model-behaviour gate at best, never a sandbox.
  it('never reports a group as hard when it has a documented escape surface', () => {
    for (const arch of [...ADAPTERS, 'claude-code-ollama', 'opencode-openrouter']) {
      for (const report of probeToolGating(arch, [...TOOL_GROUPS])) {
        if (report.escapeSurfaces.length > 0) {
          expect(report.strength, `${arch}/${report.group}`).not.toBe('hard');
        }
      }
    }
  });

  it('names the surface rather than merely flagging it', () => {
    for (const report of probeToolGating('gemini', [...TOOL_GROUPS])) {
      for (const surface of report.escapeSurfaces) {
        expect(typeof surface).toBe('string');
        expect(surface.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('checkToolPolicy (the pre-dispatch gate)', () => {
  it('permits a run that requested nothing', () => {
    for (const arch of ADAPTERS) expect(checkToolPolicy(arch, {})).toBeUndefined();
  });

  it('permits every enforceable group', () => {
    expect(checkToolPolicy('opencode', { disallowedToolGroups: [...TOOL_GROUPS] })).toBeUndefined();
  });

  it('refuses a group with no primitive, carrying which ones', () => {
    const err = checkToolPolicy('codex', { disallowedToolGroups: ['shell', 'web'] });
    expect(err).toBeInstanceOf(AdapterToolPolicyError);
    expect(err!.unenforceable).toEqual(['shell']);
    expect(err!.enforceable).toEqual([{ group: 'web', strength: 'hard' }]);
  });

  // No partial application: the refusal is total, so the caller can never run
  // with only some of the requested policy in force.
  it('refuses the whole run rather than applying the enforceable remainder', () => {
    const err = checkToolPolicy('codex', { disallowedToolGroups: ['file-write', 'shell'] });
    expect(err).toBeDefined();
    expect(err!.enforceable.map((e) => e.group)).toEqual(['file-write']);
  });

  it('refuses an unknown group string rather than dropping it', () => {
    const err = checkToolPolicy('opencode', {
      disallowedToolGroups: ['shell', 'sehll' as ToolGroup],
    });
    expect(err).toBeInstanceOf(AdapterToolPolicyError);
    expect(err!.unknownGroups).toEqual(['sehll']);
  });

  // planMode desugars into ['file-write','shell'], and codex has no shell
  // primitive — so plan mode refuses there instead of silently delivering a
  // read-only sandbox with a live shell.
  it('makes planMode refuse on codex', () => {
    const err = checkToolPolicy('codex', { planMode: true });
    expect(err).toBeInstanceOf(AdapterToolPolicyError);
    expect(err!.unenforceable).toEqual(['shell']);
  });

  it('lets planMode through on the adapters that can enforce it', () => {
    for (const arch of ['claude-code', 'opencode', 'gemini']) {
      expect(checkToolPolicy(arch, { planMode: true })).toBeUndefined();
    }
  });

  it('refuses everything on an unknown architecture (safe default)', () => {
    expect(checkToolPolicy('does-not-exist', { disallowedToolGroups: ['web'] })).toBeDefined();
  });
});

describe('AdapterToolPolicyError', () => {
  const err = checkToolPolicy('codex', { planMode: true })!;

  it('is distinguishable by a name that survives serialization', () => {
    expect(err.name).toBe('AdapterToolPolicyError');
    expect(JSON.parse(JSON.stringify(err)).name).toBe('AdapterToolPolicyError');
  });

  it('carries the adapter and the groups through toJSON', () => {
    const json = err.toJSON();
    expect(json.adapter).toBe('codex');
    expect(json.unenforceable).toEqual(['shell']);
    expect(json.enforceable).toEqual([{ group: 'file-write', strength: 'hard' }]);
  });

  it('names the unenforceable group in the human-readable message', () => {
    expect(err.message).toContain('shell');
    expect(err.message).toContain('codex');
  });
});

describe('isPorousCombination', () => {
  it('is porous when reads or writes are denied but the shell is not', () => {
    expect(isPorousCombination(['file-read'])).toBe(true);
    expect(isPorousCombination(['file-write'])).toBe(true);
  });

  it('is not porous once the shell is denied too', () => {
    expect(isPorousCombination(['file-write', 'shell'])).toBe(false);
  });

  it('is not porous when no filesystem group is denied', () => {
    expect(isPorousCombination(['web'])).toBe(false);
    expect(isPorousCombination([])).toBe(false);
  });

  // The plan-mode preset denies both, so it is deliberately NOT porous.
  it('does not fire for the plan-mode preset', () => {
    expect(isPorousCombination(PLAN_MODE_DENY_GROUPS)).toBe(false);
  });
});

function byCanonicalOrder(a: ToolGroup, b: ToolGroup): number {
  return TOOL_GROUPS.indexOf(a) - TOOL_GROUPS.indexOf(b);
}
