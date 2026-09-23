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

describe('fable-5.1 in the model catalog (M02)', () => {
  it('resolves the claude-code alias and is adaptive-thinking-only', () => {
    expect(resolveModel('claude-code', 'fable-5.1')).toBe('claude-fable-5-1');
    // The adapter branches on the *resolved* id (claude-code.ts) to suppress the
    // fixed thinking budget and restore `display: 'summarized'`. Membership here
    // is the only switch — a miss sends a budget the model answers with a 400.
    expect(ADAPTIVE_THINKING_ONLY.has('claude-fable-5-1')).toBe(true);
  });

  it('passes the resolved id through unchanged', () => {
    expect(resolveModel('claude-code', 'claude-fable-5-1')).toBe('claude-fable-5-1');
  });

  it('carries a 1M context window under either spelling', () => {
    expect(getModelContextWindow('claude-code', 'fable-5.1')).toBe(1_000_000);
    expect(getModelContextWindow('claude-code', 'claude-fable-5-1')).toBe(1_000_000);
  });

  it('is reachable through opencode-openrouter under its own alias spelling', () => {
    // Deliberately NOT the same string as the claude-code alias: `claude-fable-5.1`
    // here, `fable-5.1` there, and the OpenRouter id carries the vendor prefix.
    expect(resolveModel('opencode-openrouter', 'claude-fable-5.1')).toBe(
      'anthropic/claude-fable-5.1',
    );
    expect(getModelContextWindow('opencode-openrouter', 'claude-fable-5.1')).toBe(1_000_000);
  });
});

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

describe('opus-5.5 in the model catalog (M02)', () => {
  it('resolves the claude-code alias and is adaptive-thinking-only', () => {
    expect(resolveModel('claude-code', 'opus-5.5')).toBe('claude-opus-5-5');
    expect(ADAPTIVE_THINKING_ONLY.has('claude-opus-5-5')).toBe(true);
    expect(getModelContextWindow('claude-code', 'opus-5.5')).toBe(1_000_000);
    expect(getModelContextWindow('claude-code', 'claude-opus-5-5')).toBe(1_000_000);
  });

  it('is reachable through opencode-openrouter, whose form stays OUT of the bare-id set', () => {
    expect(resolveModel('opencode-openrouter', 'claude-opus-5.5')).toBe('anthropic/claude-opus-5.5');
    expect(getModelContextWindow('opencode-openrouter', 'claude-opus-5.5')).toBe(1_000_000);
    expect(ADAPTIVE_THINKING_ONLY.has('anthropic/claude-opus-5.5')).toBe(false);
  });

  it('flags the medium effort default in the option metadata', async () => {
    const { CLAUDE_CODE_OPTIONS } = await import('./options.js');
    const effort = CLAUDE_CODE_OPTIONS.find((o) => o.key === 'claude_effort');
    expect(effort?.default).toBe('high');
    expect(effort?.modelOverrides?.['opus-5.5']?.default).toBe('medium');
  });
});

describe('ADAPTIVE_THINKING_ONLY membership', () => {
  // Keyed by *resolved* id, never by alias — an alias here would silently never
  // match, and the adapter would push a fixed thinking budget the model rejects.
  it('matches the M02 class exactly', () => {
    expect([...ADAPTIVE_THINKING_ONLY].sort()).toEqual(
      [
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-sonnet-5',
        'claude-opus-4-6',
        'claude-opus-4-7',
        'claude-opus-4-8',
        'claude-opus-5',
        'claude-opus-5-5',
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
