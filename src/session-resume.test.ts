import { describe, it, expect } from 'vitest';
import {
  getSessionResumeConstraints,
  isSessionFieldMutable,
  findResumeViolations,
} from './session-resume.js';
import { getArchitectureOptions } from './options.js';

describe('getSessionResumeConstraints', () => {
  it('always includes model as immutable', () => {
    for (const arch of ['claude-code', 'codex', 'gemini', 'opencode']) {
      const paths = getSessionResumeConstraints(arch).map((c) => c.path);
      expect(paths).toContain('model');
    }
  });

  it('derives claude-code thinking/effort constraints from the options schema', () => {
    const paths = getSessionResumeConstraints('claude-code').map((c) => c.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'model',
        'architectureConfig.claude_thinking',
        'architectureConfig.claude_thinking_budget',
        'architectureConfig.claude_effort',
      ]),
    );
  });

  it('does not mark generation-only options (temperature) as immutable', () => {
    const paths = getSessionResumeConstraints('gemini').map((c) => c.path);
    expect(paths).toContain('architectureConfig.gemini_thinkingLevel');
    expect(paths).not.toContain('architectureConfig.gemini_temperature');
    expect(paths).not.toContain('architectureConfig.gemini_topP');
  });

  it('every constraint carries a non-empty reason', () => {
    for (const c of getSessionResumeConstraints('claude-code')) {
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  it('returns only the model constraint for an unknown architecture', () => {
    expect(getSessionResumeConstraints('does-not-exist')).toEqual([
      { path: 'model', reason: expect.any(String) },
    ]);
  });
});

describe('source-of-truth consistency', () => {
  // Every immutable arch option must map to a key the adapter actually reads.
  // The options schema is the documented single source of truth for that mapping;
  // this guards against the constraints drifting from the schema.
  it('immutable constraint paths all resolve to an existing arch option key', () => {
    for (const arch of ['claude-code', 'codex', 'gemini', 'opencode']) {
      const optionKeys = new Set(getArchitectureOptions(arch).map((o) => o.key));
      const archConfigPaths = getSessionResumeConstraints(arch)
        .map((c) => c.path)
        .filter((p) => p.startsWith('architectureConfig.'))
        .map((p) => p.slice('architectureConfig.'.length));
      for (const key of archConfigPaths) {
        expect(optionKeys.has(key)).toBe(true);
      }
    }
  });
});

describe('isSessionFieldMutable', () => {
  it('reports immutable fields as not mutable', () => {
    expect(isSessionFieldMutable('claude-code', 'model')).toBe(false);
    expect(isSessionFieldMutable('claude-code', 'architectureConfig.claude_thinking')).toBe(false);
  });

  it('reports per-turn fields as mutable', () => {
    expect(isSessionFieldMutable('claude-code', 'architectureConfig.claude_usePreset')).toBe(true);
    expect(isSessionFieldMutable('gemini', 'architectureConfig.gemini_temperature')).toBe(true);
  });
});

describe('findResumeViolations', () => {
  it('flags a changed reasoning effort on claude-code', () => {
    const violations = findResumeViolations(
      'claude-code',
      { model: 'opus-4.8', architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'high' } },
      { model: 'opus-4.8', architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'low' } },
    );
    expect(violations.map((v) => v.path)).toEqual(['architectureConfig.claude_effort']);
  });

  it('flags a changed model', () => {
    const violations = findResumeViolations(
      'claude-code',
      { model: 'opus-4.7' },
      { model: 'opus-4.8' },
    );
    expect(violations.map((v) => v.path)).toContain('model');
  });

  it('returns empty when configs are identical', () => {
    const cfg = { model: 'opus-4.8', architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'high' } };
    expect(findResumeViolations('claude-code', cfg, cfg)).toEqual([]);
  });

  it('does not flag a changed mutable field (temperature)', () => {
    const violations = findResumeViolations(
      'gemini',
      { model: 'gemini-2.5-flash', architectureConfig: { gemini_temperature: 0.2 } },
      { model: 'gemini-2.5-flash', architectureConfig: { gemini_temperature: 0.9 } },
    );
    expect(violations).toEqual([]);
  });

  it('does not flag when a key is absent on one side (partial config = no change)', () => {
    const violations = findResumeViolations(
      'claude-code',
      { model: 'opus-4.8', architectureConfig: { claude_effort: 'high' } },
      { model: 'opus-4.8', architectureConfig: {} },
    );
    expect(violations).toEqual([]);
  });

  it('flags multiple changed immutable fields at once', () => {
    const violations = findResumeViolations(
      'claude-code',
      { model: 'opus-4.7', architectureConfig: { claude_thinking: 'enabled', claude_effort: 'high' } },
      { model: 'opus-4.8', architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'high' } },
    );
    expect(violations.map((v) => v.path).sort()).toEqual(
      ['architectureConfig.claude_thinking', 'model'].sort(),
    );
  });
});
