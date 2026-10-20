---
type: brief
source: analysis
from_release: 0.9.4
to_release: null
generated_at: '2026-08-24T21:38:46.965Z'
generator_version: brief-author@0.1
implemented: true
---
# Analysis brief: 0.9.4 → (next)

Two acceptance criteria of the background-tasks capability (M17) are, as of today, verified only by mocked unit tests. The contract-extension checklist in M12 requires that every capability contract be backed by a **live** per-adapter end-to-end case, so for the `claude-code` adapter these two criteria are formally uncovered. This brief closes that gap: it adds two live e2e cases to the existing `claude-code` suite. It is **test coverage only** — no adapter behaviour changes, no change to `src/adapters/claude-code.ts`, no change to types or config handling.

## Where background-task coverage stands today

Live e2e coverage of background work in `src/testing/e2e/claude-code.e2e.test.ts` exists in exactly one place: the `WAKE_UP_CONFIGS` matrix inside the `describe('onUserInput — AskUserQuestion tool bridge')` block. That matrix exercises a single shape — a backgrounded command that later *wakes up* the run, with the control channel held open while it settles. It says nothing about the two behaviours below.

Those two behaviours are currently asserted only against mocks, in:

- `src/adapters/claude-code.background-routing.test.ts`
- `src/adapters/claude-code.background-tasks.test.ts`

Mocked tests pin the adapter's own branching, but they cannot show that the real Claude Agent SDK honours the synthesized hook or that the hold cap actually fires against a live, genuinely unsettling task. That is what the live cases add.

## Coverage 1 — `claude_disallowBackgroundBash: true` forces synchronous execution

Acceptance criterion: `ac-with-claude-disallowbackgroundbash-true`.

Behaviour under test: when a run is started with `architectureConfig.claude_disallowBackgroundBash: true`, the adapter synthesizes a `PreToolUse` deny-hook for `Bash`. Any `Bash` invocation carrying `run_in_background: true` is rejected by that hook, so the model is forced to run the command synchronously instead. Observable consequences of a run where the prompt explicitly asks for a backgrounded shell command:

- the deny-hook rejects the backgrounded `Bash` call (the command still ends up executed, but synchronously);
- **no** `background_task_*` event is emitted anywhere in the stream;
- **no** result in the run carries a `backgroundTasks` payload.

The case is a cheap live run — a trivial command (e.g. printing a marker string) is enough; the point is the routing, not the work.

## Coverage 2 — the control-channel hold is bounded

Acceptance criterion: `ac-the-control-channel-hold-is-bounded-a-ta`.

Behaviour under test: work that never settles must not hold the run open forever. With a **small** `architectureConfig.claude_backgroundHoldCapMs` and a task that genuinely never finishes — a backgrounded `sleep 3600` — the run must terminate at the cap and emit a warning that names the bound it hit. Two properties matter and both must be asserted:

- the run *ends* (it does not hang and does not leave the stream open); and
- it ends with a warning that references the configured cap, rather than ending silently as if the task had completed.

The cap must be chosen small enough that the whole case finishes comfortably inside `collectEvents()`'s default 120s timeout — the test must fail on a real regression, not on the harness timing out. A cap in the low seconds is the right order of magnitude.

## Conventions this suite already follows

Both new cases live in `src/testing/e2e/claude-code.e2e.test.ts` and must match the surrounding suite exactly:

- **Gating:** gate on `SKIP_CLAUDE_E2E` only. Do **not** gate on `ANTHROPIC_API_KEY` — the `claude-code` adapter authenticates through local OAuth (subscription), so keying the skip on an API key would silently disable the case on developer machines where it can and should run.
- **Model:** read the model from `E2E_CLAUDE_MODEL`, as every other case in the file does.
- **Non-determinism:** these cases depend on the model actually *dispatching* the required work shape (a backgrounded `Bash` call). When it does not, call `ctx.skip()` and emit a `console.warn` prefixed `[INCONCLUSIVE]` explaining which shape was missing — do not fail the run. A model that chose a different tool is not a regression in the adapter.
- **Shared fixtures:** the new prompts and any assertion helpers go into `src/testing/e2e/shared.ts`, alongside the existing `BACKGROUND_THEN_QUESTION_PROMPT` and `assertNoStreamClosed`, and follow their naming and export style.

## Out of scope

- No change to adapter behaviour. `src/adapters/claude-code.ts` is not touched. If a case fails, the finding is reported — it is not fixed by relaxing the assertion.
- The existing mocked tests stay. The live cases are additive coverage, not a replacement: the mocks pin branching cheaply on every CI run, the e2e cases pin the real SDK contract.
- No new `architectureConfig` keys. `claude_disallowBackgroundBash` and `claude_backgroundHoldCapMs` already exist and are already honoured by the adapter.

## For implementers

1. In `src/testing/e2e/shared.ts`, next to `BACKGROUND_THEN_QUESTION_PROMPT`: add a prompt constant that asks the model to run a trivial shell command **in the background** (this is the prompt reused by both cases), and a second prompt that asks for a backgrounded `sleep 3600`. Keep them explicit about backgrounding — the whole case hinges on the model attempting `run_in_background: true`.
2. In the same file, next to `assertNoStreamClosed`: add the assertion helpers the two cases need — one asserting that a collected event list contains **no** `background_task_*` event and that no result carries `backgroundTasks`; one asserting that the run terminated with a warning whose text names the configured hold cap. Export them in the style of the existing helpers.
3. In `src/testing/e2e/claude-code.e2e.test.ts`, add a case for `ac-with-claude-disallowbackgroundbash-true`: execute with `architectureConfig: { claude_disallowBackgroundBash: true }` and the model from `E2E_CLAUDE_MODEL`, collect events, then assert the no-`background_task_*` / no-`backgroundTasks` helper from step 2. If the transcript shows the model never attempted a `Bash` call at all, `ctx.skip()` with an `[INCONCLUSIVE]` warn.
4. In the same file, add a case for `ac-the-control-channel-hold-is-bounded-a-ta`: execute the `sleep 3600` prompt with `architectureConfig: { claude_backgroundHoldCapMs: <low-seconds value> }`, collect events, and assert (a) the run terminated, and (b) the warning naming the bound was emitted. Keep total wall time well under the 120s `collectEvents()` default. If the model never backgrounded anything, `ctx.skip()` with `[INCONCLUSIVE]`.
5. Place both cases as their own `describe` block (background-task routing / hold bounding), **not** inside `describe('onUserInput — AskUserQuestion tool bridge')` — neither case goes through the AskUserQuestion bridge, and nesting them there would muddy what the `WAKE_UP_CONFIGS` matrix is documenting.
6. Verify by running the suite live with `SKIP_CLAUDE_E2E` unset and `E2E_CLAUDE_MODEL` set. Both cases must pass (or skip as `[INCONCLUSIVE]`) without any edit under `src/adapters/`.
