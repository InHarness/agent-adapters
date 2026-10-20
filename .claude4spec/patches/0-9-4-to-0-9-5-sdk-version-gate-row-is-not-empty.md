---
type: patch
brief: 0-9-4-to-0-9-5.md
patch_kind: drift
created_at: '2026-08-25T10:06:52.659Z'
created_by: unknown
applied: false
---
# Patch — sdk-version gate row is not empty

## What I found

The brief carves `sdk-version gate` out of `error/resilience` and tracks it as
◻ planned — "still not covered". The un-bundling is right, but the row is not empty in
the checkout.

Two things already exist:

- `src/testing/e2e/claude-code.e2e.test.ts:1313-1330`, a `sdk-version-gate — verified-range
  evidence` describe deliberately placed OUTSIDE the `describe.skipIf(SKIP)` suite, so it
  is deterministic and creds-free and runs even under `SKIP_CLAUDE_E2E`. It asserts the
  dev-pinned SDK the e2e suite actually runs against satisfies the declared
  `peerDependencies` range, and that an out-of-range version is reported as a mismatch
  with an "installed X … requires Y" message.
- `src/adapters/claude-code.sdk-version.test.ts`, a unit test asserting the adapter emits
  a non-suppressible `AdapterInitError` when the installed SDK version is out of range.

What is genuinely missing is only the end-to-end half: pinning a real out-of-range
install and observing the adapter throw at init.

## Suggestion

Split the row once more, or annotate it: the *evidence* and the *unit-level init throw*
are covered; the out-of-range-install e2e is not. As written, ◻ planned reads as "nothing
exists", which would send a future implementer to write tests that are already there.

