---
type: brief
source: analysis
from_release: 0.9.4
to_release: null
generated_at: '2026-08-24T15:06:16.261Z'
generator_version: brief-author@0.1
implemented: true
---
# Analysis brief: 0.9.4 → (next)

## Summary

The `claude-code` adapter holds a Claude Agent SDK session open while background work
(subagents, `run_in_background` Bash) is still in flight. That hold is bounded by an absolute
90-second cap. When the cap expires the adapter closes the **input channel** of a session whose
CLI subprocess is still alive and still producing output.

That input channel is not just "the place user messages go in". It is the **only** host→CLI
control transport. SDK-type MCP servers, the `canUseTool` permission prompt, hook callbacks and
`onElicitation` are all bridged over the CLI's stdin. Closing it therefore silently disables all
four capabilities for the remainder of the run, while the model keeps talking, subagents keep
streaming, `Bash`/`Read` keep working, and the turn never errors.

This is a confirmed production defect reproduced from consumer telemetry (claude4spec), not a
hypothesis. Observed bursts of 44, 46 and 56 consecutive MCP calls rendering as
`(mcp__plan-tools__get_plan completed with no output)` after a single cap-expiry warning.

The requirement this release must satisfy: **`expire()` must never leave a half-dead session
alive.** Either the turn ends, or the channel stays open. And when the channel does go down, the
run must surface a terminal, machine-readable signal — not a warning string buried among dozens
of successful-looking empty tool results.

<!-- anchor: chain001 -->
## The causal chain

Every step below is grounded in current `0.9.4` source, with `file:line` as of the drift report.

**1. `touchedATask()` latches for the whole run.**
`src/adapters/claude-code.background-hold.ts:144` implements it as `kindById.size > 0`, and
`kindById` is never pruned. One subagent or one `run_in_background` Bash early in a run makes it
permanently `true` — long after that task has finished.

**2. A `result` event arms the absolute cap.**
`src/adapters/claude-code.ts:1727-1745`:

```ts
const engineHoldsSession = (stopHookReported?.length ?? 0) > 0;
if (resultEvent.subtype === 'success' && inputChannel.hasPending()) { hold.end(); }
else if (resultEvent.subtype === 'success' && (engineHoldsSession || tasks.touchedATask())) { hold.begin(); }
else { hold.end(); inputChannel.close(); }
```

`hold.begin()` arms `capTimer` with `MAX_BACKGROUND_HOLD_MS = 90_000`.

**3. The cap is never extended, and subagent work never releases the hold.**
`touch()` re-arms only `graceTimer`; `capTimer` is set once in `begin()`. Subagent traffic always
carries `parent_tool_use_id`, so `isMainModelActivity()`
(`background-hold.ts:66-76`, used at `background-hold.ts:365-373`) returns `false` and the hold is
never released. A long subagent-driven stretch is precisely the shape that reaches the cap — the
one case the release path cannot recognise.

**4. Cap expiry closes the input channel and nothing else.**
`expire(message)` at `background-hold.ts:299-306` calls `closeChannel()`, wired to
`inputChannel.close()` at `claude-code.ts:1133-1141`. The `AbortController` is untouched,
`q.interrupt()` is not called, no signal is sent, no MCP server is closed. **The CLI subprocess
stays alive.**

**5. Ending the input iterable closes the CLI's stdin.**
In `@anthropic-ai/claude-agent-sdk`, `Query.streamInput` logs
`"[Query] Calling transport.endInput() to close stdin to CLI process"` and calls
`ProcessTransport.endInput()` → `this.processStdin.end()`.

**6. stdin is the only host→CLI control channel; writes are then silently dropped.**
SDK-type MCP servers are bridged over it:
`connectSdkMcpServer` → `sendMcpServerMessageToCli` → `transport.write`. After `endInput`:

```ts
if (this.processStdin.writableEnded) {
  // "[ProcessTransport] Dropping write to ended stdin stream"
  return;
}
```

**7. The CLI keeps issuing `mcp_message` control requests.** They are received, executed on the
host, and their results are thrown away on the way back. The CLI renders each unanswered call as
`(<tool> completed with no output)` — that string originates in the CLI engine, adjacent to
telemetry `tengu_tool_empty_result`. It is produced neither by this library, nor by the Agent SDK,
nor by the consumer.

**8. Three more capabilities die at the same instant.** `canUseTool` (the CLI is spawned with
`--permission-prompt-tool stdio`), hook callbacks (this adapter **always** registers a Stop hook —
`claude-code.ts:1152-1178`) and `onElicitation` ride the same transport. The previously reported
`Tool permission request failed: AbortError: Stream closed` is the same defect seen from a
different angle.

**Net effect:** the cap warning is not a report of abandoned background work. It is the *event
that severs the host control channel* of a still-running session. Everything host-side degrades
to silence; everything CLI-local keeps working. Invisible to the consumer except as empty tool
results.

<!-- anchor: evid0001 -->
## Evidence

The adapter's own warning row is the marker:

```
claude-code: background work still in flight after 90000ms - closing the session. Any remaining
background task is abandoned and its completion will not be reported.
```

Correlation between that warning and the first empty MCP result in the same thread, from a
consumer chat database:

| thread | warning | first empty result | empties |
|---|---|---|---|
| `cxEn8xfc7ATS` | 2026-08-20 17:10:00 | 17:10:02 | 46 |
| `UrPrateGNE7I` | 2026-08-19 13:12:44 | 13:12:48 | 44 |
| `_bVBp_YlTBej` | 2026-08-13 09:41:28 | 09:41:40 | 56 |
| `yC9eqJlP2GYs` | 2026-08-24 08:51:27 | 08:58:41 | 4 |

17 of the last 20 warnings are followed by an empty MCP result within seconds. Every incident
since 2026-08-04 has a preceding warning. `yC9eqJlP2GYs` is the cleanest signature: warning at
08:51:27, a subagent then ran `Bash` successfully from 08:53 to 08:56, and the first main-model
MCP call at 08:58:41 came back empty — "CLI alive, host channel dead".

<!-- anchor: origin01 -->
## Where the drift came from

| commit | date | effect |
|---|---|---|
| `4552070` | 2026-07-27 | `fix(claude-code): hold the control channel for background work; bound it; M17` — introduces the hold, `expireHold()` and the warning; cap `120_000` |
| `7fcdd36` | 2026-07-27 | `fix(claude-code): silence the healthy hold, release it on resume (M17)` — grace 5s→15s, release on main-model activity, Stop-hook hold reason |
| `645a280` | 2026-07-27 | `refactor(claude-code): extract the background-task hold; bound it under the consumer's clock` — moved to `background-hold.ts`, cap 120s → **90s** |

The cap was introduced as a safety bound on *waiting*, and quietly became a bound on the
*session*. Lowering it to 90s put it below `collectEvents()`'s 120s default and below typical
consumer `timeoutMs`, which is what made it routinely reachable.

<!-- anchor: invar001 -->
## The required invariant

**A cap expiry must not produce a live CLI session with a closed host control channel.**

"Stop waiting for background work" and "close the input channel" must stop being the same
operation. Ending the turn outright is strictly better than a half-dead session that keeps
producing plausible output with four capabilities silently gone.

Directions to weigh — the choice is the implementer's, the invariant is the requirement:

- **End the turn on expiry.** Drive the `AbortController` the way `abort()` does, rather than only
  ending the input iterable, so no half-dead session can survive.
- **Extend the cap while work is live.** Keep re-arming `capTimer` as long as the task registry
  still sees live work, and treat the cap as a final timeout for the whole run rather than for
  the hold.
- **Count subagent traffic as activity.** Today `parent_tool_use_id` disqualifies it in
  `isMainModelActivity` (`background-hold.ts:66-76`), yet long subagent stretches are exactly
  what reaches the cap.

Whichever direction is taken, the cap must stay **coordinated** with `collectEvents()`'s default
(120s, `src/utils.ts`) and with the consumer's `timeoutMs` — both of which currently sit *above*
it, so the adapter kills the channel before either has a chance to time out cleanly.

And regardless of direction: when the channel does go down, the run must terminate with a
**typed, machine-readable error**. A warning string alongside dozens of successful-looking empty
tool results is not a signal a consumer can act on.

<!-- anchor: gaps0001 -->
## Adjacent gaps to cover in the same change

1. **`touchedATask()` never prunes** (`background-hold.ts:144`). One subagent early in a run arms
   the hold at *every* subsequent `result` for the rest of the run. This is what makes the cap
   reachable in otherwise ordinary turns. Prune finished tasks out of `kindById`.

2. **The cap cannot be disarmed** (`src/options.ts:164-193`). `claude_backgroundHoldCapMs` and
   `claude_backgroundGraceMs` can only be raised: `positiveMsOption`
   (`claude-code.ts:483-485`) silently degrades a non-positive value back to the default.
   Consumers have no escape hatch. A sentinel (`0`, `null` or `Infinity`) must disable the timer
   rather than reset it.

3. **Adapter state is per-instance, not per-run.** `pushHandler`, `closeInputChannel`,
   `activeQuery` and `abortController` are fields on the adapter. Two concurrent `execute()` calls
   on one adapter clobber each other, and `abort()` only reaches the most recent one. Run state
   belongs in a per-`execute()` context object.

4. **Abort/timeout early returns leak pending callbacks.** The early returns at
   `claude-code.ts:1322-1332`, `1341-1347` and `1761-1768` do not settle `pendingUserInputs` —
   only the drain path at `1249-1256` does. A `canUseTool` or `onElicitation` promise pending in
   the SDK at that moment never resolves, leaking the callback and its closure until the process
   exits. Every exit path must settle the pending map.

5. **A shared `McpServer` instance reused across `execute()` calls is a live hazard.**
   `Protocol.connect()` throws `"Already connected to a transport"`; the Agent SDK swallows that
   rejection into a debug log and still advertises the server, so every later `mcp_message` hits
   `"SDK MCP server not found"` — the same empty-result signature from a different cause. Nothing
   in this library guards it. At minimum document the per-run contract; better, detect and reject
   a reused instance eagerly.

<!-- anchor: verif001 -->
## Verification

- **Repro:** a run with a subagent or a `run_in_background` Bash lasting >90s, then any MCP call.
  Today: the cap warning, then empty MCP results for the rest of the run.
- **Mechanism confirmation:** with `DEBUG_CLAUDE_AGENT_SDK=1`, the log must show
  `"[Query] Calling transport.endInput()"` followed by
  `"[ProcessTransport] Dropping write to ended stdin stream"` on each MCP call.
- **Regression test shape:** drive the hold to cap expiry with a live task registry and assert
  the run terminates with a typed error rather than continuing with a closed channel.
- **Suites to extend:** `src/adapters/claude-code.background-hold.test.ts`,
  `src/adapters/claude-code.background-tasks.test.ts`,
  `src/adapters/claude-code.background-routing.test.ts`.

<!-- anchor: impl0001 -->
## For implementers

1. `src/adapters/claude-code.background-hold.ts:299-306` — split `expire()` into two effects.
   It must stop *waiting* without calling `closeChannel()` on a live session. Give the hold an
   `onExpire` outcome the caller decides (`abort-turn` vs `release-hold`), instead of hard-wiring
   `closeChannel()`.
2. `src/adapters/claude-code.ts:1133-1141` — the `closeChannel` wiring
   (`inputChannel.close()`) is where the severing happens. If expiry is to end the run, drive
   the same path `abort()` uses (`abortController.abort()` + `q.interrupt()`) and emit a typed
   terminal error event, not a warning row.
3. `src/adapters/claude-code.background-hold.ts:144` — prune `kindById` when a task reports
   completion so `touchedATask()` stops latching for the whole run.
4. `src/adapters/claude-code.background-hold.ts:66-76` and `:365-373` — decide whether
   `parent_tool_use_id`-bearing (subagent) traffic counts as activity for the purposes of
   releasing the hold and/or re-arming `capTimer`. If it does, `touch()` must also extend
   `capTimer`, not just `graceTimer`.
5. `src/adapters/claude-code.ts:483-485` (`positiveMsOption`) and `src/options.ts:164-193` —
   add a disarm sentinel for `claude_backgroundHoldCapMs` / `claude_backgroundGraceMs` instead of
   silently degrading non-positive values to the default.
6. `src/adapters/claude-code.ts:1727-1745` — the `result`-handler branch that calls
   `hold.begin()`; re-check it once `touchedATask()` prunes, so the hold is armed only when work
   is genuinely live.
7. `src/adapters/claude-code.ts:1322-1332`, `:1341-1347`, `:1761-1768` — settle
   `pendingUserInputs` on every abort/timeout exit path, mirroring the drain at `:1249-1256`, so
   pending `canUseTool` / `onElicitation` promises reject instead of leaking.
8. Move `pushHandler`, `closeInputChannel`, `activeQuery`, `abortController` off the adapter
   instance into a per-`execute()` run context; make `abort()` address a run, not "the most
   recent one".
9. `src/utils.ts` — reconcile `collectEvents()`'s 120s default with the new cap semantics so the
   adapter no longer kills the channel below the consumer's own timeout.
10. Document the per-run `McpServer` contract (one instance per `execute()`), and add an eager
    guard against reuse rather than letting it surface as `"SDK MCP server not found"`.
11. Extend `src/adapters/claude-code.background-hold.test.ts`,
    `claude-code.background-tasks.test.ts` and `claude-code.background-routing.test.ts` per the
    regression shape above.
