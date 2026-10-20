---
type: patch
brief: 0-9-8-to-0-9-9.md
patch_kind: missing
created_at: '2026-09-07T10:58:44.592Z'
created_by: unknown
applied: false
---
# Patch — subagent pairing on termination is an unclosed gap, not a decision

## What I found

The brief's "run-level-termination subagent guarantee was withdrawn" section, plus the tension
it flags around A01's `abort` row flipping to `✅ covered`, is genuinely unresolvable from the
pages. I consulted the spec author (`c4s ask`, thread `5xFcyrLCoNJc`) and the answer was that
this is a **gap, not a decision**: "wycofane jako kontrakt — ale nie zastąpione kontraktem
przeciwnym". Nothing in the spec now requires closing an open subagent pair on termination, and
nothing forbids it. The instruction was to leave the code and its assertions in place and treat
them as state to be written *into* the spec.

Two corrections to the brief's own framing, worth folding into the next one:

- The brief says the **M06 L5 section** was deleted, taking the *Lifecycle pairing* and *At most
  once* invariants with it. M06 as it stands has Purpose, Dependencies, L1, L2, L4, Edge cases
  and Acceptance criteria — there is no L5, L3, L6 or L7. The premise has no referent in the
  current page.
- The brief treats A01's `abort` row moving to `✅ covered` as evidence pointing the other way.
  It is actually consistent with the removal: M12 now defines the `abort` scenario as
  "`abort()` mid-stream ends the run cleanly (`AdapterAbortError`, channel closed)" with no
  subagent leg, so the qualifier "⚠️ partial — subagent leg not implemented" simply lost its
  referent. `✅ covered` means "covered against M12's definition", not "the pairing shipped".

What the code actually does today, unchanged by this brief:

- `src/adapters/claude-code.ts:1697` — the termination flush emits
  `subagent_completed { status: 'aborted' }` for each in-flight task id.
- `src/adapters/opencode.ts:498-502` — the tracked `activeSubagentTaskId` is closed as `aborted`.
- `src/adapters/gemini.ts:637-653` — the backstop closes every still-open thread, without
  double-closing one that already got its own `agent_end`.
- `src/testing/e2e/claude-code.e2e.test.ts:473` — the live acceptance case
  ("abort mid-stream with subagents in flight closes the lifecycle pair, exactly once").
- `assertSubagentLifecycle` in the exported testing toolkit asserts both invariants together.

So the implementation and its e2e coverage today assert **more than the spec requires**. They
are not wrong, but they are unmoored: a passing test with no acceptance criterion behind it.

## Suggestion

Close the gap in M06 rather than leaving it to be re-derived from code each release. The spec
author sketched the shape:

1. **M06, Edge cases** — one sentence on the fate of an open `subagent_started` at
   `abort()` / `timeoutMs` / hold-cap expiry, structurally parallel to M17's existing
   `background_task_*` rule ("no `background_task_completed` is owed after termination"). The
   choice is binary: "no `subagent_completed` is owed" **or** "a closing
   `subagent_completed { status: 'aborted' }` is synthesized". Three adapters plus a shipped
   0.9.8 behavioral-change note already implement the second variant — that is evidence for it,
   but the call is the spec owner's.
2. **One `ac` entity tagged `m06-edge`** reflecting that choice. Only that gives the existing
   e2e assertions a criterion to hang on.
3. **M12's `abort` scenario** — if the choice is synthesis, the subagent leg has to come back
   into the scenario definition and A01's row returns to `⚠️ partial`. If it is "nothing owed",
   the current `✅ covered` is right and nothing moves.
4. Separately, the `subagent_completed.status` vocabulary (`'completed' | 'failed' | 'aborted' |
   'stopped'`) and the "never map an unknown value to `'completed'`" rule are also gone from
   every page, yet the library still **exports** them as the `SubagentStatus` type and the
   `mapSubagentStatus(raw, declared)` helper, both added in 0.9.8 and both still public API.
   Exported surface with no specification behind it is the same gap in a more visible place.

