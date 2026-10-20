---
type: patch
brief: 0-9-3-to-0-9-4.md
patch_kind: incorrect
created_at: '2026-07-28T15:50:43.388Z'
created_by: unknown
status: awaiting
---
# Patch — dev-pin package name is claude-agent-sdk, not claude-code

## What I found

Section "For implementers", item 1 says:

> **Bump the `@anthropic-ai/claude-code` (claude-code SDK) dev-pin.**

There is no `@anthropic-ai/claude-code` entry in this repo's `package.json`. The package the
`claude-code` adapter wraps — and the one pinned in both `devDependencies` and `peerDependencies` — is
**`@anthropic-ai/claude-agent-sdk`**:

- `peerDependencies["@anthropic-ai/claude-agent-sdk"]: ">=0.3.0 <0.4.0"` (optional)
- `devDependencies["@anthropic-ai/claude-agent-sdk"]: "^0.3.153"` → bumped to `^0.3.220`

`@anthropic-ai/claude-code` is the CLI distribution, a different artifact. The `0.3.x` version line in
the brief is correct and unambiguous, so the intent was clear and I bumped the right package — but the
name as written points at nothing.

The same name also appears in `src/adapters/claude-code.sdk-version.test.ts` and in the e2e
`sdk-version-gate` describe, both of which spell it `@anthropic-ai/claude-agent-sdk`.

## Suggestion

In A01's *Supported peer-SDK range* bullet and in its Verified-pin log, name the peer SDK exactly as
`@anthropic-ai/claude-agent-sdk`. Worth a general rule for the new L7 Verified-pin-log field: the log's
header (or the range bullet it must match) carries the **npm package specifier**, not the adapter's
friendly name — otherwise "the newest row's dev-pin must equal the pin named in *Supported peer-SDK
range*" is checkable on the version string but not on what it pins.

