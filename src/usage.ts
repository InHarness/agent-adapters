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
 * USAGE CONTEXT WINDOW — number of tokens occupying the model's context
 * window after THIS turn. Use the LAST turn's `result.usage`, NOT a sum
 * across turns.
 *
 * Compare against the model's context window (e.g. 400_000 for `gpt-5-codex`,
 * 200_000 for `claude-sonnet-4.5`) to get utilization percentage. The
 * value is also exposed directly on the `result` event as `contextSize` —
 * this helper exists for callers who only kept `UsageStats` from elsewhere.
 *
 * IMPORTANT — this is distinct from USAGE BILLING TOKENS (the per-call
 * billing cost in `result.usage`):
 *   - context window (this helper): grows by the size of each new exchange
 *     (user prompt + assistant response — typically tens to hundreds of
 *     tokens per turn). Bounded by the model's window — when full, the
 *     conversation must be compacted.
 *   - billing tokens (sum of per-turn `usage`): grows by the size of each
 *     replayed turn (system prompt + full history + new prompt + response).
 *     Unbounded — every resumed call re-bills the history (at a cache-
 *     discounted rate for OpenAI/Anthropic prompt caches).
 *
 * Why `inputTokens + outputTokens` works across all four adapters: every
 * wrapped SDK reports `inputTokens` as "context posted to LLM on this turn"
 * (cache reads are a sub-field, not separate). For Codex, where the SDK
 * reports session-cumulative and the adapter subtracts to per-call delta,
 * the same identity holds after subtraction. Adding `outputTokens` (the
 * assistant response just appended) yields the post-turn conversation size.
 */
export function contextSize(usage: UsageStats): number {
  return usage.inputTokens + usage.outputTokens;
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
