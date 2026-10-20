---
type: patch
brief: 0-9-9-to-0-9-10.md
patch_kind: missing
created_at: '2026-09-07T16:27:21.711Z'
created_by: unknown
applied: false
---
# Patch — item 3 underspecified for a wide SDK vocabulary; failed-vs-stopped axis undefined; suspension reasons unanticipated

## What I found

Item 3 says "Route every adapter's subagent terminal event through \`mapSubagentStatus\` instead of assigning \`status\` directly from the SDK payload." Doing exactly that on gemini would have been a regression, and the brief gives no guidance on the two decisions it forces.

**(a) Routing alone is not sufficient when the SDK vocabulary is wider than four literals.** `mapSubagentStatus` only recognises what the caller declares; everything else falls to the `'failed'` + drift-warning backstop. gemini's `StreamEndReason` is `'completed' | 'failed' | 'aborted' | 'max_turns' | 'max_budget' | 'max_time' | 'refusal' | 'elicitation' | (string & {})`. Route it through the mapper with a naive declared table and `max_turns` etc. all become `'failed'` with a spurious drift warning — technically satisfying the binding rule, but wrong. The adapter needs its own declared table covering the wider vocabulary.

**(b) M06 does not define the `'failed'` vs `'stopped'` axis**, which is precisely what `max_turns` / `max_budget` / `max_time` / `refusal` turn on. `src/types.ts` gives `'stopped'` a mechanism ("ended INDIVIDUALLY while the run kept producing events") but not a semantic. The c4s agent thread on this brief (`PxZ0l9UgUnz8`) confirmed the spec is silent and that this is a design decision, not a conformance question.

I implemented, with the user's explicit decision: `'failed'` = the error path (exception, tool crash); `'stopped'` = ended by a boundary or a decision, without an error and without a result. So the three resource caps AND a refusal map to `'stopped'`.

**(c) A suspension reason must not be closed at all.** gemini's `'elicitation'` is not terminal: `AgentEnd` carries `elicitationIds` and the SDK has an `elicitation_response` event to resume the same thread. Emitting `subagent_completed` there would risk a SECOND close for one `taskId` when the resumed stream really ends — violating `ac-no-subagent-started-is-ever-closed-by`. So the adapter emits nothing and leaves the taskId open; the resumed terminal event closes it, or the run-end flush closes it as `'aborted'`. Both paths are unit-tested.

Nothing in the brief or M06 anticipates a non-terminal member of an SDK's stream-end union.

## Suggestion

1. Define the `'failed'` / `'stopped'` axis in M06 L1, in one sentence. Without it, every adapter with a wide SDK vocabulary re-decides it, and they will not agree.
2. Extend the item-3 rule: routing through `mapSubagentStatus` is the floor, not the whole obligation. An adapter whose SDK vocabulary exceeds the four literals must ALSO declare an adapter-local table for the surplus members, or the backstop mislabels them.
3. Add the suspension case to M06's edge list: a stream-end reason that the SDK can resume from is NOT a lifecycle close, and mapping it to any status breaks the at-most-once rule. The correct handling is to emit nothing and leave the bracket open.
4. Consider a per-adapter status table in the gemini adapter section, the way A01 carries claude-code's three-value map.

