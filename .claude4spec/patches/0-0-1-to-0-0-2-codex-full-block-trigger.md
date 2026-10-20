---
type: patch
brief: 0-0-1-to-0-0-2.md
patch_kind: missing
created_at: 2026-06-29T17:22:00Z
created_by: claude-code
---

# Patch — codex "full block → read-only": trigger condition is unspecified

## What I found

The codex row + implementer step 5 say: map `allowedPaths` → `sandboxMode:
'workspace-write'` + `additionalDirectories`, and *"a full block → `read-only`"*.
The brief never defines what consumer input via `allowedPaths`/`disallowedPaths`
constitutes a "full block" that should flip `sandboxMode` to `'read-only'`. There is
no natural encoding in the two fields ("read-only everything" is not expressible as
an allow/deny list).

## What I implemented

- `allowedPaths` → merged into `ThreadOptions.additionalDirectories` (composed with,
  never overwriting, an existing `codex_additionalDirectories`).
- `sandboxMode` is left to the existing precedence: `planMode` → `'read-only'`, else
  `codex_sandboxMode ?? 'workspace-write'`. The new path-scope fields do **not** flip
  `sandboxMode` to `read-only` — read-only stays driven by `planMode` /
  `codex_sandboxMode`. (I did not widen an explicit `read-only` to `workspace-write`
  either; both planMode and path-scope only ever narrow.)
- `disallowedPaths` → surfaced as `unenforceable` via a one-shot warning (codex's OS
  sandbox is allow-list-only; no deny carve-outs).

## Suggestion

Either (a) drop the "full block → read-only" clause from the codex mapping (the
existing `codex_sandboxMode`/`planMode` already own read-only), or (b) define the
explicit trigger — e.g. "`allowedPaths: []` together with a non-empty
`disallowedPaths` ⇒ `read-only`" — and pin it as an acceptance criterion so the
behavior is testable.
