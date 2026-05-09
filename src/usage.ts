// Cumulative-usage helpers — pure, stateless aggregation of UsageStats across
// multiple `result` events (e.g. resumed sessions). The unified contract is
// that `result.usage` carries per-execute() delta only, not cross-thread
// cumulative — see JSDoc on `UnifiedEvent`'s `result` variant in `./types.ts`.

import type { UsageStats, UnifiedEvent } from './types.js';

const ZERO: UsageStats = { inputTokens: 0, outputTokens: 0 };

/**
 * Sum two UsageStats. Cache fields (`cacheReadInputTokens`,
 * `cacheCreationInputTokens`) are preserved when present in either operand and
 * summed when present in both. Returns a fresh object — operands are not
 * mutated.
 */
export function addUsage(a: UsageStats, b: UsageStats): UsageStats {
  const out: UsageStats = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (a.cacheReadInputTokens !== undefined || b.cacheReadInputTokens !== undefined) {
    out.cacheReadInputTokens = (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0);
  }
  if (a.cacheCreationInputTokens !== undefined || b.cacheCreationInputTokens !== undefined) {
    out.cacheCreationInputTokens = (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0);
  }
  return out;
}

/**
 * Subtract `b` from `a`, flooring at zero per field. Used by adapters whose
 * underlying SDK reports cumulative thread usage to derive per-execute() delta
 * (`current_cumulative - prior_cumulative`). Cache fields preserved when
 * present in either operand, symmetrically with `addUsage`. Returns a fresh
 * object — operands are not mutated.
 */
export function subtractUsage(a: UsageStats, b: UsageStats): UsageStats {
  const out: UsageStats = {
    inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
    outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
  };
  if (a.cacheReadInputTokens !== undefined || b.cacheReadInputTokens !== undefined) {
    out.cacheReadInputTokens = Math.max(0, (a.cacheReadInputTokens ?? 0) - (b.cacheReadInputTokens ?? 0));
  }
  if (a.cacheCreationInputTokens !== undefined || b.cacheCreationInputTokens !== undefined) {
    out.cacheCreationInputTokens = Math.max(0, (a.cacheCreationInputTokens ?? 0) - (b.cacheCreationInputTokens ?? 0));
  }
  return out;
}

/** Sum any number of UsageStats. Empty input returns `{ inputTokens: 0, outputTokens: 0 }`. */
export function sumUsage(...stats: UsageStats[]): UsageStats {
  return stats.reduce<UsageStats>((acc, s) => addUsage(acc, s), { ...ZERO });
}

/**
 * Sum every `result` event's `.usage` in a collected event stream. Useful when
 * a consumer keeps the raw event list per execute() call and wants a single
 * total. A stream typically contains exactly one `result`, but multiple are
 * tolerated (e.g. concatenated streams from multiple resume turns).
 */
export function sumUsageFromEvents(events: UnifiedEvent[]): UsageStats {
  return events.reduce<UsageStats>(
    (acc, e) => (e.type === 'result' ? addUsage(acc, e.usage) : acc),
    { ...ZERO },
  );
}
