import { describe, it, expect } from 'vitest';
import { addUsage, sumUsage, sumUsageFromEvents } from '../usage.js';
import type { UnifiedEvent, NormalizedMessage, UsageStats } from '../types.js';

const noCacheA: UsageStats = { inputTokens: 100, outputTokens: 50 };
const noCacheB: UsageStats = { inputTokens: 200, outputTokens: 75 };

const withCacheA: UsageStats = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadInputTokens: 30,
  cacheCreationInputTokens: 5,
};

const withCacheB: UsageStats = {
  inputTokens: 200,
  outputTokens: 75,
  cacheReadInputTokens: 60,
  cacheCreationInputTokens: 10,
};

const partialCache: UsageStats = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadInputTokens: 7,
  // no cacheCreationInputTokens
};

const ZERO: UsageStats = { inputTokens: 0, outputTokens: 0 };

const dummyMessages: NormalizedMessage[] = [
  { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: '2026-05-09T00:00:00Z' },
];

function resultEvent(usage: UsageStats): UnifiedEvent {
  return {
    type: 'result',
    output: 'ok',
    rawMessages: dummyMessages,
    usage,
    contextSize: usage.inputTokens + usage.outputTokens,
  };
}

describe('addUsage', () => {
  it('sums input/output tokens when neither has cache fields', () => {
    expect(addUsage(noCacheA, noCacheB)).toEqual({
      inputTokens: 300,
      outputTokens: 125,
    });
  });

  it('preserves cache fields when only one operand has them', () => {
    expect(addUsage(noCacheA, withCacheB)).toEqual({
      inputTokens: 300,
      outputTokens: 125,
      cacheReadInputTokens: 60,
      cacheCreationInputTokens: 10,
    });
  });

  it('sums cache fields when both operands have them', () => {
    expect(addUsage(withCacheA, withCacheB)).toEqual({
      inputTokens: 300,
      outputTokens: 125,
      cacheReadInputTokens: 90,
      cacheCreationInputTokens: 15,
    });
  });

  it('handles asymmetric cache field presence', () => {
    expect(addUsage(partialCache, withCacheB)).toEqual({
      inputTokens: 210,
      outputTokens: 80,
      cacheReadInputTokens: 67,
      cacheCreationInputTokens: 10,
    });
  });

  it('is identity with zero usage', () => {
    expect(addUsage(withCacheA, ZERO)).toEqual(withCacheA);
    expect(addUsage(ZERO, withCacheA)).toEqual(withCacheA);
  });

  it('does not mutate operands', () => {
    const a = { ...withCacheA };
    const b = { ...withCacheB };
    addUsage(a, b);
    expect(a).toEqual(withCacheA);
    expect(b).toEqual(withCacheB);
  });

  it('is commutative', () => {
    expect(addUsage(withCacheA, withCacheB)).toEqual(addUsage(withCacheB, withCacheA));
  });
});

describe('sumUsage', () => {
  it('returns zero usage when called with no args', () => {
    expect(sumUsage()).toEqual(ZERO);
  });

  it('returns the single argument unchanged when called with one', () => {
    expect(sumUsage(withCacheA)).toEqual(withCacheA);
  });

  it('sums many UsageStats', () => {
    expect(sumUsage(noCacheA, noCacheB, withCacheA, withCacheB)).toEqual({
      inputTokens: 600,
      outputTokens: 250,
      cacheReadInputTokens: 90,
      cacheCreationInputTokens: 15,
    });
  });

  it('handles a mix of with and without cache fields', () => {
    expect(sumUsage(noCacheA, withCacheB, partialCache)).toEqual({
      inputTokens: 310,
      outputTokens: 130,
      cacheReadInputTokens: 67,
      cacheCreationInputTokens: 10,
    });
  });
});

describe('sumUsageFromEvents', () => {
  it('returns zero for an empty stream', () => {
    expect(sumUsageFromEvents([])).toEqual(ZERO);
  });

  it('returns zero for a stream without result events', () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'hi', isSubagent: false },
      { type: 'warning', message: 'something' },
    ];
    expect(sumUsageFromEvents(events)).toEqual(ZERO);
  });

  it('returns the single result.usage when stream contains one result', () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'hi', isSubagent: false },
      resultEvent(withCacheA),
    ];
    expect(sumUsageFromEvents(events)).toEqual(withCacheA);
  });

  it('sums multiple result.usage entries (e.g. concatenated resume turns)', () => {
    const events: UnifiedEvent[] = [
      resultEvent(noCacheA),
      { type: 'flush' },
      resultEvent(withCacheB),
    ];
    expect(sumUsageFromEvents(events)).toEqual({
      inputTokens: 300,
      outputTokens: 125,
      cacheReadInputTokens: 60,
      cacheCreationInputTokens: 10,
    });
  });

  it('ignores error events that precede result', () => {
    const events: UnifiedEvent[] = [
      { type: 'error', error: new Error('boom'), phase: 'runtime' },
      resultEvent(noCacheA),
    ];
    expect(sumUsageFromEvents(events)).toEqual(noCacheA);
  });
});
