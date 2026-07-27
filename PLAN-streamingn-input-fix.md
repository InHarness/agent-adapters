# PLAN — streaming-input: stdin closes while the session is still live

**Status:** tests first. Phase 1 (this plan's deliverable) writes tests that *demonstrate* the bug
on `main`. Phase 2 fixes it and flips the same tests green. No `src/adapters/` change lands in
Phase 1.

> **UPDATE (live evidence) — the root cause stated below is WRONG. Read this first.**
>
> The Phase 1 tests were written and run against a live model. What they found:
>
> | config | SDK 0.3.153 | SDK 0.3.210 |
> |---|---|---|
> | default one-shot string prompt | ✅ wake-up + ask delivered (35s) | ❌ run ends after the notification, `handlerCalls === 0` (13s) |
> | `streamingInput: true` | ✅ | ✅ |
>
> So the adapter's close-on-`result` (§1 below) is **not** the cause — the streaming path
> closes the channel too and survives on both versions. The reproducing variable is the
> **SDK's own single-turn shutdown**: `query()` sets `isSingleUserTurn` when the prompt is a
> plain string, and `readMessages` then logs *"First result received for single-turn query,
> closing stdin"* and calls `transport.endInput()`. On 0.3.210 that kills the post-`result`
> background-task wake-up entirely — the model is never resumed, so everything it was told to
> do after the task (asking included) silently never happens. On 0.3.153 the same close is
> survivable.
>
> Both versions satisfy the declared peer range `>=0.3.0 <0.4.0`, so **that range spans a
> behavioural break** — which is its own finding, independent of the fix.
>
> Fix direction changes accordingly: stop handing the SDK a bare string when a run may hold
> background work (always drive the input-channel path, so `isSingleUserTurn` is false),
> rather than reworking the keep-open condition. Reading `background_tasks` stays defensible
> as hardening, not as the fix.
>
> Still unexplained: the consumer's `AbortError: Stream closed`. There the model *was* woken
> and *did* attempt the ask; in the reproduction it is never woken at all. Same area,
> plausibly the same root cause, not yet demonstrated.

---

## Context — what is broken

`agent-chat` loses every `AskUserQuestion` right after background/subagent work settles:

```
[sub bqlb3e89y] ✓ stopped
[tool] AskUserQuestion (toolu_01Bvn3aKWJ6mdixjCLHHvF3g)
[result] Tool permission request failed: AbortError: Stream closed
```

The model retries, fails again, and falls back to asking in prose — so the host UI never gets its
question and the run looks like it auto-rejects them.

### Causal chain (read out of the code + the SDK bundle; not yet reproduced — that is Phase 1)

1. `src/adapters/claude-code.ts:1288-1295` — on `result` the streaming input channel is closed
   unless a `pushMessage()` is pending. **A pending push is the only keep-open condition:**
   ```js
   if (resultEvent.subtype === 'success' && inputChannel.hasPending()) {
     // keep open
   } else {
     inputChannel.close();
   }
   ```
2. SDK `Query.streamInput()`: when the prompt iterable ends it calls `transport.endInput()` →
   `processStdin.end()`. Log string in `sdk.mjs`: *"[Query] Calling transport.endInput() to close
   stdin to CLI process"*. So our `close()` closes the CLI's **stdin**.
3. The control protocol — `can_use_tool`, hook callbacks, elicitation — is multiplexed over that
   same stdin. Once closed the CLI can still emit a control *request*, but the SDK can never write
   the *response* → `AbortError: Stream closed`.
4. With background work in flight the CLI **deliberately holds the session open past `result`**: the
   turn's `result` arrives, the session pauses, `task_notification` wakes the model, which then
   calls `AskUserQuestion`. The signal is `SDKResultMessage.background_tasks?:
   BackgroundTaskSummary[]` (`sdk.d.ts:5693`, element shape at `sdk.d.ts:123`).
5. The adapter **never reads `background_tasks`** — `grep -rn "background_tasks" src/` → 0 hits.

### Why it surfaces now

Latent since **0.7.0**: `git log -S "hasPending" -- src/adapters/claude-code.ts` → `653df28`
(mid-turn push), untouched since. `task_notification` handling dates to the initial commit. Neither
0.8.6 (task-tracking renames) nor 0.9.0 (path-scope) went near it. Three things must coincide:
`streamingInput: true`, a turn ending with background work in flight, and the model asking a
question *after* being woken. The consumer runs `@anthropic-ai/claude-agent-sdk` **0.3.210** while
this repo dev-pins **0.3.153** — the session-hold-on-background-tasks behaviour is recent CLI-side.

### Adjacent defects found while tracing (not the cause; do not fix in Phase 1)

- **`task_type` dropped.** `claude-code.ts:1204-1231` reads only `task_id`, so backgrounded Bash
  surfaces as `subagent_started` / `subagent_completed` — the `[sub …] ✓ stopped` noise in the log.
  Already a documented *known gap* in `spec/adapters/A01-claude-code.md:66`.
- **`task_updated` unhandled.** The SDK has four `task_*` subtypes (`task_started`, `task_progress`,
  `task_notification`, `task_updated` — `sdk.d.ts:3693`); the adapter handles three.
- **`skip_transcript` ignored.** `SDKTaskStartedMessage.skip_transcript` marks ambient/housekeeping
  tasks that consumers *should hide* from the inline transcript. The adapter drops the flag, so
  housekeeping tasks are rendered inline.
- **`canUseTool` shadowed.** Under the adapter's default `permissionMode: 'bypassPermissions'`
  (`claude-code.ts:496`) the SDK warns `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` and never consults
  `options.canUseTool` (`:727`). The consumer's log shows the AskUserQuestion control request *was*
  issued, so AskUserQuestion appears exempt from the shadowing — confirm before touching this.
- **Soft path-scope `dontAsk`.** `claude-code.ts:496` + `:642-647` set a default-deny mode whose
  allow-list holds only `Read`/`Edit`/`Write` rules. Whether the CLI then denies
  `Task`/`AskUserQuestion`/`TodoWrite` is **unverified** and did not cause the symptoms above.

---

## Phase 1 — tests that prove the bug (the deliverable)

Two layers, because a live model cannot be trusted to reproduce a timing-shaped bug on demand and a
mock cannot prove the real transport closes.

### 1a. Deterministic regression test — the CI gate

New file: `src/adapters/claude-code.background-tasks.test.ts`. Reuses the mocked-SDK harness
pattern from `src/adapters/claude-code.path-scope.test.ts` (`vi.mock('@anthropic-ai/claude-agent-sdk')`
capturing `options`), but the fake `query()` must additionally **drive the input iterable**, because
the channel lifecycle is what we are asserting.

Fake `query({ prompt, options })` script:

1. Take `const it = prompt[Symbol.asyncIterator]()` and pull the seed message (`await it.next()`).
2. Yield an assistant message, then a `result` with `subtype: 'success'` and a **non-empty**
   `background_tasks: [{ id: 'bg-1', type: 'shell', status: 'running', description: 'sleep 12' }]`.
3. **The assertion point.** Pull again and check whether the channel is already done:
   ```js
   const next = it.next();
   const TICK = Symbol();
   const winner = await Promise.race([next, new Promise((r) => setImmediate(() => r(TICK)))]);
   inputDoneAfterResult = winner !== TICK && winner.done === true;
   ```
   On `main` this is `true` — the adapter closed the channel, which is exactly `stdin.end()` in
   production. The invariant is that it must be `false` while background work is in flight.
4. Simulate the wake-up: yield `{ type: 'system', subtype: 'task_notification', task_id: 'bg-1',
   status: 'completed' }`, then call `options.canUseTool('AskUserQuestion', { questions: [...] },
   { toolUseID: 'toolu_test' })` — this stands in for the control request that dies in production.
5. Yield a final `result` with `background_tasks: []` and finish, so the adapter's `finally`
   (`:1317`) tears down and the pending `next()` resolves rather than hanging the test.

Assertions:

- `expect(inputDoneAfterResult).toBe(false)` — *the* invariant. Red on `main`.
- `expect(userInputRequests).toHaveLength(1)` — the `onUserInput` handler passed to `execute()` was
  reached after the wake-up.
- Control case in the same file: a `result` with `background_tasks: []` and no pending push **must**
  close the channel (`inputDoneAfterResult === true`) — this pins the existing one-shot contract so
  the Phase 2 fix cannot regress it.

**Committing it red.** Write both as `it.fails(...)` (vitest passes a `.fails` test when its body
throws), with a comment naming this plan, so CI stays green while the repo carries executable proof
of the defect. Phase 2 flips `it.fails` → `it`. The alternative — commit `.skip`ped and un-skip with
the fix — matches the precedent set in `1718975` ("Un-skips the committed acceptance e2e"); either
is fine, `it.fails` is preferred because it actively verifies the bug still exists.

### 1b. Live e2e — the acceptance gate

New scenario in `src/testing/e2e/claude-code.e2e.test.ts`, inside the existing
`describe.skipIf(SKIP)` block, using `MODEL` and the file's own conventions. Prompt/system-prompt
constants go in `src/testing/e2e/shared.ts` next to `USER_QUESTION_PROMPT` /
`SUBAGENT_PROMPT`, and the request assertion reuses `assertUserInputRequest`.

- `streamingInput: true` (the bug needs the channel path) + an `onUserInput` handler that records
  every request and answers with the first option.
- Prompt must pin *both* halves explicitly rather than hoping the model volunteers them: run a
  shell command in the background via the Bash tool's `run_in_background: true`, wait for it to
  finish, and only *then* use `AskUserQuestion` to ask which of two options to pick.
- Assert: at least one `user_input_requested` event; no event carrying `Stream closed`; the run
  reaches a `result`.
- Expect red on `main` — the failure mode is *no* `user_input_requested` plus a
  `Tool permission request failed: AbortError: Stream closed` tool result.
- Keep it `.skip`ped-with-reason if it proves flaky on the model tier, and note the flakiness in the
  test comment rather than loosening the assertion into meaninglessness.

Run: `npm run test:e2e:claude`, optionally `E2E_CLAUDE_MODEL=opus-4.7`.

### Phase 1 exit criteria

- `npm run typecheck && npm test` green (the `it.fails` tests pass *because* the bug is present).
- The live e2e observably fails on `main` with `Stream closed`, and that output is pasted into the
  Phase 2 PR as the before-evidence.
- Zero changes under `src/adapters/`.

---

## Phase 2 — the fix (separate pass, after Phase 1 is reviewed)

1. **Keep the channel open while the session is live.** In `case 'result'` (~`:1288`), read
   `background_tasks` off the result and make the keep-open condition
   `inputChannel.hasPending() || hasInFlightBackgroundTasks(result)`. The SDK emits a further
   `result` once the woken model finishes; that one reports an empty list and closes the channel
   through the existing path. The `finally` block already closes on iterator `done`.
2. **Fallback signal** for a CLI that omits `background_tasks`: track `task_started` ids against
   `task_notification` ids (the loop already maintains `subagentTaskIdByParentToolUseId` at `:821`)
   and treat unsettled ids as in-flight.
3. **Bounding.** A task that never settles must not hang the run. `timeoutMs` / `abort()` (M13)
   already bound it — `abort()` calls `closeInputChannel` at `:442`. Add a unit assertion that abort
   still terminates cleanly with the channel held open.
4. **Do not disturb** the atomicity note at `:1283-1287` ("an empty channel is closed synchronously
   here, so a late `pushMessage()` returns `false`") — the mid-turn-push contract depends on it, and
   the control case in 1a guards it.
5. Flip the Phase 1 tests to `it(...)` / un-skip. Release as **0.9.1** (patch).

## Phase 3 — spec alignment

`spec/adapters/A01-claude-code.md:67` claims *"Push resume — loop ends on `done`, not on `result`.
The adapter's consume loop already ends only when the SDK iterator is `done`"*. True of the
**message loop**, but it misses that closing the **input channel** at `result` tears down the
control transport. Add the missing invariant to `spec/modules/M17-background-tasks.md` (Unified
Contract) and mirror the mechanics in A01:

> While a run holds in-flight background work, the adapter MUST keep its input/control channel
> open. Closing it ends the engine's control transport, so any post-`result` user-input or
> permission request fails — a silent capability loss, not a visible error.

`spec/modules/M17-background-tasks.md` and its `.claude4spec/entities/ac/*` files are currently
**untracked** and need committing with this work.

## Execution route

`CLAUDE.md` bars the spec assistant from editing `src/`, and the standing preference is a separate
worktree finished with a **draft PR, never merged**. Phase 1 is test-only but still lives under
`src/`, so it belongs in that worktree pass — not in this spec-side session.

## Verification

- `npm run typecheck && npm test` — unit suite including the new channel-lifecycle assertions.
- Phase 1 live e2e red on `main` → green after Phase 2, run against a real model. A mocked SDK
  cannot reproduce a closed stdin; the mock proves the *invariant*, the e2e proves the *symptom*.
- Existing mid-turn-push e2e coverage (`:366`, `:893`) must stay green — Phase 2 changes the close
  condition that feature depends on.
- Smoke against the real consumer: `npm link` the branch into `claude4spec` / `agent-chat` and re-run
  the flow that produced the `Stream closed` log.
