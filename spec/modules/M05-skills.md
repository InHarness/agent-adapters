<!-- anchor: g8iizph7 -->
# M05 — Inline skills & disk discovery

> Two ways to get Anthropic-style `SKILL.md` skills in front of an agent — materialize an inline definition to a temp directory, or discover skills already on disk — exploiting the directory-name overlap most SDKs share.

<!-- anchor: ylh5rmjv -->
## Purpose

Developers can supply skills to an agent without hand-managing skill directories: define a skill inline and have it materialized to a temporary `SKILL.md` tree (`skills-tempdir.ts`), or enumerate skills already present in the conventional search directories (`listDiskSkills`, `getSkillSearchDirs`). M05 owns these helpers and — per the one-home rule — **the per-adapter skill-delivery matrix**. There is deliberately no first-class `skills` field/event in the contract yet (see L2 note); delivery rides on the filesystem invariant and SDK-native discovery.

<!-- anchor: rprv98g3 -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | A skill invoked by the model surfaces as `tool_use`/`tool_result`; no dedicated skill event exists. |
| L2 | Owns the skill-delivery support matrix + degradation per adapter. |
| L4 | Exports `listDiskSkills`, `getSkillSearchDirs`, the `InlineSkill` type, and the materializer. |

<!-- anchor: z7ulw13g -->
## Unified Contract (L1)

Skills are not a `UnifiedEvent` variant. When the model opens/uses a skill, it appears through the adapter's existing tool mapping (`tool_use` / `tool_result`) — e.g. opencode's native `skill` tool. No `skill_loaded`/`skill_invoked` event is synthesized (open design question, deferred).

<!-- anchor: 6rir81wb -->
## Capability & Degradation (L2)

**Shared-directory invariant** — `.claude/skills/` is read by claude-code **and** opencode; `.agents/skills/` by codex **and** opencode; `.opencode/skills/` by opencode only. A skill in `.claude/skills/` is picked up by 2 of 4 adapters with no code change.

**Skill-delivery matrix** (canonical home — adapters link here):

| Delivery | claude-code | codex | gemini | opencode |
| --- | :---: | :---: | :---: | :---: |
| Inline materialization → temp dir on a search path | ✅ | ✅ (path in cwd) | ❌ | ✅ |
| Disk discovery (`listDiskSkills`) | ✅ | ✅ | ⚠️ extension-bundle only | ✅ |
| Dynamic loading without restart | ✅ | ✅ | ❌ (CLI restart) | ✅ |

Degradation: gemini-cli-core is the outlier — inline materialization to a generic search dir does not reach it (skills must live inside a registered extension), so M05 **warns** and skips for gemini rather than pretending.

**Discovery boundary under a sandbox (claude-code).** When a filesystem path-scope / sandbox is requested (M15), claude-code narrows its config sources so that global home-tier disk skills (`~/.claude/skills`) are no longer auto-discovered — an intended part of confining the agent, so ambient global skills cannot re-widen its reach. The *mechanism* (setting-source narrowing) is A01's, not M05's — see A01 (<section_ref anchor="sw3cwrsm"/>). Inline-skill delivery is unaffected: it rides on `options.plugins`, not the narrowed config sources, so project-scoped inline skills still materialize under sandbox. The boundary is simply "skills outside project scope are not auto-discovered in sandbox mode".

<!-- anchor: gutjzxqm -->
## Public API & Packaging (L4)

Exports `listDiskSkills`, `getSkillSearchDirs`, the `InlineSkill` type, and the inline materializer from the package root.

<!-- anchor: yr023akw -->
## Edge cases

- gemini target + inline skill supplied → warning + skip (no silent expectation that it loaded).
- codex target → materialized skill must land on a path codex scans within `cwd` (`.agents/skills/`); otherwise it is not discovered.
- Two search dirs contain a skill with the same `name` → discovery reports both; resolution/precedence is the consumer's choice.

<!-- anchor: va61ruj0 -->
## Acceptance criteria

These verify both delivery paths work where supported and degrade with a warning where not.

<tagged_list type="ac" tags="m05"/>
