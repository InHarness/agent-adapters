// Validation for programmatically-defined subagents
// (`RuntimeExecuteParams.subagents`). Mirrors the fail-fast style of
// `validateSkill` in `src/skills-tempdir.ts`: cheap structural checks run
// before an adapter maps the definitions onto its SDK, so a bad definition
// surfaces a clear error instead of a cryptic SDK failure.

import type { SubagentDefinition } from './types.js';

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
