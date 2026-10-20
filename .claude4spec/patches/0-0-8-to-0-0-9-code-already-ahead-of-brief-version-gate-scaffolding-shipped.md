---
type: patch
brief: 0-0-8-to-0-0-9.md
patch_kind: drift
created_at: '2026-07-15T13:46:18.565Z'
created_by: unknown
status: awaiting
---
# Patch — code already ahead of brief: version gate + scaffolding shipped

## What I found

The brief describes several items as future/unshipped that are **already implemented in code** at the point I picked it up (repo at npm version 0.9.0):

- **SDK version gate.** The brief (anchor `verrange`, "For implementers" #4) says *"the version gate is not yet implemented in code (only the planned `sdk-version-gate` e2e scenario and the ACs ... exist so far)"*. In reality it is fully implemented and hardened: `src/sdk-version.ts` (`PEER_SDK_RANGES`, `resolvePeerSdkVersion`, `evaluatePeerSdkVersion`, `checkPeerSdkVersion`), wired into **all four adapters plus MCP** at init. On `status: 'mismatch'` it yields a non-suppressible init-phase `AdapterInitError` with message `"<pkg>: installed <X>, requires <Y>"`; on `undeterminable` it degrades to a warning. Unit tests exist per adapter (`src/adapters/*.sdk-version.test.ts`) and `src/sdk-version.test.ts` already asserts each dev-installed peer SDK satisfies its declared range. Git history: `34f6fc3 feat: hard peer-SDK version gate at init`, `ac1fce0 fix: harden ... against PnP, prereleases, and range drift`.
- **e2e scripts + model matrix.** `package.json` already exposes `test:e2e:claude:*` (one per M02 alias) and the runner already reads `E2E_CLAUDE_MODEL` (`src/testing/e2e/claude-code.e2e.test.ts`).
- **Dev-pin.** `@anthropic-ai/claude-agent-sdk` is already dev-pinned to `^0.3.153` in devDependencies.
- **mid-turn e2e.** The brief lists `mid-turn` under *Planned (7)*, but a live `pushMessage` round-trip e2e that asserts the pushed text surfaces as a `user_message` already exists (`streaming-input: pushMessage is accepted and delivered to the live session`).

## Suggestion

Regenerate/rebase this release-diff against the current code state, or annotate the coverage table: of the "7 planned", the version-gate contract, the e2e scripts/matrix, the dev-pin, and mid-turn are already shipped. Only `image`, `path-scope`, `usage`, `mcp-elicitation`, `timeout`, and `os-sandbox-degrade` were genuinely missing e2e coverage — which this implementation pass adds. Consider moving mid-turn from Planned → Covered in A01.

