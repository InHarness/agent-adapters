---
type: patch
brief: 0-9-6-to-0-9-7.md
patch_kind: clarification
created_at: '2026-08-26T15:57:09.372Z'
created_by: unknown
applied: false
---
# Patch — item 6 does not say allow-confinement vs disallowedPaths; only one proves the ceiling

## What I found

Implementer item 6 says the new e2e leg must instruct a subagent to read a file **outside `cwd ∪ allowedPaths`** and assert the read is refused. It does not say *how* the file gets to be out of reach, and the two available shapes are not equivalent:

- **allow-confinement** — the run declares only `allowedPaths`; the target sits outside the ceiling and is named nowhere.
- **deny carve-out** — the run declares `disallowedPaths` naming the target.

This matters because **every existing path-scope refusal test in the repo drives `disallowedPaths`** (`src/testing/e2e/claude-code.e2e.test.ts:1331` Read, `:1360` Write). There was no test anywhere proving that a path outside the ceiling but *not* named in `disallowedPaths` is unreachable. A deny-list-only implementation would pass the entire existing suite.

I asked the spec agent (`c4s ask`, thread `rqlCQbyvj5c5`), and the canon is clear and already written — allow-confinement is required:

- M15's L1 contract: *"**Confinement, not deny-only.** … anything outside that set is unreachable **even if it is not named in `disallowedPaths`** … a soft gate that is merely a deny-list is a documented expressiveness limitation, not conformance."*
- The M15 edge case: *"File outside `cwd ∪ allowedPaths` but **not** listed in `disallowedPaths` → still unreachable."*

I implemented the leg with pure allow-confinement (`cwd` + `allowedPaths: [extraDir]`, no `disallowedPaths`, target = the `secret/secret.txt` canary), and it passes live on sonnet-4.6 with the model actually delegating.

## Suggestion

1. Make the distinction explicit in the brief's item 6 — one clause, e.g. *"declare only `allowedPaths`; the target must be outside the ceiling and named in no `disallowedPaths`, since a deny-list-driven test does not exercise confinement."* An implementer following the repo's existing test shape would reach for `disallowedPaths` by default and produce a leg that cannot fail for the reason the criterion cares about.
2. Consider whether the **parent-level** allow-confinement gap deserves its own criterion. The subagent leg is now the only test in the codebase proving the ceiling at all; the M15 edge case *"file outside `cwd ∪ allowedPaths` but not listed in `disallowedPaths` → still unreachable"* has no direct parent-level coverage, so the inheritance test is currently carrying a claim about the base mechanism too.
