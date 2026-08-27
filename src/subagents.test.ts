// The unified `subagent_completed.status` map (M06). Adapters call this instead of
// forwarding their SDK's wire value, so the ordered rules below are the whole of the
// unified vocabulary's guarantee: wire values are never matched against the four
// unified names directly.

import { describe, it, expect } from 'vitest';
import { mapSubagentStatus, validateSubagents } from './subagents.js';
import type { SubagentStatus } from './types.js';

const DECLARED: Record<string, SubagentStatus> = {
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
};

describe('mapSubagentStatus', () => {
  it('rule 1 — a declared spelling maps to its counterpart, without warning', () => {
    for (const [raw, status] of Object.entries(DECLARED)) {
      expect(mapSubagentStatus(raw, DECLARED)).toEqual({ status, warn: false });
    }
  });

  it('rule 1 wins over rule 2 — a declared spelling is never reinterpreted by shape', () => {
    // An adapter whose SDK spells its per-task stop `cancelled` declares it as
    // `'stopped'`; the cancellation regex must not steal it into `'aborted'`.
    expect(mapSubagentStatus('cancelled', { cancelled: 'stopped' })).toEqual({ status: 'stopped', warn: false });
  });

  it('rule 2 — an unrecognized but cancellation-shaped spelling maps to `aborted`, silently', () => {
    for (const raw of ['cancelled', 'canceled', 'cancel', 'aborted', 'interrupted', 'terminated']) {
      expect(mapSubagentStatus(raw, DECLARED), raw).toEqual({ status: 'aborted', warn: false });
    }
  });

  it('rule 3 — anything of no known shape maps to `failed` and asks for a warning', () => {
    expect(mapSubagentStatus('quantum_superposition', DECLARED)).toEqual({ status: 'failed', warn: true });
    expect(mapSubagentStatus(undefined, DECLARED)).toEqual({ status: 'failed', warn: true });
    expect(mapSubagentStatus(42, DECLARED)).toEqual({ status: 'failed', warn: true });
  });

  it('rule 4 — an unrecognized value is NEVER `completed`', () => {
    // The one direction that is unsafe: a false claim of success is the error a
    // consumer would act on irreversibly. Reporting a genuinely-succeeded subagent
    // as `failed` under some new SDK wording is the deliberately accepted cost.
    for (const raw of ['succeeded', 'done', 'ok', 'finished', 'COMPLETE']) {
      expect(mapSubagentStatus(raw, DECLARED).status, raw).not.toBe('completed');
    }
  });
});

describe('validateSubagents', () => {
  it('is a no-op for an empty or absent list', () => {
    expect(() => validateSubagents(undefined)).not.toThrow();
    expect(() => validateSubagents([])).not.toThrow();
  });
});
