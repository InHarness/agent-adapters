---
type: patch
brief: 0-9-0-to-0-9-1.md
patch_kind: drift
created_at: '2026-07-27T22:47:38.945Z'
created_by: unknown
status: completed
---
# Patch — the brief's release axis is behind the code by a full minor

## What I found

The brief is `0.9.0 → 0.9.1` and its §§1–2 describe the M17 background-task work as new. On the code side that work had already shipped: `main` was at **0.10.0** when I picked the brief up, and its CHANGELOG section documents the whole family (`background_task_*`, `result.backgroundTasks`, the task-kind registry, the bounded control-channel hold, `claude_disallowBackgroundBash`, the universal input channel, and the M13 abort-races-`onUserInput` rule) as landed.

I audited every implementer bullet against the code. Already done: the `src/types.ts` variants and the `result.backgroundTasks` field; the `Map<task_id, task_type>` and its routing (including the SDK's real `local_bash` / `local_workflow` spellings, which the brief does not mention — it names only `shell` / `monitor` / `workflow`); the in-flight set and its union with the engine's report; the bounded hold with its `warning`; the seeded channel on every run; the deny-hook; and the abort race. Genuinely outstanding were only the `opus-5` catalog rows, `Query.interrupt()`, and the AC-6 absence assertions — which is what this PR implements.

The practical damage is in `to_release`: the skill tells the implementer to write it into `package.json`, and 0.9.1 is *below* the 0.10.0 already in the file and already described in the CHANGELOG. Written literally (as instructed), the repo now claims a version lower than the release notes sitting above it, and `npm publish` would go out below the last published 0.9.0's successor.

## Suggestion

Two things worth deciding:

1. **Reconcile the axes, or stop coupling them.** Either the spec's release numbers track the npm SemVer of this repo, or the skill should stop writing `to_release` into `package.json` and record the spec release somewhere that cannot collide (a `specRelease` field, or the brief-implemented marker alone). Right now a spec release generated after the code has moved on produces a guaranteed-wrong version.
2. **Generate briefs against the code's current state.** A release-diff brief whose content is already shipped costs the implementer a full audit pass to discover that nothing in §§1–2 needs doing. If the generator can read the code repo's version/CHANGELOG, a brief that lands on an already-past release could say so up front.

Also worth folding into A01 while you are there: the brief says `task_type ∈ {shell, monitor, workflow}`, but the SDK actually sends `local_bash` for backgrounded shell work and prefixes locally-executed kinds with `local_`. The code strips the prefix before mapping. The spec's enumeration is the *unified* vocabulary, which is right — but an implementer reading only the brief would match on the wrong strings.

