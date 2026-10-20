---
type: patch
brief: 0-9-4-to-0-9-5.md
patch_kind: clarification
created_at: '2026-08-25T10:07:04.614Z'
created_by: unknown
applied: false
---
# Patch — other adapters assert absence, not skip

## What I found

Implementer note 3 asks for a skip guard: "Codex, Gemini and OpenCode suites must skip it
(their SDKs never background work) rather than fail; wire the skip through the same
mechanism used for other unsupported-capability scenarios in `src/testing/e2e/`."

Those suites already answer for `background-tasks`, but through the opposite mechanism.
Each asserts the family is ABSENT, inside its "simple text response" case:

    // The codex SDK never backgrounds work (M17) — the family must be absent, and
    // absence is not something to warn about on every turn.
    assertNoBackgroundTasksStream(events);

`codex.e2e.test.ts:79-81`, `gemini.e2e.test.ts:83-85`, `opencode.e2e.test.ts:76-78`. And
that IS "the same mechanism used for other unsupported-capability scenarios" in those
files — cf. `describe('onUserInput — not supported by SDK')` → `it('emits warning and
never invokes the handler')` (`codex.e2e.test.ts:242`), and `it('no subagent events and
subagentTaskId is never populated')` (`:219`). None of the three uses `ctx.skip()`
anywhere; their only skips are suite-level credential gates.

Asserted-absence is the stronger posture: a skip proves nothing, while the absence check
would fail if an adapter ever started emitting the family. I left them as they are and
am filing this rather than changing them.

## Suggestion

Reword the note to match: the adapters whose SDK never backgrounds work do not skip the
scenario, they assert its family absent. The canonical scenario definition's "Absent on
adapters whose SDK never backgrounds work" already reads that way — it is only the
implementer note that says "skip".

