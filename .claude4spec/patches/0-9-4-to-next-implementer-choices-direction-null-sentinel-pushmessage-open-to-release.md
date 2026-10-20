---
type: patch
brief: 0-9-4-to-next.md
patch_kind: clarification
created_at: '2026-08-24T15:44:06.508Z'
created_by: unknown
applied: false
---
# Patch — implementer choices: direction, null sentinel, pushMessage, open to_release

## What I found

Four points where the brief left the decision to the implementer or was silent, and I had to choose. Recording them so the next brief can state them rather than re-deriving them.

1. **Direction on cap expiry.** The brief offered three (end the turn / extend the cap while work is live / count subagent traffic as activity) and asked only for the invariant. I took a combination: the cap is re-armed by *progress* frames (so a long subagent stretch is not truncated), and when it does expire the run ends with a typed error. I did NOT make subagent traffic release the hold — releasing it would leave the channel open with nothing left to close it, so the run would hang until `timeoutMs`.

2. **The disarm sentinel is `null`, not `0`.** The brief suggested "`0`, `null` or `Infinity`". `0` is not available: `claude-code.background-tasks.test.ts` pins an existing measured contract that a `0` or negative degrades to the default precisely so a typo cannot silently remove a bound. So `null` and `Infinity` disarm; `0`/negatives still fall back. Worth stating explicitly, because `0` is the intuitive spelling and a consumer who tries it gets the opposite of what they asked for.

3. **`pushMessage()` with concurrent runs.** The brief says run state belongs in a per-`execute()` context and that `abort()` must address a run rather than "the most recent one", but says nothing about `pushMessage()`, which has the same no-argument public signature. I made `abort()` reach every live run (a silently unstoppable run is the worse failure) and `pushMessage()` address the most recently started run (today's de-facto behaviour, now deliberate rather than an artefact of field clobbering). If the intended contract is different — e.g. `pushMessage()` should also fan out, or both should take an optional run handle — that needs saying.

4. **`to_release` is `null`.** `package.json` was left at `0.9.4` on the user's instruction; the number is decided at release time. Note that this release does contain breaking changes to exported surfaces (`createBackgroundHold`, `BackgroundHold`), so a patch bump would understate it.

## Suggestion

Fold 1–3 into M17 / the unified-layer entities as explicit statements, and give 2 an AC of its own (`0` → default, `null` → disarmed) since the two readings are contradictory and a consumer will guess wrong. For 4, it would help if briefs whose `to_release` is deliberately open said so, so the implementer knows the absence is intentional rather than an omission.

