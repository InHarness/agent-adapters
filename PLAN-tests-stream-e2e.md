# PLAN — tests that demonstrate the streaming-input `Stream closed` bug

**Scope: tests only.** No change to `src/adapters/claude-code.ts` or any other production file. The
deliverable is executable proof that the defect exists on `main`, plus the assertions that will flip
green once the fix lands (fix is planned separately in `PLAN-streamingn-input-fix.md`).

Run on a **worktree**, finished with a **draft PR — never merged**.

---

## RESULTS ROUND 2 — the reported symptom IS reproducible

`Tool permission request failed: Error: Stream closed` now reproduces locally, on the repo's own
SDK pin (0.3.153), sonnet-4.6 — three occurrences per failing run, exactly as reported.

| work shape | prompt path | 0.3.153 | 0.3.210 |
|---|---|---|---|
| backgrounded bash | one-shot | **FLAKY** — `Stream closed` on 1 of 3 runs | FAIL — wake-up lost entirely |
| backgrounded bash | streaming | **FLAKY** — `Stream closed` on 1 of 2 runs | pass (1 run) |
| subagents | one-shot | **FLAKY** — `Stream closed` on 1 run, 1 inconclusive | not run |
| subagents | streaming | inconclusive (1 run) | not run |

- **Every shape and both prompt paths produce it.** So the Round 1 conclusion — that only the SDK's
  `isSingleUserTurn` stdin close mattered — is **falsified**. What all paths share is that the
  adapter closes its side of the transport at the turn's `result` while the engine keeps the session
  alive for in-flight background work.
- **It is timing-dependent**, which is why these stay plain `it` and not `it.fails` (a `.fails` test
  would fail on the runs that happen to succeed). This also explains the consumer's "it started
  working after a restart".
- **Engine-side confirmation** (`DEBUG_CLAUDE_AGENT_SDK=1` → `~/.claude/debug/latest`): the CLI is
  spawned with `--permission-prompt-tool stdio`, and on failure it logs
  `executePermissionRequestHooks called for tool: AskUserQuestion` immediately followed ~4ms later by
  `AskUserQuestion tool permission denied` — no host round-trip at all. The permission request has
  nowhere to go, so the CLI denies locally; the model retries twice and falls back to prose.
- **The 0.3.210 wake-up loss is a separate, deterministic defect** — there the model is never woken
  at all, so there is no ask to lose.

Second, unrelated defect found deterministically (mocked SDK, no live model):

- **`abort()` cannot terminate a run parked on an unanswered `onUserInput`.** The loop does
  `await effectiveUserInputHandler(...)` with nothing racing the abort signal, and `abort()` only
  aborts the `AbortController` and closes the input channel. A host whose handler resolves on a human
  reply therefore can never reclaim the session — adapter and SDK subprocess both leak. Reproduced as
  a hung pull; committed as `it.fails`.

---

## RESULTS ROUND 1 — superseded in part by the above

The hypothesis in §1 below was only partly right; the live runs corrected it.

| config | SDK 0.3.153 (repo pin) | SDK 0.3.210 (consumer) |
|---|---|---|
| default one-shot string prompt | ✅ wake-up + ask delivered (35s) | ❌ run ends after the notification, `handlerCalls === 0` (13s) |
| `streamingInput: true` | ✅ | ✅ |

- **The adapter's close-on-`result` is not the cause.** The streaming path closes the channel too
  and survives on both SDK versions. The deterministic test was therefore rewritten from an
  `it.fails` defect assertion into a **characterization** test — asserting an invariant the evidence
  does not support would have been dishonest.
- **The reproducing variable is the SDK's single-turn shutdown.** `query()` sets `isSingleUserTurn`
  when the prompt is a plain string; `readMessages` then logs *"First result received for
  single-turn query, closing stdin"* and calls `transport.endInput()`. On 0.3.210 that kills the
  post-`result` background-task wake-up outright: the task settles, `subagent_completed` fires, and
  the run ends without the model ever being resumed.
- **The declared peer range `>=0.3.0 <0.4.0` spans a behavioural break.** A finding in its own
  right — the live e2e is the guard that catches it on an SDK bump.
- **`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` is real but a red herring here.** 0.3.210 emits it on every
  run (`bypassPermissions` shadows `canUseTool`), yet both pre-existing AskUserQuestion e2e
  scenarios still pass on 0.3.210 — AskUserQuestion is evidently exempt from the shadowing.
- **Not reproduced:** the consumer's `AbortError: Stream closed`. In that report the model *was*
  woken and *did* attempt the ask; in every reproduction here it is never woken at all.

---

## 1. What we are proving

`agent-chat` loses every `AskUserQuestion` right after background work settles:

```
[sub bqlb3e89y] ✓ stopped
[tool] AskUserQuestion (toolu_01Bvn3aKWJ6mdixjCLHHvF3g)
[result] Tool permission request failed: AbortError: Stream closed
```

Causal chain (all line refs against `main` @ `e166561`):

1. `src/adapters/claude-code.ts:1288-1295` — on `result` the streaming input channel is closed
   unless a `pushMessage()` is pending. A pending push is the **only** keep-open condition.
2. SDK `Query.streamInput()` turns an ended prompt iterable into `transport.endInput()` →
   `processStdin.end()` (log string in `sdk.mjs`: *"Calling transport.endInput() to close stdin to
   CLI process"*). Our `close()` therefore closes the CLI's **stdin**.
3. The control protocol — `can_use_tool`, hooks, elicitation — is multiplexed over that same stdin,
   so the SDK can no longer write a response → `AbortError: Stream closed`.
4. With background work in flight the CLI holds the session open **past `result`** and wakes the
   model on `task_notification`. The signal is `SDKResultMessage.background_tasks?:
   BackgroundTaskSummary[]` (`sdk.d.ts:5693`; element shape at `sdk.d.ts:123`).
5. The adapter never reads it — `grep -rn "background_tasks" src/` → 0 hits.

**The invariant both tests encode:** while a run holds in-flight background work, the input/control
channel must stay open.

---

## 2. Deliverable A — deterministic regression test (the CI gate)

New file: `src/adapters/claude-code.background-tasks.test.ts`.

Reuses the mocked-SDK harness from `src/adapters/claude-code.path-scope.test.ts` (`vi.mock` with
`importOriginal`, so the real package stays resolvable and the adapter's `checkPeerSdkVersion` gate
passes). The difference: the fake `query()` must **drive the input iterable**, because the channel
lifecycle is the thing under test.

### Skeleton

```ts
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return { ...actual, query: (args) => fakeQuery(args) };
});

// Set per-test by the harness below.
let script: (args: { prompt: any; options: any }) => AsyncGenerator<unknown>;
const fakeQuery = (args) => script(args);
```

Per-test script for the **bug case**:

```ts
let inputDoneAfterResult: boolean | null = null;
let pendingAfterResult: Promise<IteratorResult<unknown>> | null = null;

script = async function* ({ prompt, options }) {
  const it = prompt[Symbol.asyncIterator]();
  await it.next();                                  // consume the seed prompt

  yield { type: 'result', subtype: 'success', result: 'ok',
          usage: { input_tokens: 10, output_tokens: 5 }, session_id: 'sess-1',
          background_tasks: [{ id: 'bg-1', type: 'shell', status: 'running',
                               description: 'sleep 12' }] };

  // ---- the measurement ----
  // On `main` the adapter has already closed the channel here, which in production
  // is exactly `stdin.end()`. Race one tick to distinguish closed from pending.
  pendingAfterResult = it.next();
  const TICK = Symbol();
  const winner = await Promise.race([
    pendingAfterResult,
    new Promise((r) => setImmediate(() => r(TICK))),
  ]);
  inputDoneAfterResult = winner !== TICK && (winner as IteratorResult<unknown>).done === true;

  // ---- the wake-up the CLI performs after the background task settles ----
  yield { type: 'system', subtype: 'task_notification', task_id: 'bg-1', status: 'completed' };

  // Stand-in for the control request that dies in production. The adapter's loop
  // services this via its user-input waker while we await here.
  await options.canUseTool(
    'AskUserQuestion',
    { questions: [{ question: 'A or B?', options: [{ label: 'A' }, { label: 'B' }] }] },
    { toolUseID: 'toolu_test' },
  );

  yield { type: 'result', subtype: 'success', result: 'done',
          usage: { input_tokens: 4, output_tokens: 2 }, session_id: 'sess-1',
          background_tasks: [] };
};
```

Drive it with `collectEvents(adapter.execute(createTestParams({ streamingInput: true, onUserInput })))`
where `onUserInput` records each request and returns `{ action: 'accept', answers: [['A']] }`.

### Assertions

```ts
// THE invariant — red on main.
expect(inputDoneAfterResult, 'input channel must stay open while background work is in flight')
  .toBe(false);

// The question reached the host.
const reqs = events.filter((e) => e.type === 'user_input_request');
expect(reqs).toHaveLength(1);
expect(handlerCalls).toBe(1);

// Teardown still happens: the retained pending pull resolves done once the run ends.
await expect(pendingAfterResult).resolves.toMatchObject({ done: true });
```

### Control case (same file, must be green on `main` and stay green after the fix)

Identical script but the first `result` carries `background_tasks: []` and no push is pending →
`inputDoneAfterResult === true`. This pins the existing one-shot contract and the atomicity note at
`claude-code.ts:1283-1287` ("an empty channel is closed synchronously here, so a late
`pushMessage()` returns `false`") so the fix cannot quietly regress mid-turn push.

### Gotchas found while tracing — read before writing this file

- **The event is `user_input_request`**, not `user_input_requested` (`src/types.ts:262`).
- **Do not `await` `canUseTool` before yielding the wake-up message.** The adapter's loop
  (`claude-code.ts:958-1035`) races `sdkIterator.next()` against `userInputWaker`; `canUseTool`
  pushes onto `pendingUserInputs` and fires the waker, the loop wakes, drains, calls the handler and
  resolves our promise. Awaiting inside the generator is exactly what the race is built for — but
  only one pull may be outstanding at a time.
- **Only ever hold one pending `it.next()`.** `createInputChannel` (`claude-code.ts:380-425`) keeps a
  single `resolveNext`; a second concurrent `next()` overwrites it and the first promise never
  settles. Retain `pendingAfterResult`, do not pull again.
- **`streamingInput: true` is mandatory** — without it there is no `inputChannel` and the bug cannot
  exist (`claude-code.ts:895`).
- **`onUserInput` is mandatory** — `options.canUseTool` is only registered when a handler resolves
  (`claude-code.ts:725-726`).

---

## 3. Deliverable B — live e2e (the acceptance gate)

New scenario in `src/testing/e2e/claude-code.e2e.test.ts`, inside the existing
`describe.skipIf(SKIP)` block, using the file's `MODEL` constant. Prompt constants go in
`src/testing/e2e/shared.ts` next to `USER_QUESTION_PROMPT` / `SUBAGENT_PROMPT`; the assertion reuses
the existing `assertUserInputRequest(events)` (`shared.ts:381`).

- `streamingInput: true`, plus an `onUserInput` handler recording every request and answering with
  the first option.
- The prompt must pin **both** halves explicitly rather than hoping the model volunteers them: run a
  shell command in the background via the Bash tool's `run_in_background: true`, wait for it to
  finish, and only *then* use `AskUserQuestion` to ask which of two options to pick.
- Assert: at least one `user_input_request`; no event text containing `Stream closed`; the run
  reaches a `result`.
- Expected failure mode on `main`: **no** `user_input_request`, plus a tool result carrying
  `Tool permission request failed: AbortError: Stream closed`.
- Capture the raw failing output — it goes in the PR body as before-evidence.
- If the scenario proves flaky at the default tier, keep it `.skip`ped with the reason in a comment
  rather than loosening the assertion into something that cannot fail.

Run: `npm run test:e2e:claude`, optionally `E2E_CLAUDE_MODEL=opus-4.7`.

---

## 4. Red/green protocol

Commit Deliverable A's bug case as **`it.fails(...)`** (vitest passes a `.fails` test when its body
throws), with a comment naming this plan and `PLAN-streamingn-input-fix.md`. CI stays green while the
repo carries an *active* check that the defect still exists — if someone fixes it accidentally, the
`.fails` test goes red and tells us. The fix commit flips `it.fails` → `it`.

The alternative — commit `.skip`ped and un-skip with the fix — matches the precedent in `1718975`
("Un-skips the committed acceptance e2e"), but verifies nothing in the meantime. Prefer `it.fails`
for the mocked test; use `.skip` for the live e2e only if it turns out flaky.

---

## 5. Worktree workflow

```bash
git worktree add ../agent-adapters-tests-stream test/stream-closed-background-tasks
cd ../agent-adapters-tests-stream
npm install
```

- Branch: `test/stream-closed-background-tasks`.
- Commits: one for Deliverable A, one for Deliverable B (so the live-e2e evidence is reviewable on
  its own).
- Finish with `gh pr create --draft`. **Do not merge.** PR body carries the failing live-e2e output
  and links `PLAN-streamingn-input-fix.md` as the follow-up.

---

## 6. Acceptance criteria

- `npm run typecheck` clean.
- `npm test` green — the `it.fails` bug case passes *because* the defect is present; the control case
  passes on its own merit.
- `npm run test:e2e:claude` shows the new live scenario failing with `Stream closed` on `main`, and
  that output is pasted into the PR.
- `git diff --stat` touches only `src/adapters/claude-code.background-tasks.test.ts`,
  `src/testing/e2e/claude-code.e2e.test.ts`, `src/testing/e2e/shared.ts`, and `PLAN-*.md`. **Nothing
  under `src/adapters/claude-code.ts`.**
