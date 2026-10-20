---
type: plan
title: 'Patch: brief release axis behind code (0.9.0→0.9.1 vs 0.10.0)'
created_at: '2026-07-28T10:45:19.771Z'
created_by: agent
---
# Patch analysis — release-axis drift (0.9.0→0.9.1 brief vs 0.10.0 code)

**patch_kind:** `drift` · **verdict:** the spec needs **no content change** — it is already ahead of the brief and already documents everything the patch found in code. The drift is **brief ↔ code**, not **spec ↔ code**.

<!-- anchor: atb2pox0 -->
## Why no spec edit is required

Every item the patch lists as "already done in code" is already canon in the spec (spec is the source of truth; code has now caught up):

| Patch item | Already in spec |
| --- | --- |
| `local_bash` / `local_workflow` + `local_` prefix strip | A01 line 70 ("observed, not assumed"), A01 line 31, M17 line 30 |
| `task_type ∈ {shell,monitor,workflow}` is the **unified** vocab, not wire strings | M17 line 30, A01 lines 24/31 (caveated), AC `ac-result-backgroundtasks-lists-engine-backg` ("'local_bash' is normalized to 'shell'") |
| `Map<task_id, task_type>` routing | A01 lines 31/67; AC `ac-the-claude-code-adapter-captures-task-ty` |
| `result.backgroundTasks` (never-a-subagent) | M01 line 30, M17 lines 33–34, A01 line 69 |
| Bounded control-channel hold + `warning` (cap warns, grace silent) | M17 edge cases `q9u5sbot`, A01 lines 74–76; ACs |
| `claude_disallowBackgroundBash` deny-hook | M17 lines 52/59, A01 line 77; AC |
| Universal/seeded input channel | A01 line 72; M17 dep on M11 |
| M13 abort races `onUserInput`; `Query.interrupt()` fire-and-forget | A01 line 58; edge case line 136 |
| `opus-5` catalog rows | already M02 canon (index Open Question #8) |

The patch's one concrete spec suggestion — "fold the `local_bash` note into A01" — is **already present** (A01 line 70). So the technical drift is fully resolved in the spec already.

<!-- anchor: lb9gtbmp -->
## The two "worth deciding" items are platform/tooling, not spec content

1. **Release-axis coupling** (`to_release` written into `package.json` vs npm SemVer). This lives in the claude4spec brief/release generator + the `patch-implementer`/`release-process` skills — **not** in `spec/`. The spec assistant edits only `spec/`; it cannot fix the generator. Surface to user as a decision (track npm SemVer, or record spec release in a non-colliding `specRelease` marker).
2. **Generate briefs against the code's current state** — also a brief-generator concern, outside `spec/`. Surface as a decision.

<!-- anchor: 63nwip7g -->
## Proposed steps

1. **No edits to `spec/` pages or entities** — the spec already reflects the patch's technical findings.
2. Report to the user: the patch is a brief↔code drift already covered by the spec; recommend the patch be marked `completed` (a UI action — no agent tool).
3. Escalate the two platform decisions (release-axis coupling; brief freshness) to the user, since neither is fixable inside `spec/`.
4. (Optional, only if the user wants it) add a short note to M12 about tying any spec-release version to the repo's npm SemVer — but this documents platform behavior in the spec and is **not recommended** absent a user request.
