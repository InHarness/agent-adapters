---
type: patch
brief: 0-9-0-to-0-9-1.md
patch_kind: incorrect
created_at: '2026-07-28T08:54:18.555Z'
created_by: unknown
status: completed
---
# Patch — RETRACTION of the release-axis drift patch

## What I found

**This retracts the second half of my earlier patch, `0-9-0-to-0-9-1-the-brief-s-release-axis-is-behind-the-code-by-a-full-minor.md`. Please read that one together with this correction, or discard its point 1.**

That patch claimed the brief's `to_release: 0.9.1` was stale because the code repo was already at `0.10.0`, and concluded that writing `to_release` into `package.json` produced a downgrade. **That conclusion was wrong, and the fault was on the code side, not the spec's.**

The repo owner confirmed: `0.10.0` was never a real release. It was an erroneous bump introduced in commit `4552070`, npm's latest published version is `0.9.0`, and the intended next release is exactly `0.9.1` — the value the brief carried all along. The brief was right and the codebase was wrong. I corrected `package.json`, `package-lock.json`, and the CHANGELOG heading and compare link to `0.9.1` in the implementation PR.

So: no release-axis divergence exists, `to_release` needs no rethinking, and the coupling between spec releases and `package.json` behaved exactly as designed. My suggestions 1 and 2 in that patch ("reconcile the axes or stop coupling them", "generate briefs against the code's current state") should be **disregarded** — they were reasoning from a defect in the code repo that I mistook for a spec problem.

## Suggestion

Two things survive from the retracted patch and are still worth acting on:

1. **The M17 work was already implemented when the brief arrived.** This remains true and is unaffected by the version mix-up — the background-task family, the routing registry, the in-flight set, the bounded hold, the deny-hook and the M13 abort race were all in the codebase before I started; only the `opus-5` catalog, `Query.interrupt()` and the AC-6 absence assertions were outstanding. If the brief generator can tell that a release-diff's content is already present, saying so up front would save the implementer a full audit pass.

2. **`task_type` vocabulary.** The brief enumerates `{shell, monitor, workflow}`, but the SDK actually sends `local_bash` for backgrounded shell work and prefixes locally-executed kinds with `local_`. The code strips the prefix before mapping. The spec's enumeration is the correct *unified* vocabulary — it would just help to say explicitly that it is the unified one and that the wire values differ, so an implementer reading only the brief does not match on the wrong strings.

Apologies for the noise on the version question — that one was mine to catch and I attributed it in the wrong direction.

