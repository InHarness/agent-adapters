---
type: brief
from_release: 0.9.11
to_release: null
generated_at: '2026-09-22T13:24:08.043Z'
implemented: true
---
# Brief: abort vs. a pending `onUserInput` — opencode and gemini do not conform

This is **not a specification change**. The specification is right and has been right since before
0.9.11; the code fails it in two adapters out of four. The work is a code fix in
`src/opencode.ts` and `src/gemini.ts`, plus regression tests, bringing both into conformance with an
obligation that `src/claude-code.ts` already satisfies.

The defect: when `abort()` (or the `timeoutMs` backstop) fires while the adapter is parked on the
consumer's `onUserInput` handler, opencode and gemini do not wake up. Their pump loops have **no
abort branch at all**, so the bare `await` never resolves, the generator is never unparked, and the
`finally` block — which is where `clearTimeout`, server shutdown and cleanup live — never runs. For
opencode the consequence is physical: **the spawned OpenCode server stays up**, because the handle
that closes it is cleared only in that unreachable `finally`.

A consumer's `onUserInput` typically resolves only when a human answers — an HTTP round-trip, a UI
dialog — which may be never. So this is not a rare race; it is the ordinary shape of a UI-backed
consumer aborting a run.

---

## 1. The obligation, quoted from the specification

### `modules/M13-errors-resilience.md` § `## Edge cases` (anchor `1vd9sye5`)

Two bullets, verbatim. The first is the rule the second protects:

> - `abort()` mid-run → `AdapterAbortError` or natural iterator completion; no dangling SDK process.

> - **`abort()` / `timeoutMs` while a `user_input_request` is unanswered** → still terminates.
>   […] A consumer's `onUserInput` handler routinely resolves only when a human answers (an HTTP
>   round-trip, a UI dialog), which may be never; an adapter that simply awaits it parks the run
>   forever, holding its session *and* its SDK subprocess — the "no dangling SDK process" rule above,
>   violated in the one case where the consumer cannot recover by itself. Adapters MUST race the
>   abort signal against every consumer handler they await: on abort the outstanding request is
>   answered `cancel` (so the SDK-side promise settles instead of leaking), the stream yields
>   `AdapterAbortError` / `AdapterTimeoutError`, and teardown runs. A wedged session of this kind is
>   invisible in logs and appears to "heal on restart", which is why it is specified rather than left
>   to implementation care.

The `[…]` elides a clause about `idleTimeoutMs` not advancing while a request is open. That clause is
part of a **separate, parallel, still-unreleased specification effort** (`timeoutMs` / `idleTimeoutMs`)
and is **out of scope here** — see §6. The obligation quoted above is older than it and independent
of it: it binds `abort()` and the existing `timeoutMs` backstop, today.

The obligation is written on **every** adapter ("Adapters MUST race…"), not on claude-code.

### `modules/M01-unified-core.md` § `## Unified Contract (L1) — implementor` (anchor `8do90d06`)

The `abort()` contract consumers rely on, verbatim:

> - **`RuntimeAdapter`** — three obligations + one optional: identify via `architecture`;
>   `execute(params): AsyncIterable<UnifiedEvent>` yielding a terminating stream (a `result` then
>   return, or an `error`); `abort()` stops promptly; optional `pushMessage(text): boolean` for
>   mid-turn injection (M11).

and, from the same section:

> `abort()` is not a fifth clock — it is the consumer's hand on the same switch.

"Stops promptly" is the whole of it. A run parked on a promise that only a human can resolve does not
stop promptly; it does not stop at all.

### `adapters/A01-claude-code.md` § `## Edge cases` (anchor `677rc2wh`)

> - `abort()` while a `user_input_request` is outstanding and the consumer's handler is still pending
>   → the run terminates with `AdapterAbortError` and the SDK subprocess is torn down; it does
>   **not** wait for an answer that may never come.

### `adapters/A01-claude-code.md` § `## Per-capability consumption` (anchor `sw3cwrsm`)

This is the section that spells out the **mechanism**, and it is the recipe to copy. Verbatim:

> - **Abort / timeout (M13)** — `abort()` must break the loop wherever it can park, including an
>   `await` on the consumer's `onUserInput` handler, which a UI-backed consumer may never resolve.
>   Teardown is: fire the abort signal (breaks every awaited point, including the raced
>   `onUserInput`), answer the outstanding request `cancel` (so the SDK-side promise settles instead
>   of leaking), and close the input channel — after which the run yields `AdapterAbortError` /
>   `AdapterTimeoutError` and no SDK subprocess is left dangling. This M13 guarantee is
>   **behavioural**: it does **not** depend on cooperatively interrupting the engine.
>   `Query.interrupt()` is available on every run now that the channel path is universal, but it is a
>   control-protocol round-trip over the *same* stdin that teardown then closes, so **it must never
>   be awaited on the teardown path** — awaiting it can outlive its transport and never settle,
>   reintroducing exactly the parked-run failure M13 exists to prevent. If the adapter calls it at all
>   it is strictly **fire-and-forget**; a rejecting, synchronously-throwing, or entirely absent
>   `interrupt()` still terminates the run.

That last rule generalises: **never `await` an engine-side control round-trip on the teardown path.**
It applies verbatim to OpenCode's server shutdown and to any gemini-side cancellation call.

*(The specification pages use an XML cross-reference tag for links between sections; those tags have
been rendered as plain section names in the quotes above. Nothing else was altered.)*

---

## 2. What the code does today

Reported as verified in `src/` at HEAD `9a7e0f5`, `package.json` version `0.9.10`. **Treat the line
numbers as a starting point, not as gospel** — they drift with every commit, and they could not be
re-checked while writing this brief. Re-derive them with `git rev-parse --short HEAD` and a grep for
the quoted fragment before editing.

| Adapter | Status | Address at `9a7e0f5` |
| --- | --- | --- |
| **claude-code** | **Conforms.** `abortPromise` (resolved by the run's abort signal, never rejected) is raced against `effectiveUserInputHandler(pending.req)`; on abort it calls `settleUnanswered(pending, 'cancel')`, cancels the queue, and finishes through `endRunTerminally()`. The main pump `Promise.race` also carries an `abort` branch. | `src/claude-code.ts:1441-1449`, `1969-1987`, `2018-2028` |
| **opencode** | **Violates.** Bare `const res = await params.onUserInput(req)`. | `src/opencode.ts:582-584` |
| **gemini** | **Violates.** Bare `res = params.onUserInput ? await params.onUserInput(req) : …` | `src/gemini.ts:714-720` |
| **codex** | Not applicable — `onUserInput` is rejected with a warning and the handler is never invoked. | `src/codex.ts:185-190` |

### Why it is a hang, not just a contract deviation

The opencode and gemini pump loops race only `{ sdk.next(), wake }` — **there is no abort branch**:

- `src/opencode.ts:596-599`
- `src/gemini.ts:746-751`

So a timeout or an `abort()` arriving while the bare `await` is parked cannot unpark the generator.
The `finally` block therefore never executes — and the `finally` is where the cleanup lives:

- `src/opencode.ts:890-895` — `clearTimeout`, `serverClose()`, cleanup
- `src/gemini.ts:971-974` — `clearTimeout` and cleanup

For opencode the leak is concrete: `this.serverClose` is assigned at `src/opencode.ts:349-355` and
cleared **only** in that `finally`, while `abort()` itself does nothing but call
`abortController.abort()`. Net effect: **the spawned OpenCode server is left running**, one per
aborted run, invisible in logs, apparently "healed" by a restart — exactly the failure mode M13
describes.

---

## 3. Correction to the record: there is no 0.10.0 in this tree

`package.json` reads `0.9.10` and the newest tag is `v0.9.9`. If a note, memory or changelog anywhere
claims *"`abort()` cannot break a pending `onUserInput` — fixed in 0.10.0"*, that claim is true
**only for claude-code**. It was never true for opencode or gemini, and no released version contains
the fix for them. Anyone carrying that belief should correct it: the class of bug is open in two
adapters as of `9a7e0f5`.

---

## 4. The fix: copy the claude-code shape, do not invent one

This exact bug was already diagnosed and fixed once — in claude-code — and pinned with a regression
test. Do not design a new solution. Port the existing one.

The shape, per adapter (`opencode.ts`, then `gemini.ts`):

1. **An abort promise that resolves, never rejects.** Derive it from the run's existing
   `abortController.signal` — one promise per run, resolved on `'abort'`, with the listener removed
   on settle so a long-lived signal does not accumulate listeners. Mirror how `src/claude-code.ts`
   builds `abortPromise` (~`1441-1449`).

2. **Race it against the handler.** Replace the bare await. Sketch — adapt the identifiers to each
   file, the structure is what carries over:

   ```ts
   // was:  const res = await params.onUserInput(req);
   const outcome = await Promise.race([
     params.onUserInput(req).then((value) => ({ kind: 'answered' as const, value })),
     abortPromise.then(() => ({ kind: 'aborted' as const })),
   ]);

   if (outcome.kind === 'aborted') {
     settleUnanswered(req, 'cancel'); // answer the SDK-side promise so it does not leak
     break;                            // fall out of the loop → finally runs → teardown
   }
   const res = outcome.value;
   ```

   In gemini the call is conditional (`params.onUserInput ? … : …`) — keep the fallback path for an
   absent handler; only the awaited branch changes.

3. **Answer the outstanding request `cancel`.** The SDK-side promise created for the
   `user_input_request` must settle, or the engine leaks its own pending await. claude-code does this
   through `settleUnanswered(pending, 'cancel')`; each adapter needs its equivalent against whatever
   object holds the pending request.

4. **Add an abort branch to the pump loop.** The `Promise.race([sdk.next(), wake])` at
   `opencode.ts:596-599` / `gemini.ts:746-751` gains a third arm resolving on the abort signal, so a
   run parked anywhere in the loop — not only on `onUserInput` — terminates. This mirrors the `abort`
   branch in claude-code's main race.

5. **Guarantee teardown.** Leaving via `break`/`throw` is what makes the existing `finally` run
   (`opencode.ts:890-895`, `gemini.ts:971-974`). For opencode additionally make `serverClose()`
   **idempotent and reachable from `abort()` itself**, so the server dies even if the generator is
   never resumed by its consumer: null out `this.serverClose` before invoking it, and do **not**
   `await` a server-side control round-trip on the teardown path (see `sw3cwrsm` above — fire and
   forget; a rejecting or absent close must still terminate the run).

6. **Emit the right terminal error.** `AdapterAbortError` for `abort()`, `AdapterTimeoutError` for the
   `timeoutMs` backstop — runtime phase, as an `error` event on the stream, never thrown out of the
   iterator.

---

## 5. Regression tests, in the shape that already exists

The claude-code fix is pinned by tests in `claude-code.background-tasks.test.ts` (reported at HEAD
`9a7e0f5`):

- the test itself: lines `1104-1150`
- its helper: lines `1075-1102`
- further abort tests: lines `1151-1196`

Its explanatory comment names the symptom in these terms: the handler is **awaited bare, with nothing
watching the abort signal**, so the run stays **parked forever, holding its adapter and its SDK
subprocess**. Read that test before writing the new ones — it is the template.

The mechanics to reproduce:

```ts
onUserInput: () => new Promise<never>(() => {})   // never resolves, like a human who never answers
```

driven by `pumpUntilDone` with its hang detector `PULL_TIMEOUT_MS` — if the stream does not produce a
terminal event within the budget, the test fails as a hang rather than sitting there.

New tests to add, one pair per adapter (opencode, gemini):

1. **`abort()` while `onUserInput` is pending** → the stream terminates with `AdapterAbortError`
   within `PULL_TIMEOUT_MS`; the pending request is answered `cancel`.
2. **`timeoutMs` expiring while `onUserInput` is pending** → terminates with `AdapterTimeoutError`,
   same bound.
3. **opencode only — no leaked server.** Assert that the spawned OpenCode server is shut down on the
   abort path: assert `serverClose` was invoked (and that the handle was cleared), and, if the test
   harness allows, that the port is no longer accepting connections. This is the fact that makes the
   bug expensive and it deserves its own assertion, not a side-effect check.

**Do not gate any e2e test on `ANTHROPIC_API_KEY`** — claude-code authenticates through local OAuth
(subscription), and gating on that variable silently skips the tests that matter.

---

## 6. Out of scope

- **codex** — `onUserInput` is rejected with a warning at `src/codex.ts:185-190` and the handler is
  never invoked, so there is nothing to race. Leave it alone.
- **Any specification change.** The specification is correct. If the implementation turns out to be
  impossible as specified, stop and raise it — do not edit the spec from the implementation side.
- **`idleTimeoutMs` and the `timeoutMs` field work.** A separate, unreleased specification effort is
  in flight touching `M01`, `M06`, `M11`, `M13` and `M17` (new idle-clock primitive, new acceptance
  criteria). This brief does not implement, anticipate or depend on it. Do not pull it in; do not
  implement an idle clock. The only clocks this brief touches are `abort()` and the existing
  `timeoutMs` backstop.

---

## 7. For implementers

Edit targets, in dependency order. All paths are relative to the repository root.

1. **Read first — the reference implementation and its test.**
   - `src/claude-code.ts` around `1441-1449` (`abortPromise` construction), `1969-1987` (the race
     against `effectiveUserInputHandler(pending.req)` and `settleUnanswered(pending, 'cancel')`),
     `2018-2028` (`endRunTerminally()` / abort branch of the main race).
   - `claude-code.background-tasks.test.ts` `1075-1102` (helper), `1104-1150` (the test),
     `1151-1196` (further abort tests).
   - Re-derive every line number: `git rev-parse --short HEAD`, then grep for the quoted fragments.

2. **`src/opencode.ts`**
   - `582-584` — replace `const res = await params.onUserInput(req)` with the abort race; on abort,
     answer the pending request `cancel` and break out.
   - `596-599` — add an abort arm to the `Promise.race([sdk.next(), wake])` pump.
   - `349-355` / `890-895` — make server shutdown idempotent and reachable from `abort()`; keep
     `clearTimeout` + `serverClose()` in `finally` and ensure every exit path reaches it. Do not
     `await` the server's close round-trip on the teardown path.
   - the `abort()` method — today it only calls `abortController.abort()`; it must also guarantee the
     spawned server dies.

3. **`src/gemini.ts`**
   - `714-720` — same race, preserving the "no handler configured" fallback branch.
   - `746-751` — abort arm in the pump race.
   - `971-974` — verify `clearTimeout` + cleanup in `finally` is now reachable on the abort path.

4. **Tests** — new files or new blocks alongside the existing adapter test files, mirroring
   `claude-code.background-tasks.test.ts`: never-resolving `onUserInput`, `pumpUntilDone` +
   `PULL_TIMEOUT_MS` hang detection, assertions on `AdapterAbortError` / `AdapterTimeoutError`, on the
   `cancel` answer, and (opencode) on server shutdown. No `ANTHROPIC_API_KEY` gating.

---

## 8. Working convention for this repository

- Implement in a **separate git worktree**, not on a shared branch in the main checkout.
- Finish with a **draft pull request**: `gh pr create --draft`. **Never merge.**

---

## 9. Definition of done

- [ ] `src/opencode.ts` and `src/gemini.ts` race the run's abort signal against `onUserInput`.
- [ ] On abort/timeout the outstanding `user_input_request` is answered `cancel`.
- [ ] Both pump loops carry an abort branch, so a run parked anywhere in the loop terminates.
- [ ] Both `finally` blocks are reachable on the abort path; `clearTimeout` and cleanup run.
- [ ] opencode: the spawned OpenCode server is shut down on abort — asserted by a test, not by
      inspection. `abort()` alone is sufficient to kill it.
- [ ] Terminal events are `AdapterAbortError` / `AdapterTimeoutError`, runtime phase, on the stream.
- [ ] Regression tests per adapter in the claude-code shape, failing fast on a hang via
      `PULL_TIMEOUT_MS`, green without `ANTHROPIC_API_KEY`.
- [ ] No specification file was edited; no `idleTimeoutMs` work crept in; `src/codex.ts` untouched.
- [ ] Delivered from a dedicated worktree as a **draft** PR.
