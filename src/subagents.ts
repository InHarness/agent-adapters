// Validation for programmatically-defined subagents
// (`RuntimeExecuteParams.subagents`). Mirrors the fail-fast style of
// `validateSkill` in `src/skills-tempdir.ts`: cheap structural checks run
// before an adapter maps the definitions onto its SDK, so a bad definition
// surfaces a clear error instead of a cryptic SDK failure.

import type { SubagentDefinition, SubagentStatus } from './types.js';

/**
 * Validate subagent definitions: each needs a non-empty `name`, `description`,
 * and `prompt`, and `name`s must be unique within the call. Throws on the first
 * violation. No-op for an empty/undefined list.
 */
export function validateSubagents(defs: SubagentDefinition[] | undefined): void {
  if (!defs?.length) return;

  const seen = new Set<string>();
  for (const def of defs) {
    if (typeof def?.name !== 'string' || def.name.trim() === '') {
      throw new Error('SubagentDefinition.name is required and must be a non-empty string');
    }
    if (typeof def.description !== 'string' || def.description.trim() === '') {
      throw new Error(`SubagentDefinition "${def.name}" requires a non-empty description`);
    }
    if (typeof def.prompt !== 'string' || def.prompt.trim() === '') {
      throw new Error(`SubagentDefinition "${def.name}" requires a non-empty prompt`);
    }
    if (seen.has(def.name)) {
      throw new Error(`SubagentDefinition name collision on "${def.name}" — names must be unique within a call`);
    }
    seen.add(def.name);
  }
}

/**
 * Spellings an SDK uses for "this work was stopped by a termination". Matched
 * only AFTER the adapter's own declared map misses, so a declared spelling is
 * never reinterpreted by a regex. Covers both `cancelled` and `canceled`.
 */
const CANCELLATION_SHAPED = /cancel|abort|interrupt|terminat/i;

/**
 * Map an SDK's own task status onto the unified {@link SubagentStatus}
 * vocabulary (M06). Adapters call this instead of forwarding the wire value —
 * wire values must never be matched against the unified set directly.
 *
 * The rules are ordered, and the order is the contract:
 *
 *   1. a spelling the adapter declares → its declared counterpart;
 *   2. an unrecognized but cancellation-shaped spelling → `'aborted'`;
 *   3. anything else → `'failed'`, with `warn: true`.
 *
 * Rule 3 never yields `'completed'`. A subagent that actually succeeded under
 * some new SDK wording being reported as `'failed'` is a false negative chosen
 * deliberately over a false positive: claiming success is the one error a
 * consumer would act on irreversibly.
 *
 * `warn` is a DRIFT signal, not a capability degradation — nothing was requested
 * and refused; a status arrived that nothing in the pinned SDK range ever
 * declared, and the next pin-verification pass has to investigate it. The caller
 * owns the dedup: at most ONE warning per run, however many unrecognized
 * statuses arrive during it.
 */
export function mapSubagentStatus(
  raw: unknown,
  declared: Record<string, SubagentStatus>,
): { status: SubagentStatus; warn: boolean } {
  const value = typeof raw === 'string' ? raw : '';
  const mapped = declared[value];
  if (mapped) return { status: mapped, warn: false };
  if (CANCELLATION_SHAPED.test(value)) return { status: 'aborted', warn: false };
  return { status: 'failed', warn: true };
}
