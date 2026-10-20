---
type: patch
brief: 0-9-3-to-0-9-4.md
patch_kind: clarification
created_at: '2026-07-28T16:06:36.272Z'
created_by: unknown
status: awaiting
---
# Patch — findings write-back: A01 pending row completed for 0.3.220

## What I found

This is the write-back the brief asks for in "For implementers" item 4 — completing A01's Verified-pin
log row that currently reads `pending verification`.

**Resolved pin: `^0.3.220`** — the latest published `0.3.x` at implementation time, above the `0.3.210`
floor. The brief names `0.3.210` in the pending row; per "the exact pin is the implementer's resolution
at bump time", the row should record `^0.3.220`, the version actually verified. Note the package is
`@anthropic-ai/claude-agent-sdk` (see the separate `incorrect` patch on the name).

**What was run, against the installed 0.3.220:**

- `npm run typecheck` — clean. No type drift across the 67-patch jump.
- `npm run test` — 396 passed, 1 skipped. Includes the unit tests that encode the measured SDK
  behaviours: `claude-code.background-routing.test.ts`, `.background-hold.test.ts`,
  `.background-tasks.test.ts`.
- `SKIP_CLAUDE_E2E=1 npm run test:e2e:claude` — the creds-free `sdk-version-gate` describe passes, i.e.
  0.3.220 still satisfies the declared peer range `>=0.3.0 <0.4.0`. The range was not widened.
- `npm run test:e2e:claude` — **live, default model `sonnet-4.6`: 33 passed, 1 skipped, 553s.**
- `npm run test:e2e:claude -- -t "settle"` — **2 further runs, 4/4 cells green each** (backgrounded bash
  and subagents x one-shot and streaming). Run 3x in total because that defect was ~1-in-2-to-3
  timing-dependent; one green run would have proved nothing.

**Coverage caveat, stated plainly:** default model only. The 10 per-model scripts
(`test:e2e:claude:fable-5` ... `:haiku-4.5`) were **not** run — see the separate `clarification` patch on
matrix cost. The row's `verified by` should say so rather than "full suite".

**Findings on `^0.3.220`: none observed**, with one carry-over:

- The single skip is the MCP **form**-elicitation refusal, unchanged from the 0.3.153 row: the tool
  reported `elicitation unavailable: Client does not support form elicitation`, and the scenario
  self-skips (`ctx.skip()`) so it auto-activates when support lands. This is a property of the engine's
  MCP client, as M04 already notes — not of this pin.
- The three probe-observed deltas that motivated the floor (`background_tasks` listing subagents,
  `BackgroundTaskSummary.type` reading `'subagent'`, the 3.5-3.7s wake-up gap) produced **no test
  failures**, because the code already handles all three — see the separate `drift` patch.
- No new warnings attributable to the bump. The `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` notices during the
  path-scope scenarios are the SDK's expected commentary on `permissionMode: 'bypassPermissions'`, not
  a regression.

## Suggestion

Complete A01's pending row as:

| 2026-07-28 | `^0.3.220` | `npm run test:e2e:claude` — full scenario suite, default model `sonnet-4.6` (33 passed / 1 skipped); settle cells re-run 2x, all green; per-model scripts not run | none observed; MCP **form** elicitation still refused by the engine's client (self-skipping scenario, carried over from `^0.3.153`) |

Code change shipped: `devDependencies["@anthropic-ai/claude-agent-sdk"]` `^0.3.153` -> `^0.3.220`, plus
`"version": "0.9.4"`. `peerDependencies` and the codex / opencode / gemini / MCP pins were left exactly
as they were, per item 5.

