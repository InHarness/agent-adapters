---
type: patch
brief: 0-0-8-to-0-0-9.md
patch_kind: drift
created_at: '2026-07-15T14:06:15.324Z'
created_by: unknown
status: awaiting
---
# Patch — LIVE: soft disallowedPaths deny does not block Read (secret leaked)

## What I found

Running the new `path-scope` e2e against a live model (sonnet-4.6, claude-agent-sdk 0.3.153, 2026-07-15) surfaced a real behavioral gap, stronger than the earlier "denies Read/Edit only, not Write" note:

**The soft `disallowedPaths` gate did not block a Read at all — the disallowed file's contents leaked into the model output.** Setup: `cwd` = temp workdir, `disallowedPaths: [<secretDir>]`, a seeded `<secretDir>/secret.txt` containing `TOP-SECRET-1729`. The model was asked to Read it; it succeeded and returned the marker verbatim.

Root cause (from code, not just the run): `src/adapters/claude-code.ts` always sets `permissionMode: 'bypassPermissions'` (default, and even under `planMode`). It then maps `disallowedPaths` to `settings.permissions.deny = ['Read(<abs>/**)', 'Edit(<abs>/**)']`. The adapter comment (~L614) asserts *"Deny outranks permissionMode in the SDK precedence chain, so the deny rules survive our bypassPermissions default"* — but empirically the deny was bypassed (or the absolute-path rule glob did not match). Either way the guarantee does not hold live.

Coverage gap that hid this: the only prior test, `src/adapters/claude-code.path-scope.test.ts`, asserts the deny STRING is constructed (`toEqual(['Read(/work/a/secret/**)', 'Edit(/work/a/secret/**)'])`) — never that it ENFORCES. My e2e is the first behavioral check.

I did NOT silently pass this. The behavioral read-block e2e is committed as `it.skip` with a comment marking it the acceptance test for the fix; the deterministic `adapter_ready.pathScope` resolution test stays green. I did not attempt a runtime fix in this test-scaffolding PR.

## Suggestion

Treat as a real bug for a follow-up brief: either (a) emit the deny in the rule format Claude Code actually enforces for absolute paths, or (b) when `disallowedPaths` is set, downgrade `permissionMode` off `bypassPermissions` (to `default`/`acceptEdits`) so deny takes effect, or (c) use the OS sandbox path (`claude_sandbox`) for any hard guarantee and downgrade the M12 `path-scope` claim for the soft gate to "best-effort, not enforced". Add a live/behavioral AC ("a Read of a disallowedPath file must not surface its contents") so construction-only unit coverage can't hide this again. Un-skipping the e2e test is the fix's acceptance criterion.

