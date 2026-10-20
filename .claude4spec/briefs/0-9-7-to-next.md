---
type: brief
source: analysis
from_release: 0.9.7
to_release: null
generated_at: '2026-08-27T08:28:14.992Z'
generator_version: brief-author@0.1
implemented: true
---
# Analysis brief: 0.9.7 → (next)

<!-- anchor: a1precond -->
## Precondition — this brief is DEPENDENT, do not start yet

**Do not implement from this brief until the specification edits it depends on have landed in `spec/`.**

The contract described below was settled in a specification thread, but the resulting spec edits have **not been applied**. As of authoring, `spec/` still carries the pre-contract text:

- `spec/modules/M06-subagents.md`, section "Unified Contract (L1)", still reads:
  `- Lifecycle: `subagent_started { taskId, description, toolUseId }`, `subagent_progress { taskId, description, lastToolName? }`, `subagent_completed { taskId, status, summary?, usage? }`.`
  There is no declared vocabulary for `status`, and no abort/teardown flush obligation anywhere in the file.
- `spec/adapters/A01-claude-code.md` documents the `task_type` routing split (subagent kinds to `subagent_*`, `shell`/`monitor`/`workflow` to `background_task_*`) but says nothing about mapping `task_notification.status`.
- `spec/modules/M12-conformance-release.md` carries the generic contract-extension checklist, but no note about this specific behavioral change.
- A repo-wide grep for `aborted` / `stopped` as a `subagent_completed.status` value returns nothing.

**Pending source of the contract:** plan artifact `abort-x-subagents-closing-the-lifecycle-gap-between-m06-m13-and-m17.md` (version 5), produced in spec thread `-pzFScNt1ViJ`. That plan targets `M06` (the status vocabulary + the flush obligation + the per-adapter scope of the flush), `M12` (the semver / CHANGELOG obligation) and `A01` (the claude-code status map).

**What this means for you, the implementer:**

1. First check whether those M06 / M12 / A01 edits are in `spec/`. If they are not, this work is not ready — the spec is canon and it has not spoken yet.
2. Once they are in, **read the settled spec text and treat it as authoritative**. Everything in the "Settled contract" section below is a *summary of a plan*, not a quotation of canon. Where the applied spec text differs from this brief — in wording, in scope, in the exact status strings — the spec wins and this brief is stale.
3. The one exception is the section marked **"Stands alone"** below. That defect is live in the code today, independent of the abort work, and only needs the status vocabulary from M06 to be actionable.

Everything else in this brief — the code facts, file paths, line numbers, verbatim snippets — was read directly from the working tree at `0.9.7` + unreleased changes, and is accurate regardless of the spec's state.

<!-- anchor: a2summary -->
## What this change is about

A consumer that pairs `subagent_started` with `subagent_completed` — building a per-subagent view, a progress UI, a cost breakdown — is currently guaranteed a matching pair only when the run ends normally. If the run is aborted or times out while a subagent is in flight, the `subagent_started` never gets its partner. The consumer is left holding an open pair forever, with no event telling it the delegation is over. This is not a rare path: `abort()` is the documented way to stop a run, and delegation is exactly the situation where a consumer wants to stop early.

The library's own helper has the same blind spot. `splitBySubagent` in `src/utils.ts:95` sorts events into `main` and `subagent` buckets:

```ts
export async function splitBySubagent(
  stream: AsyncIterable<UnifiedEvent>,
): Promise<{ main: UnifiedEvent[]; subagent: UnifiedEvent[] }> {
```

It faithfully reproduces the defect: on an aborted run, the `subagent` bucket contains a `subagent_started` with no terminator.

Separately and independently, the claude-code adapter is already leaking a status value onto the unified surface that no other adapter produces and that nothing in this repo handles.

This change closes both: it makes abort/timeout a *closing* event for subagent lifecycle, and it makes claude-code map its SDK's status vocabulary onto the unified one instead of forwarding it raw.

<!-- anchor: a3standalone -->
## Stands alone — the claude-code status pass-through (live today, no abort work needed)

This part is **implementable and testable the moment the status vocabulary lands in M06**. It does not depend on the flush work, and it can ship first.

`src/adapters/claude-code.ts:1907` forwards the SDK's status verbatim:

```ts
} else {
  yield {
    type: 'subagent_completed',
    taskId,
    status: e.status as string,
    summary: e.summary as string | undefined,
    // Per-subagent total (sum across the subagent's turns).
    usage: normalizeClaudeUsage(e.usage),
  };
}
```

The SDK types that field as a closed three-value union — `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4463`:

```ts
export declare type SDKTaskNotificationMessage = {
    type: 'system';
    subtype: 'task_notification';
    task_id: string;
    tool_use_id?: string;
    status: 'completed' | 'failed' | 'stopped';
    output_file: string;
    summary: string;
    usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
};
```

So `'stopped'` can already reach the unified surface from claude-code. The other two subagent-capable adapters never produce it:

- `src/adapters/gemini.ts:805` collapses everything to two values:
  ```ts
  status: (event.reason as string) === 'failed' ? 'failed' : 'completed',
  ```
- `src/adapters/opencode.ts:696` and `:725` hardcode `'completed'` and `'failed'` respectively, one per SSE tool state.

`'stopped'` is handled nowhere in the repo and asserted nowhere in the test suite. That is the drift: one adapter emits a third value onto a surface the others treat as two-valued, and no test would notice if the SDK added a fourth.

The fix is to **map, not forward** — see the mapping rules in the settled-contract section below.

<!-- anchor: a4defects -->
## The three defects, precisely

### 1. No test at any tier aborts a run with subagents in flight

Each adapter has exactly one abort case, and all four abort a plain-text run that spawns nothing:

| file | line | case |
| --- | --- | --- |
| `src/testing/e2e/claude-code.e2e.test.ts` | 440 | `it('abort mid-stream', ...)` |
| `src/testing/e2e/codex.e2e.test.ts` | 117 | `it('abort mid-stream', ...)` |
| `src/testing/e2e/opencode.e2e.test.ts` | 120 | `it('abort mid-stream', ...)` |
| `src/testing/e2e/gemini.e2e.test.ts` | 165 | `it('abort mid-stream', ...)` |

The subagent cases, conversely, never call `abort()`:

| file | line | case |
| --- | --- | --- |
| `src/testing/e2e/claude-code.e2e.test.ts` | 261 | `it('subagent events', ...)` |
| `src/testing/e2e/claude-code.e2e.test.ts` | 312 | `it('defines a custom subagent the model can invoke', ...)` |
| `src/testing/e2e/claude-code.e2e.test.ts` | 364 | `it('a subagent inherits the run's filesystem ceiling ...', ...)` |
| `src/testing/e2e/gemini.e2e.test.ts` | 367 | `it('subagent events carry subagentTaskId on deltas', ...)` |
| `src/testing/e2e/opencode.e2e.test.ts` | 327 | `it('subagent events carry subagentTaskId on deltas (ordering-based)', ...)` |

At the unit tier, `src/adapters/claude-code.background-tasks.test.ts` has five abort cases and none of them asserts anything about subagent events:

| line | case |
| --- | --- |
| 795 | `abort() releases a held run without waiting for the bounds` |
| 817 | `abandoning the stream tears the run down, even from before the CLI is spawned` |
| 839 | `a consumer that stops the session after its result still gets a clean end` |
| 869 | `abort() reaches every run in flight, not just the most recent` |
| 1113 | `abort() terminates a run parked on an unanswered question` |

The two axes — abort, and subagents — have never been crossed. That is why the defect below survived.

### 2. Aborting orphans the subagent lifecycle

`ClaudeCodeAdapter.abort()`, `src/adapters/claude-code.ts:653`:

```ts
abort(): void {
  for (const run of [...this.runs]) {
    this.interruptRun(run);
    run.abortController.abort();
    run.closeInputChannel?.();
  }
}
```

Three teardown steps, none of which enumerates live subagent task ids, and no `subagent_completed` is synthesized anywhere on this path.

The other two subagent-capable adapters have the same hole, but note that **their `abort()` is not where the fix goes** — their subagent state is scoped to the `execute()` generator, not to the adapter instance:

- **gemini**: `abort()` is at `src/adapters/gemini.ts:204` and is two lines (`this.aborted = true; this.abortFn?.();`). The subagent set is declared *inside* `execute()` at `src/adapters/gemini.ts:636`:
  ```ts
  // Track subagent state via threadId
  const activeSubagents = new Set<string>();
  ```
  It is added to at `:747`, deleted from at `:801`, and never flushed.
- **opencode**: `abort()` is at `src/adapters/opencode.ts:152` and is one line (`this.abortController?.abort();`). The single-active tracker is declared inside `execute()` at `src/adapters/opencode.ts:546`:
  ```ts
  let activeSubagentTaskId: string | undefined;
  ```
  It is set at `:667`, cleared at `:699` and `:728` on the two normal settle paths, and never cleared on teardown.

**Implementation consequence, and it is the main one in this brief:** the flush cannot live in `abort()` on any of the three adapters. On gemini and opencode the state is not reachable from there at all. On claude-code it is reachable via the run's task registry, but `abort()` is not where the event stream is — the stream is the `execute()` generator, and the contract requires the synthesized events to be *yielded before the terminal error event*. So on all three adapters the flush belongs on the **generator's teardown path**, immediately before the terminal `error` is yielded.

For claude-code that path is not a single site. The terminal runtime error is yielded at **five** places in `src/adapters/claude-code.ts` — lines **1564, 1621, 1635, 2071, 2077** — all of them producing the error through one shared closure defined at `:1279`:

```ts
const terminalRuntimeError = (): AdapterError =>
  timedOut
    ? new AdapterTimeoutError('claude-code', params.timeoutMs!)
    : backgroundHoldExpiredAfterMs !== null
      ? new AdapterBackgroundHoldExpiredError('claude-code', backgroundHoldExpiredAfterMs)
      : new AdapterAbortError('claude-code');
```

That closure exists because of a bug the codebase already learned from — its own comment at `:1270` says the four exit paths "used to hold three copies of the same ternary, which is exactly how a fourth reason gets added to some of them and not the others." The flush must follow the same discipline: **one shared generator helper, called at every one of the five sites**, not five inline copies. A flush wired into four of five sites is the same defect this brief exists to fix, only quieter.

Claude-code has the state it needs already. The run's task registry (`src/adapters/claude-code.ts:1241`, `const tasks = createTaskRegistry();`, implemented at `src/adapters/claude-code.background-hold.ts:177`) exposes an `inFlight` set of task ids and a `kind(taskId)` lookup returning a `TaskKind` carrying `isBackground`. The registry's `settle(taskId)` removes from `inFlight`, which means an already-settled subagent is naturally absent — the "no duplicate completion" property falls out of the data structure, but it must still be asserted, because it is a contract promise and not an accident to be relied on silently.

Note that `inFlight` holds **both** kinds. The flush must filter by `kind(taskId)?.isBackground` and synthesize `subagent_completed` only for the non-background ids. Background work has its own lifecycle and its own terminal semantics; synthesizing a subagent event for a backgrounded shell command would be a category error.

### 3. claude-code forwards the SDK status instead of mapping it

Covered in full in the "Stands alone" section above.

<!-- anchor: a5contract -->
## The settled contract (summary of the pending plan — confirm against spec once applied)

**Flush on teardown.** On `abort()` and on `timeoutMs` expiry, every subagent the adapter still has **open** is closed with a synthesized `subagent_completed` carrying `status: 'aborted'`, emitted **before** the terminal `error` event.

The scope is deliberately *"every subagent the adapter has open"*, not *"every subagent"* — the difference matters per adapter:

| adapter | flush scope | why |
| --- | --- | --- |
| claude-code | full — every non-background id in `tasks.inFlight` | native `task_*` channel gives one open pair per subagent |
| gemini | full — every `threadId` in `activeSubagents` | synthesized per-thread, one open pair per thread |
| opencode | **at most one** — `activeSubagentTaskId` if set | attribution is ordering-based with a single active subagent assumed; a nested task was never opened as its own pair, so there is nothing to close for it |
| codex | **none** | the SDK has no subagent concept; the absence is the contract |

**Status becomes a declared closed vocabulary.** `subagent_completed.status` is one of:

```
'completed' | 'failed' | 'aborted' | 'stopped'
```

**The TypeScript field stays `string`.** Do *not* narrow it to a union in `src/types.ts`. The vocabulary is a specification obligation on what adapters *produce*, not a compile-time constraint on the type — the same discipline the codebase already applies to M17's `taskType`.

**`'aborted'` and `'stopped'` are deliberately distinct:**

- `'aborted'` — the whole run ended; a terminal `error` follows immediately.
- `'stopped'` — one delegation ended while the run keeps producing events.

Collapsing them would destroy the only signal a consumer has for telling "my subagent was cancelled but the agent is still working" from "everything is over."

**claude-code maps rather than forwards.** The SDK's `'completed' | 'failed' | 'stopped'` map onto the same three unified values. An SDK status the map does **not** recognize becomes `'failed'`, plus a one-shot `warning` event.

Never `'completed'` for an unrecognized status: claiming success is the unsafe direction. The accepted cost is explicit — a subagent that actually succeeded under some new SDK wording gets reported as `'failed'`. That is a false negative chosen deliberately over a false positive. The warning is the drift signal that L7's Verified-pin discipline wants a peer-SDK bump to leave behind: someone bumps the SDK, a new status string appears, and the warning is what makes that visible instead of silent.

**Semver: minor, with a mandatory behavioral CHANGELOG note.** The note is not optional politeness. Because `status` is a free-form `string`, a consumer's exhaustive `switch` gets **no compiler warning** about the two new values, and any consumer currently branching on the forwarded `'stopped'` will see its meaning change. The CHANGELOG entry is their only signal.

<!-- anchor: a6impl -->
## For implementers

Ordered roughly by dependency. Steps 1–2 and 8–9 are the "stands alone" slice and can ship independently of the rest.

1. **`src/types.ts:203`** — add JSDoc above the `subagent_completed` line. The line today:
   ```ts
   | { type: 'subagent_completed'; taskId: string; status: string; summary?: string; usage?: UsageStats }
   ```
   Document the four values `'completed' | 'failed' | 'aborted' | 'stopped'`, what each means, and which adapters produce which (claude-code: all four; gemini: `completed`/`failed`/`aborted`; opencode: `completed`/`failed`/`aborted`; codex: none). **Leave the field typed `string`** — do not narrow it to a union.

2. **`src/adapters/claude-code.ts:1907`** — replace the pass-through in the `subagent_completed` branch:
   ```ts
   status: e.status as string,
   ```
   with a call to a small named map. Recognized: `'completed' → 'completed'`, `'failed' → 'failed'`, `'stopped' → 'stopped'`. Anything else → `'failed'` plus a **one-shot** `warning` event naming the unrecognized string (one per run, not one per notification — a run with three unknown-status subagents must emit one warning, not three).
   Note the sibling `background_task_completed` branch at `:1895` has the same `status: e.status as string` shape; that one belongs to M17 and is **out of scope** here — do not change it as a drive-by.

3. **`src/adapters/claude-code.ts`** — add a shared flush helper (a generator, since it yields) that enumerates the run's task registry:
   - source: `tasks.inFlight` (registry created at `:1241`, implemented in `src/adapters/claude-code.background-hold.ts:177`);
   - filter out ids whose `tasks.kind(id)?.isBackground` is true;
   - for each remaining id, yield `{ type: 'subagent_completed', taskId: id, status: 'aborted' }`.

4. **`src/adapters/claude-code.ts` lines 1564, 1621, 1635, 2071, 2077** — call the helper from step 3 immediately **before** each `yield { type: 'error', error: terminalRuntimeError(), phase: 'runtime' };`. All five. Mirror the shape of `terminalRuntimeError()` (`:1279`) — one definition, five call sites — and consider whether the two can be folded into a single "end this run" helper so a sixth exit path cannot be added with only half the teardown.

5. **`src/adapters/gemini.ts`** — flush `activeSubagents` (declared at `:636`) on the teardown path, before the terminal error yielded near `:812`. For each remaining `threadId`, yield `{ type: 'subagent_completed', taskId: threadId, status: 'aborted' }`, then clear the set. Note the existing `agent_end` handler at `:800` already deletes from the set on the normal path, so a normally-settled thread will not be double-closed — assert it anyway.

6. **`src/adapters/opencode.ts`** — flush `activeSubagentTaskId` (declared at `:546`) on the teardown path: if it is not `undefined`, yield one `{ type: 'subagent_completed', taskId: activeSubagentTaskId, status: 'aborted' }` and clear it. At most one event, by construction — this is the ordering-based single-active model, not an omission.

7. **`src/adapters/codex.ts`** — no code change. `abort()` at `:142` stays as it is. Codex has no subagent concept and must synthesize nothing.

8. **Unit tests — `src/adapters/claude-code.background-tasks.test.ts`**, beside the existing abort cases (`:795`, `:817`, `:839`, `:869`, `:1113`). This tier matters more than usual here: delegation is model-driven and non-deterministic, and the M17 wake-up matrix's own subagents cells skip as `[INCONCLUSIVE]` in practice on sonnet-4.6 (see the matrix commentary at `src/testing/e2e/claude-code.e2e.test.ts:722`). The unit tier is where this contract is actually pinned.
   - **Flush case.** Script an SDK stream that emits `system` / `task_started` for a subagent and never settles it; call `abort()`. Assert: a synthesized `subagent_completed` with `status: 'aborted'` arrives **before** the `AdapterAbortError`; the error is still terminal with **nothing after it**; and no duplicate completion is emitted for a subagent that had already settled (script a second subagent that *does* get its `task_notification`, and assert exactly one completion for it).
   - **Status-map case — recognized.** SDK `task_notification` with `status: 'stopped'` surfaces as `'stopped'` — not `'aborted'`, not dropped, not rewritten to `'completed'`.
   - **Status-map case — unrecognized.** An SDK status outside the union surfaces as `'failed'` with **exactly one** `warning` event.
   - Consider a case asserting the flush skips background-kind tasks: script one `task_started` with a background `task_type` alongside one subagent, abort, assert exactly one `subagent_completed` and no `subagent_*` event for the background id.

9. **E2E — `src/testing/e2e/claude-code.e2e.test.ts`**, one new case. Reuse `SUBAGENTS_THEN_QUESTION_PROMPT` / `SUBAGENTS_THEN_QUESTION_SYSTEM_PROMPT` (`src/testing/e2e/shared.ts:460` and `:469`) — that prompt asks the model to spawn three subagents in parallel and end its turn immediately, which is exactly the "several open pairs at once" shape this needs. Call `adapter.abort()` on the **first** `subagent_started`. Assert:
   - every `subagent_started` has a matching `subagent_completed` (pair by `taskId`);
   - the run ends with `AdapterAbortError` at `phase: 'runtime'`;
   - **no** `subagent_*` event follows the error;
   - the iterator **completes** rather than throwing.

   Use the inconclusive convention already established at `src/testing/e2e/claude-code.e2e.test.ts:424–434` — if the model never delegated, `console.warn` an `[INCONCLUSIVE]` message naming the observed event sequence and call `ctx.skip()`, rather than passing silently on a run that proved nothing:
   ```ts
   const started = events.filter((e) => e.type === 'subagent_started');
   if (started.length === 0) {
     console.warn(
       `[INCONCLUSIVE] ...: the model never delegated. ` +
         `Sequence: ${events.map((e) => e.type).join(' → ')}`,
     );
     ctx.skip();
   }
   ```

10. **E2E — `src/testing/e2e/codex.e2e.test.ts`.** Either extend the existing negative case at `:293` (`it('no subagent events and subagentTaskId is never populated', ...)`) or add a sibling next to it, asserting that codex emits **no** synthesized `subagent_completed` on abort either. The existing case already asserts `expect(events.some((e) => e.type.startsWith('subagent_'))).toBe(false);` on a normal run — the new assertion is the same predicate on an aborted run. State in a comment that the absence is the contract, not an omission, so a later reader does not "fix" it by adding a flush.

11. **`CHANGELOG.md`** — a behavioral note under a **minor** version bump. It must say three things: (a) `subagent_completed.status` now has a declared vocabulary of `'completed' | 'failed' | 'aborted' | 'stopped'`; (b) aborting or timing out a run now emits a synthesized `subagent_completed` with `status: 'aborted'` for every subagent the adapter had open, before the terminal error; (c) on claude-code, an SDK status the adapter does not recognize is now reported as `'failed'` with a warning, where it was previously forwarded verbatim — so consumers branching on a raw forwarded value should re-check that branch. Spell out that the field remains a `string`, so no compiler error will flag this for them.

<!-- anchor: a7checks -->
## Definition of done

- Every `subagent_started` emitted by claude-code, gemini or opencode is followed by a `subagent_completed` with the same `taskId`, on every run-ending path including `abort()` and `timeoutMs`.
- The synthesized completion precedes the terminal `error`, and nothing in the `subagent_*` family follows it.
- `splitBySubagent` (`src/utils.ts:95`) applied to an aborted run with delegation in flight returns a `subagent` bucket with no unclosed pair.
- claude-code never emits a `subagent_completed.status` outside the four declared values, and an unrecognized SDK status produces `'failed'` plus exactly one warning per run.
- codex emits no `subagent_*` event on any path, aborted or not.
- The unit tier proves all of the above deterministically, without depending on the model choosing to delegate.
