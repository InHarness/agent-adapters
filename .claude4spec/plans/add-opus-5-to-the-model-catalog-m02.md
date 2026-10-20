---
type: plan
title: Add Opus 5 to the model catalog (M02)
created_at: '2026-07-27T09:30:05.805Z'
created_by: agent
---
# Add Opus 5 to the model catalog (M02)

<!-- anchor: my7ihuby -->
## Context / intent

Opus 5 shipped (2026-07-24, API id `claude-opus-5`). Two jobs:
1. Research whether it changes anything in the wrapped agent SDK / unified contract. (DONE — below.)
2. Add it as canon to the model catalog in M02 (`spec/modules/M02-models-aliases.md`), the source of truth `src/models.ts` mirrors.

Scope reminder: the spec assistant edits **only** the spec. `src/models.ts` mirror and the effort-ladder adapter change are downstream, via brief → implementer — the spec assistant does not touch `src/`.

<!-- anchor: j6espfn3 -->
## Research findings (Opus 5 vs agent SDK)

- **id** `claude-opus-5`; **window** 1,000,000 (default AND max); **max output** 128k; price unchanged vs 4.8.
- **Thinking on by default**, wire value unchanged — `thinking: {type:'adaptive'}` still valid = default → adaptive-only, joins `ADAPTIVE_THINKING_ONLY`.
- **New effort ladder** `low|medium|high|xhigh|max` (default `high`).
- **Breaking**: `thinking:{type:'disabled'}` → 400 at effort `xhigh`/`max`; allowed only `high` or below.
- Not in scope: mid-conversation tool changes (beta), default fallbacks, lower cache min, fast mode.

Impact: no wire/contract change for basic use (adapter already handles adaptive-only). Effort ladder = code change (not spec canon). Disabled+xhigh/max 400 unreachable today (adapter never emits `'disabled'`).

<!-- anchor: py4bf9dr -->
## Spec edits — `spec/modules/M02-models-aliases.md`

1. **claude-code models** (anchor `9gu9zp7z`) — add above `opus-4.8`:
   `| `opus-5` | `claude-opus-5` | 1,000,000 | ✓ |`
2. **opencode-openrouter** (anchor `b14uq6ky`) — near anthropic opus rows:
   `| `claude-opus-5` | `anthropic/claude-opus-5` | 1,000,000 |`
3. **`ADAPTIVE_THINKING_ONLY` semantics** (anchor `udbixmag`) — add `claude-opus-5` to keyed-id list.
4. Extend the note under the claude-code table (~line 51) to mention `opus-5` (adaptive-only, 128k max output) alongside `sonnet-5`/`opus-4.8`.

<!-- anchor: fl1mo7vc -->
## AC (confirmed: add)

5. Create one `ac` entity via entity-tools: kind `requirement`, tag `m02`, verifies M02, statement e.g. *"`resolveModel('claude-code', 'opus-5')` returns `claude-opus-5`, and `claude-opus-5` is a member of `ADAPTIVE_THINKING_ONLY`."* — surfaced automatically by the existing `<tagged_list type="ac" tags="m02"/>`.

<!-- anchor: rdwxxi95 -->
## index.md Open question (confirmed: add)

6. Add an Open-questions entry: whether to expose the new Opus 5 effort levels `xhigh`/`max` through `claude_effort` (adapter/code change, downstream), and whether effort levels should become spec canon rather than living only in the adapter + claude-code-sdk skill.

<!-- anchor: o7hrmr7a -->
## Downstream (NOT this task — via brief → implementer)

- Mirror M02 → `src/models.ts` (`MODEL_ALIASES`, `ADAPTIVE_THINKING_ONLY`, window).
- Widen `claude_effort` to `...|'xhigh'|'max'`; guard the disabled+xhigh/max 400 as a watch item.
- Update `.claude/skills/claude-code-sdk/SKILL.md` "TODO / things to watch".

<!-- anchor: hjgf2j7e -->
## Drift check after edits

- M02 is a single file (<250 lines) — no split needed.
- No index module/layer table change (no new module/layer). Only the Open-questions section grows.
