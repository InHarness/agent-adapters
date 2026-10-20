---
type: patch
brief: 0-9-9-to-0-9-10.md
patch_kind: incorrect
created_at: '2026-09-07T16:27:00.490Z'
created_by: unknown
applied: false
---
# Patch — mapSubagentStatus signature in the brief does not match the shipped one

## What I found

The brief specifies the mapper as:

```ts
export function mapSubagentStatus(raw: string, declared: SubagentStatus): SubagentStatus;
```

with the rule "the fallback branch must return \`declared\` for any \`raw\` outside the four literals".

The shipped function (`src/subagents.ts:64`) is different in both parameters and return type:

```ts
export function mapSubagentStatus(
  raw: unknown,
  declared: Record<string, SubagentStatus>,
): { status: SubagentStatus; warn: boolean }
```

`declared` is a TABLE (the adapter's own SDK spelling -> unified name), not a single fallback value, and the return carries a `warn` flag for one-per-run drift reporting. The ordered rules are: declared hit -> its counterpart; else cancellation-shaped (`/cancel|abort|interrupt|terminat/i`) -> `'aborted'`; else `'failed'` + `warn: true`.

The binding rule the brief states is satisfied — nothing outside the vocabulary reaches `'completed'` — but via `'failed'` + a drift warning rather than via a caller-supplied fallback value.

This matters practically: the brief's single-value `declared` cannot express an adapter whose SDK vocabulary is WIDER than the four literals. gemini's `StreamEndReason` has eight named members; expressing that needs the table form.

## Suggestion

Record the real signature in M06's L4 section. The table form is also what makes the "adapter maps its own SDK's terminal reason" sentence in L1 mechanically true, so it is worth stating rather than leaving the brief's simpler shape as the reference an implementer would code against.

