---
type: brief
from_release: 0.9.14
to_release: null
generated_at: '2026-09-26T15:53:13.293Z'
implemented: true
---
# Hard-suppress the harness scheduling tools (ScheduleWakeup, CronCreate/CronList/CronDelete) in the claude-code adapter

## Trigger
A claude4spec child agent started through `runTransagent` called
`ScheduleWakeup({delaySeconds:1200, noop:true, prompt:"…", reason:"fallback…"})`. It got back
"Next wakeup scheduled for 18:00:00 (in 1217s). Nothing more to do this turn — the harness re-invokes you when the wakeup fires…"
and then ended its turn. The adapter closed the session at `result`, so the wake-up never fired and the work the agent planned was lost without any error.

## 1. What the specification says
- AC **`ac-the-claude-code-adapter-does-not-offer-t`** (status active, tag `a01`): *"The claude-code adapter does not offer the harness scheduling tools (ScheduleWakeup and CronCreate/CronList/CronDelete) to the model — they are hard-suppressed via custom_env (CLAUDE_CODE_DISABLE_CRON=1) and/or disallowedTools, with no config gate to re-enable them."*
- `spec/adapters/A01-claude-code.md:33`: the scheduling family has no event-mapping row because it is *hard-suppressed before it can reach the stream*. `Monitor` is **not** part of this family: it works headless and stays available.
- `spec/adapters/A01-claude-code.md:95` ("Scheduling (harness) — hard-suppressed") and `:176`: these tools are inert under the headless SDK, so the adapter suppresses them rather than leave a silent no-op.
- `spec/modules/M13-errors-resilience.md:48`: failure class **inert-harness-tool → silent lost work**.
- Out of scope: the autonomous self-scheduling loop (`spec/index.md:227`, plan-6 stage 2).

## 2. What the code does
- `src/adapters/claude-code.ts:231-241` puts `CronCreate`, `CronDelete`, `CronList` and `ScheduleWakeup` in **`CLAUDE_CODE_UNGATED_BUILTINS`**, the list of built-ins that "stays available whatever is denied". The JSDoc at `:214-230` names "scheduling" as ungated by design, which contradicts the spec.
- `buildClaudeCodeToolPolicy` (`:282-298`) adds the ungated list to `allow`. It also returns `undefined` when no group is denied.
- `:1273-1277`: `options.tools` / `options.disallowedTools` are only set when `toolPolicy` exists. A run with no denies therefore gets the SDK's full default catalogue, scheduling tools included.
- `:1364-1371`: `options.env` is only built when `custom_env` or `ollama_baseUrl` is present. `CLAUDE_CODE_DISABLE_CRON` appears nowhere in `src/`.
- `:1390-1395`: `options.allowedTools` = `autoApproveTools` minus `toolPolicy.deny`, so a consumer could auto-approve these tools.
- `subagentToolPolicy` (`:328-344`): subagents inherit `toolPolicy.deny`. Suppression must reach them too.
- `:2899-2918` (`case 'result'`): with no queued input and no touched background task, `inputChannel.close()` runs. stdin closes, the CLI exits, and the in-process wake-up timer dies. The background hold (`claude-code.background-hold.ts`) reacts only to tasks and the Stop hook's `background_tasks`, never to wake-ups or crons.
- Evidence from the bundled CLI (SDK 0.3.280, native binary `claude-agent-sdk-darwin-arm64/claude`):
  - `CronCreate`, `CronList` and `CronDelete` each have `isEnabled(){return YP()}`, where `YP = !CLAUDE_CODE_DISABLE_CRON && flag("tengu_kairos_cron")`.
  - **The `ScheduleWakeup` tool definition has no `isEnabled`.** The env var does not reliably remove it, so `disallowedTools` is required.
  - The CLI describes these as "Session-scoped cron tasks (CronCreate, ScheduleWakeup, /loop) that will wake this session later". They live only in memory and die with the process.

## 3. What the implementer must change (`src/adapters/claude-code.ts`)
1. Introduce `export const CLAUDE_CODE_SUPPRESSED_HARNESS_TOOLS = ['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete']` with a JSDoc that cites A01 and M13 (inert under headless drive, so the work is lost silently).
2. Remove those four names from `CLAUDE_CODE_UNGATED_BUILTINS`, and rewrite its JSDoc so it no longer lists "scheduling". They must never appear in `options.tools` (the allow list).
3. **Always** set `options.disallowedTools`, whether or not `toolPolicy` exists and with no config switch: `[...new Set([...(toolPolicy?.deny ?? []), ...CLAUDE_CODE_SUPPRESSED_HARNESS_TOOLS])]`. This deliberately breaks the old invariant that a run with no gating is byte-for-byte identical to the pre-M18 behaviour, but only for this field. Update the comment at `:1270-1272` and the JSDoc of `buildClaudeCodeToolPolicy` to match. `options.tools` stays unset when nothing is denied.
4. **Always** set `options.env` with `CLAUDE_CODE_DISABLE_CRON: '1'` as defence in depth for `Cron*`. Merge it after `process.env`, `ollama_baseUrl` and `custom_env` so that no consumer value can switch it off. Today `options.env` stays unset when neither `custom_env` nor `ollama_baseUrl` is given, so change that path to always build it from `process.env`.
5. Strip the four names from `options.allowedTools` (`autoApproveTools`) the same way denied names are stripped today.
6. Make sure subagents get the suppression too: include the four names in the `disallowedTools` that `subagentToolPolicy` produces, including the branch where `toolPolicy` is undefined.
7. Leave `Monitor` and the rest of the background-task / hold path untouched.

## 4. How to verify
- Unit tests for the query options (next to the existing M18 tool-policy tests):
  - With no denied groups: `disallowedTools` ⊇ the four names, `tools` is unset, and `env.CLAUDE_CODE_DISABLE_CRON === '1'`.
  - With some denied groups (e.g. `shell`): the four names are in `disallowedTools` and **not** in `tools`.
  - With `autoApproveTools: ['ScheduleWakeup', 'CronCreate']`: `allowedTools` contains neither.
  - With `custom_env: { CLAUDE_CODE_DISABLE_CRON: '0' }`: the resulting env still has `'1'`.
  - Subagent definitions get the four names in `disallowedTools`.
  - `Monitor` stays available when `shell` is not denied.
- Link the tests to AC `ac-the-claude-code-adapter-does-not-offer-t` (`verifies`).
- Run `sdk-surface-probe` leg 1 (tool inventory): none of the four tools appear in the init tool list.
- Run `npm test` / typecheck in agent-adapters.
- Downstream (claude4spec, after bumping the adapter): the golden snapshots in `src/server/services/__snapshots__/system-prompt.golden.test.ts.snap` currently list ScheduleWakeup/Cron* as available built-ins and must be regenerated.
