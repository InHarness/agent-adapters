---
type: patch
brief: 0-0-1-to-0-0-2.md
patch_kind: incorrect
created_at: 2026-06-29T17:21:00Z
created_by: claude-code
---

# Patch — claude-code deny rules live under Options.settings, not a top-level `permissions`

## What I found

The brief (claude-code row + implementer step 4) says to map `disallowedPaths` →
`permissions.deny: ['Read(…)','Edit(…)']`. In the installed
`@anthropic-ai/claude-agent-sdk` type definitions there is **no top-level
`Options.permissions` field**. Deny/allow rules are reachable only via
`Options.settings` (a `Settings` object) or `Options.managedSettings`:

```ts
options.settings = { permissions: { deny: ['Read(/p/**)', 'Edit(/p/**)'] } };
```

(`Settings.permissions.{allow,deny,ask}` are plain `string[]` — the
`Read(...)`/`Edit(...)` pattern grammar is a runtime convention, NOT encoded in the
types.) I implemented it via `Options.settings.permissions.deny`.

Two related notes for the spec:

1. The adapter runs with `permissionMode: 'bypassPermissions'`. This is fine for the
   soft gate because the SDK's documented precedence is **Deny > permissionMode >
   Allow** — deny rules still apply under bypass. Worth stating explicitly in the
   degradation contract so nobody "fixes" it by dropping bypass mode.
2. `Options.additionalDirectories` and `Options.sandbox.filesystem.{allowWrite,
   denyWrite,allowRead,denyRead}` + `sandbox.enabled` DO exist as the brief assumes —
   only the deny-rule *location* was off.

## Suggestion

Correct the brief's mapping text to `Options.settings.permissions.deny` (or
`managedSettings`), and add the bypass-mode precedence note to the soft-gate
description.
