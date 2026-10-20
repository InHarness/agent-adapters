---
type: patch
brief: 0-9-9-to-0-9-10.md
patch_kind: incorrect
created_at: '2026-09-07T16:41:19.185Z'
created_by: unknown
applied: false
---
# Patch — M06 L1 and the AC entity encode the wrong mapSubagentStatus mechanism

## What I found

A code review of the 0.9.10 spec diff surfaced the same mechanism error I reported for the brief, but present in TWO further places that are canon rather than narrative. Recording them separately because an implementer or a conformance run would act on these, not on the brief.

**1. `spec/modules/M06-subagents.md`, L1 bullet (line 32).** It says `mapSubagentStatus` "falls back to the caller's \`declared\` value when \`raw\` is not in the vocabulary". The shipped function (`src/subagents.ts:64-76`) takes `declared` as a per-adapter LOOKUP TABLE (`Record<string, SubagentStatus>`), not a fallback value, and its fallback is `'aborted'` for cancellation-shaped strings, else `'failed'` with `warn: true`.

The sentence is also self-defeating on its own terms: if `declared` were a single fallback value, a caller passing `'completed'` would make an unrecognized reason resolve to `'completed'` — which the same sentence declares must never happen. The stated rule and the stated mechanism contradict each other.

**2. `.claude4spec/entities/ac/ac-an-sdk-terminal-reason-outside-the-kn.json`.** The AC title bakes in the same wrong mechanism ("mapSubagentStatus falls back to the declared value instead"). This is the more serious of the two: conformance work driven off this AC either fails against the real function, or 'fixes' the function into the weaker contract and reintroduces exactly the silent-success path the AC exists to prevent.

**3. `spec/modules/M06-subagents.md` L4 (line 91).** Describes the export but omits that it returns `{ status, warn }` rather than a bare status, and omits the once-per-run drift-warning dedup the callers depend on (`claude-code.ts:2413`, and now `gemini.ts`). Since the same sentence places the function under the semver promise, the return shape belongs in it.

I did not edit any of these — the L1 rule and an AC title are canon, not implementer territory. I did fix the one purely mechanical staleness the same diff introduced: the M06 layer-summary table (line 20) still read "Exports \`SubagentDefinition\`, \`validateSubagents\`" while line 91 in the same file had already gained `SubagentStatus` and `mapSubagentStatus`.

## Suggestion

Restate the mechanism once, correctly, and let both other places reference it. Suggested wording for the L1 rule:

> `mapSubagentStatus(raw, declared)` is where that rule lives: `declared` is the adapter's own table from its SDK's spellings onto the vocabulary, and anything outside it resolves to `'aborted'` when cancellation-shaped and otherwise to `'failed'` with a drift warning — never to `'completed'`, because a subagent silently reported as successful is the one mapping error a consumer cannot detect downstream.

Then retitle `ac-an-sdk-terminal-reason-outside-the-kn` to assert the OUTCOME rather than the mechanism — e.g. "...never resolves to \`'completed'\`; it resolves to \`'aborted'\` when cancellation-shaped and otherwise to \`'failed'\` with a drift warning." An AC that names an outcome survives a refactor of the mapper; one that names the mechanism does not.

