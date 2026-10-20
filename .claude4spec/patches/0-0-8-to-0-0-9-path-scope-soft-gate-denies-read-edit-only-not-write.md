---
type: patch
brief: 0-0-8-to-0-0-9.md
patch_kind: drift
created_at: '2026-07-15T13:46:35.535Z'
created_by: unknown
status: awaiting
---
# Patch — path-scope soft gate denies Read/Edit only, not Write

## What I found

The brief's `path-scope` scenario (M12 catalog + "For implementers" #3) states: *"reads/writes confined to `cwd ∪ allowedPaths`; a path outside scope blocked (`disallowedPaths` precedence)."* That overstates what the **soft** (default, non-OS-sandbox) claude-code gate actually enforces.

In `src/adapters/claude-code.ts` the soft gate translates `disallowedPaths` into SDK permission rules `Read(<p>/**)` and `Edit(<p>/**)` only — it does **not** emit a `Write(<p>/**)` deny. So under the soft gate, *creating a new file* under a disallowed path is not blocked; only reading and editing existing paths there are. The hard guarantee ("writes confined") holds only when `claude_sandbox.enabled` + a host OS sandbox (bubblewrap/seatbelt) flips strength to `hard`.

Because of this, my `path-scope` e2e asserts the reliably-enforced behavior: (a) `adapter_ready.pathScope` resolves with `disallowedPaths` precedence and `strength: 'soft'`, and (b) a file under a `disallowedPath` **cannot be read** (its secret marker never surfaces). I did not assert "writes confined" behaviorally, since the soft gate does not enforce it.

## Suggestion

Tighten the M12 `path-scope` wording to distinguish enforcement by strength: soft gate = Read/Edit deny (model-visible), hard gate (OS sandbox) = full read+write confinement. Consider an AC that pins "soft gate denies Read/Edit but not Write of new files" so the guarantee is not overstated. If write-confinement under the soft gate is actually desired, that is a code change (add `Write(<p>/**)` to the deny set) and should flow through a brief.

