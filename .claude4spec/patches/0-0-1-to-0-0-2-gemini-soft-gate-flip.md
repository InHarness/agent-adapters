---
type: patch
brief: 0-0-1-to-0-0-2.md
patch_kind: clarification
created_at: 2026-06-29T17:20:00Z
created_by: claude-code
---

# Patch — gemini flipped to pathScope: true / soft

## What I found

The brief's support matrix lists **gemini (A04)** as `pathScope: false` / none, with
a note: *"Whether the SDK's `targetDir`/include-directories can express a soft path
gate is unverified; if confirmed it would flip to `pathScope: true` / soft."*

I verified the installed `@google/gemini-cli-core` type definitions. The soft gate
**is backable**:

- `Config` accepts `includeDirectories?: string[]` (the workspace-extension knob).
- `WorkspaceContext` (`config/config.d.ts` → `getWorkspaceContext()`) exposes
  `isPathWithinWorkspace()`, `isPathReadable()`, and `addReadOnlyPath()` — i.e. the
  tools validate paths against the workspace set.

With the user's explicit go-ahead, I flipped gemini to `pathScope: true` / strength
`'soft'` this release rather than deferring:

- `allowedPaths` → `Config.includeDirectories` (those roots join the validated
  workspace).
- `disallowedPaths` → **surfaced as unenforceable** with a one-shot warning: gemini
  has no construct-time deny primitive, and the gate is soft (model-visible workspace
  scoping, not OS-enforced). It does NOT narrow access below `cwd` at the OS level.

## Suggestion

Update the brief's support-matrix row and the relevant acceptance criteria so gemini
reads `pathScope: true` / soft (with `disallowedPaths` documented as a soft/
unenforceable expressiveness limitation, parallel to codex's allow-list-only note).
The capability-module support matrix is the one home for this — adapter A04 should
just link to it.
