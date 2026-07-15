<!-- anchor: 6ohto5cl -->
# M08 — Token usage & metrics

> Make "how much did this cost" and "how full is the context window" two separate, legible numbers — and reconcile SDKs that report cumulative totals against those that report per-turn deltas.

<!-- anchor: isl5vi9a -->
## Purpose

Developers can read consistent usage across engines: billed input/output tokens, cache read/write tokens, and a distinct `contextSize` (window occupancy, not billing). M08 owns the `UsageStats` shape, aggregation across turns and subagents, and the `priorUsage` mechanism that turns codex's **cumulative** usage into a per-turn delta — including the cross-process case where a resumed codex run must be seeded with the prior total. Billing and window occupancy are deliberately not the same field.

<!-- anchor: twe74trq -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `UsageStats` on `result`, `subagent_completed`, and `NormalizedMessage.usage`. |
| L4 | Exports `UsageStats`, usage aggregation helpers, and `priorUsage` seeding. |
| M02 | Context-window sizes come from model metadata to interpret `contextSize`. |
| M09 | Stream collectors aggregate per-event usage into a run total. |

<!-- anchor: jng2uu2p -->
## Unified Contract (L1)

- `UsageStats` separates **billing** tokens (input/output, plus cache read/write) from **`contextSize`** (tokens occupying the window). The two diverge with caching and compaction.
- Usage appears on the terminal `result`, on `subagent_completed` (per-subagent), and optionally on `NormalizedMessage`.

<!-- anchor: zqm60jzu -->
## Public API & Packaging (L4)

Exports `UsageStats`, the aggregation helpers, and the `priorUsage` seed from the package root.

<!-- anchor: 6kzt7gmh -->
## Edge cases

- **codex cumulative usage** → each report is a running total; the adapter computes the per-turn delta by subtracting `priorUsage`.
- **codex cross-process resume** → the prior total is not in memory; `priorUsage` must be seeded from the caller so the first delta after resume is correct (not the whole history).
- Adapter reports no cache fields → cache tokens are absent, not zero-faked; aggregation tolerates missing fields.
- `contextSize` unavailable from an SDK → reported as undefined rather than conflated with billed tokens.

<!-- anchor: o8h8guw4 -->
## Acceptance criteria

These verify billing/window separation and correct delta computation from cumulative sources.

<tagged_list type="ac" tags="m08"/>
