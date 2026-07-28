// The model catalog is a *mirror*: M02 in the specification is canon, and this
// file pins the mirror against it. A model that resolves to the wrong id fails
// at the provider with an opaque 404, far from the alias table that caused it,
// so the alias→id mapping is worth asserting directly.

import { describe, it, expect } from 'vitest';
import {
  MODEL_ALIASES,
  ADAPTIVE_THINKING_ONLY,
  resolveModel,
  getModelContextWindow,
} from './models.js';

describe('opus-5 in the model catalog (M02)', () => {
  it("resolves the claude-code alias and is adaptive-thinking-only", () => {
    expect(resolveModel('claude-code', 'opus-5')).toBe('claude-opus-5');
    expect(ADAPTIVE_THINKING_ONLY.has('claude-opus-5')).toBe(true);
  });

  it('passes the resolved id through unchanged', () => {
    expect(resolveModel('claude-code', 'claude-opus-5')).toBe('claude-opus-5');
  });

  it('carries a 1M context window under either spelling', () => {
    expect(getModelContextWindow('claude-code', 'opus-5')).toBe(1_000_000);
    // Reverse-lookup: a consumer holding the full id must get the same window.
    expect(getModelContextWindow('claude-code', 'claude-opus-5')).toBe(1_000_000);
  });

  it('is reachable through opencode-openrouter as a vendor-prefixed id', () => {
    expect(resolveModel('opencode-openrouter', 'claude-opus-5')).toBe('anthropic/claude-opus-5');
    expect(getModelContextWindow('opencode-openrouter', 'claude-opus-5')).toBe(1_000_000);
  });
});

describe('ADAPTIVE_THINKING_ONLY membership', () => {
  // Keyed by *resolved* id, never by alias — an alias here would silently never
  // match, and the adapter would push a fixed thinking budget the model rejects.
  it('matches the M02 class exactly', () => {
    expect([...ADAPTIVE_THINKING_ONLY].sort()).toEqual(
      [
        'claude-fable-5',
        'claude-sonnet-5',
        'claude-opus-4-6',
        'claude-opus-4-7',
        'claude-opus-4-8',
        'claude-opus-5',
      ].sort(),
    );
  });

  it('holds resolved ids, so every member resolves to itself', () => {
    for (const id of ADAPTIVE_THINKING_ONLY) {
      expect(resolveModel('claude-code', id)).toBe(id);
    }
  });

  it('covers every claude-code alias the option metadata pins to adaptive-only', async () => {
    // Guards the drift this release fixed: `CLAUDE_CODE_OPTIONS` restricts the
    // thinking knob per model, and that list is a view of this set — a member
    // missing there leaves a UI offering a fixed budget the model will reject.
    const { CLAUDE_CODE_OPTIONS } = await import('./options.js');
    const thinking = CLAUDE_CODE_OPTIONS.find((o) => o.key === 'claude_thinking');
    const pinned = Object.keys(thinking?.modelOverrides ?? {});

    const adaptiveOnlyAliases = Object.entries(MODEL_ALIASES['claude-code'])
      .filter(([, fullId]) => ADAPTIVE_THINKING_ONLY.has(fullId))
      .map(([alias]) => alias);

    expect(pinned.sort()).toEqual(adaptiveOnlyAliases.sort());
  });
});
