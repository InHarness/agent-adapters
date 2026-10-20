---
type: patch
brief: 0-9-4-to-next-2.md
patch_kind: incorrect
created_at: '2026-08-25T08:51:16.798Z'
created_by: unknown
applied: true
---
# Patch — cap expiry is a terminal error, not a warning

## What I found

**1. The hold cap ends the run with a terminal ERROR, not a warning.**

The brief's Coverage 2 says the run "must terminate at the cap and emit a **warning** that names the bound it hit", and step 4 asks the implementer to "assert (a) the run terminated, and (b) the warning naming the bound was emitted".

That is stale. As of the M17 fix in commit `614b0e4` ("a cap expiry must never leave a half-dead session"), a cap expiry:

- sets `backgroundHoldExpiredAfterMs = capMs`, interrupts the run and aborts it (`src/adapters/claude-code.ts`, the `onExpire` handler);
- surfaces as a **terminal `error` event** carrying `AdapterBackgroundHoldExpiredError`, whose message names the cap (`... background work made no progress for ${capMs}ms ...`) and points at `claude_backgroundHoldCapMs`;
- is followed by `return` — the error is the last event of the run.

There is **no warning event about the hold anywhere in the adapter**. `src/types.ts` documents this deliberately, under a heading that reads "WHY THIS IS AN ERROR AND NOT A WARNING": the earlier warning-and-carry-on shape is exactly the defect that release fixed, because a warning among dozens of successful-looking empty tool results was not something a consumer could branch on.

A test written literally to the brief would have failed against correct code. I asserted the real contract instead (typed error, message contains the cap, error is terminal) and did not touch `src/adapters/`.

Related, in the same area: the existing `WAKE_UP_CONFIGS` matrix still carries a comment saying "Only the hard cap warns". Its assertion (no `warning` matching `/background work/i` on a healthy run) is harmless, but the comment describes the pre-`614b0e4` world too.

**2. The helper the brief asks for already exists.**

Step 2 asks for a new helper "asserting that a collected event list contains no `background_task_*` event and that no result carries `backgroundTasks`". `assertNoBackgroundTasksStream` in `src/testing/e2e/shared.ts` (wrapping `assertNoBackgroundTasks` in `src/testing/contract.ts`) already asserts precisely that, plus a third assertion — that the gap is silent, i.e. no `warning` mentioning background/task. I reused it rather than adding a near-duplicate.

**3. Precondition sharpening on Coverage 1 (not a defect in the brief, a gap).**

Step 3 says to skip as `[INCONCLUSIVE]` "if the transcript shows the model never attempted a `Bash` call at all". That precondition is too weak: a run where the model chose to run the command synchronously *on its own* satisfies every absence assertion vacuously — the absence would then be the model's doing, not the lever's. I gated on the model actually attempting `run_in_background: true` instead. Both live runs on `sonnet-4.6` do attempt it, so the case is conclusive in practice.

## Suggestion

- Update the M17 entity/AC text and any brief-generation source that still describes the cap expiry as a warning: the observable contract is a terminal `error` event carrying `AdapterBackgroundHoldExpiredError` (`name` survives serialization; `capMs` is on the error and in the message; `toJSON` carries it). This distinction is load-bearing — it is the whole point of the `614b0e4` fix — so it is worth being explicit in the AC rather than leaving "warning" to be reinterpreted.
- Consider having briefs name existing helpers when one already covers the requested assertion; `spec` already knows the e2e helper surface via `src/testing/e2e/shared.ts`.
- Consider tightening `ac-with-claude-disallowbackgroundbash-true`'s conclusiveness condition to "the model attempted `run_in_background: true`", since an absence-shaped criterion is only evidence when the thing being suppressed was actually requested.

Implemented in draft PR https://github.com/InHarness/agent-adapters/pull/25 — both cases green live on `sonnet-4.6`, three runs each.

