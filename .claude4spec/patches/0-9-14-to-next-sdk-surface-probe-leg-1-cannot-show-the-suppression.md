---
type: patch
brief: 0-9-14-to-next.md
patch_kind: clarification
created_at: '2026-09-27T20:33:17.856Z'
created_by: unknown
applied: false
---
# Patch — sdk-surface-probe leg 1 cannot show the suppression

## What I found
The brief's verification step says "Run `sdk-surface-probe` leg 1 (tool inventory): none of the four tools appear in the init tool list." Leg 1 calls the peer SDK's `query()` directly with NO restrictions (the documented exception to "every e2e drives the adapter"), so it cannot observe the adapter's suppression — live on SDK 0.3.280 / sonnet-4.6 it still reports `CronCreate, CronDelete, CronList, ScheduleWakeup` in system:init. Worse, leg 1 asserts every exposed built-in is in `claudeCodeKnownBuiltins()`; removing the four from `CLAUDE_CODE_UNGATED_BUILTINS` alone (brief step 2) would turn leg 1 red.

Resolved in the implementation by:
- keeping the four in the inventory: `claudeCodeKnownBuiltins()` now includes `CLAUDE_CODE_SUPPRESSED_HARNESS_TOOLS` (known ≠ offered);
- adding probe **leg 4**, which passes the adapter's suppression options (`disallowedTools` = the four, `env.CLAUDE_CODE_DISABLE_CRON='1'`) and asserts none of the four reach system:init — green live.

Also: in the no-policy branch of `subagentToolPolicy`, a definition that explicitly names a suppressed tool in `tools` now has it filtered out (the brief only required it in `disallowedTools`).

## Suggestion
Reword the A01 verified-pin / brief verification to: "leg 1 keeps the scheduling family in the known inventory; leg 4 (adapter suppression options) shows none of the four at system:init". Note in A01 that the suppressed family is part of the known-built-ins inventory but never in any allow-list, and that subagent `tools` are stripped of it even when the run denies nothing.

