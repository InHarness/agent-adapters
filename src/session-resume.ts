// Session-resume constraints — declarative, stateless metadata describing which
// inputs CANNOT change once a session has started (i.e. across turns of a resumed
// session via `RuntimeExecuteParams.resumeSessionId`).
//
// Why this exists: adapters are single-use and stateless — they hold no record of
// the configuration a session was originally created with, so they cannot validate
// or enforce consistency at runtime. The Anthropic API, however, enforces it hard:
// the `thinking`/`redacted_thinking` blocks of the latest assistant message must be
// returned byte-identical on the next turn, so resuming with a different thinking /
// reasoning / model configuration fails with:
//   400 ... `thinking` blocks in the latest assistant message cannot be modified.
// Other SDKs are more forgiving, but switching model or reasoning mid-thread is
// wrong there too.
//
// The library's job is therefore purely declarative: expose WHICH fields are
// immutable so the consumer — the only party that holds the session's original
// config and the live thread state — can either lock those controls in its UI once
// a thread is active, or treat a change as a request to start a NEW session.
//
// Source of truth is the per-architecture `ArchOption` schema in `options.ts`
// (`resumeImmutable` flag). `model` is a top-level field (not an arch option) and
// is always session-immutable, handled here directly.

import { getArchitectureOptions } from './options.js';

/** A field that must not change across turns of a resumed session. */
export interface ResumeFieldConstraint {
  /**
   * Dotted path of the field within {@link RuntimeExecuteParams}:
   * `'model'` or `'architectureConfig.<key>'`.
   */
  path: string;
  /** Human-readable reason — suitable for UI tooltips / disabled-field hints / logs. */
  reason: string;
}

/** A subset of {@link RuntimeExecuteParams} sufficient to diff resume-critical fields. */
export interface ResumeConfigSnapshot {
  model?: string;
  architectureConfig?: Record<string, unknown>;
}

const MODEL_IMMUTABLE_REASON: Record<string, string> = {
  'claude-code':
    'Thinking blocks are cryptographically bound to the model that produced them; switching models on resume makes Anthropic reject the request. Start a new session to change the model.',
  codex: 'A Codex thread is tied to its model; resume reuses it. Start a new session to change the model.',
  gemini:
    'Conversation history is tied to the originating model; start a new session to change the model.',
  opencode: 'An OpenCode session is bound to its provider/model; start a new session to change the model.',
};

function modelConstraint(architecture: string): ResumeFieldConstraint {
  return {
    path: 'model',
    reason:
      MODEL_IMMUTABLE_REASON[architecture] ??
      'Model is fixed for the lifetime of a session; changing it requires a new session.',
  };
}

/**
 * The fields that cannot change once a session has started, for the given
 * architecture. `model` is always included; the rest are derived from the
 * `resumeImmutable` flag on the architecture's {@link ArchOption} schema.
 *
 * Intended for UIs: disable these controls when `resumeSessionId` is set (a thread
 * is active), or surface them as "changing this starts a new conversation".
 */
export function getSessionResumeConstraints(architecture: string): ResumeFieldConstraint[] {
  const immutableOptions = getArchitectureOptions(architecture)
    .filter((o) => o.resumeImmutable)
    .map<ResumeFieldConstraint>((o) => ({
      path: `architectureConfig.${o.key}`,
      reason:
        o.resumeImmutableReason ??
        `"${o.label}" is fixed once a session has started; changing it requires a new session.`,
    }));
  return [modelConstraint(architecture), ...immutableOptions];
}

/**
 * Whether the field at `path` (`'model'` or `'architectureConfig.<key>'`) may be
 * changed on a resumed session for the given architecture.
 */
export function isSessionFieldMutable(architecture: string, path: string): boolean {
  return !getSessionResumeConstraints(architecture).some((c) => c.path === path);
}

function valueAtPath(path: string, snapshot: ResumeConfigSnapshot): unknown {
  if (path === 'model') return snapshot.model;
  if (path.startsWith('architectureConfig.')) {
    return snapshot.architectureConfig?.[path.slice('architectureConfig.'.length)];
  }
  return undefined;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // ArchOption-backed values are primitives, but architectureConfig is untyped —
  // fall back to structural compare so objects/arrays don't false-positive.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Diff two configs (the one the session was created with vs. the one about to be
 * used on a resumed turn) and return the immutable fields that actually changed.
 *
 * The consumer holds both snapshots — it built `original` for turn 1 and `next`
 * from current UI state — so this is a pure function with no library-side state.
 * A non-empty result means: either reuse the original values, lock those controls,
 * or start a NEW session instead of resuming.
 *
 * Semantics: a field is only flagged when it is present on BOTH sides and the
 * values differ. A field absent on either side is treated as "not being changed"
 * (no violation), so partial configs don't produce false positives.
 */
export function findResumeViolations(
  architecture: string,
  original: ResumeConfigSnapshot,
  next: ResumeConfigSnapshot,
): ResumeFieldConstraint[] {
  const violations: ResumeFieldConstraint[] = [];
  for (const constraint of getSessionResumeConstraints(architecture)) {
    const a = valueAtPath(constraint.path, original);
    const b = valueAtPath(constraint.path, next);
    if (a !== undefined && b !== undefined && !valuesEqual(a, b)) {
      violations.push(constraint);
    }
  }
  return violations;
}
