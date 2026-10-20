---
type: patch
brief: 0-9-7-to-0-9-8.md
patch_kind: clarification
created_at: '2026-08-27T10:13:36.797Z'
created_by: unknown
applied: false
---
# Patch — briefs disagree on narrowing status to a union

## What I found

The two briefs give opposite guidance on the TypeScript shape of `subagent_completed.status`.

- `0-9-7-to-0-9-8.md`, "For implementers" step 1: "Narrowing `status: string` to `status: SubagentStatus` is the honest shape, but it is a **breaking type change** … if you keep `string` for this release, the mandatory CHANGELOG behavioral note applies."
- `0-9-7-to-next.md`, step 1: "**The TypeScript field stays `string`.** Do *not* narrow it to a union in `src/types.ts`" — with a stated rationale (the vocabulary is an obligation on producers, not a compile-time constraint on consumers; the same discipline M17 applies to `taskType`).

I followed the analysis brief (kept `string`, exported `SubagentStatus` as an opt-in alias, wrote the behavioral CHANGELOG note). But the release-diff brief is the one framed as canon, and it leaves the choice open — a second implementer reading only that brief could reasonably narrow the type and ship a breaking change under a minor bump.

## Suggestion

Make the ruling explicit in M06 (or M12, next to the semver rule) rather than leaving it to the implementer: the unified `status` field is typed `string` deliberately, and the four-value vocabulary is a production obligation. That also makes the "the CHANGELOG note is the consumer's only signal" rule in M12 follow from something stated rather than from a choice each release re-makes.

