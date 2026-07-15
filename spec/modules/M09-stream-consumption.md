<!-- anchor: lkqml0gu -->
# M09 — Stream consumption

> Ergonomic ways to consume `AsyncIterable<UnifiedEvent>` — push-style observers for live UIs, and pull-style collectors for tests and batch logic — so consumers don't re-implement event plumbing.

<!-- anchor: s2qlzexy -->
## Purpose

Developers can observe a run as it happens (`observeStream`, `createConsoleObserver`) or collect and slice a finished run (`collectEvents`, `filterByType`, `splitBySubagent`, and siblings) without hand-writing `for await` loops and type guards. M09 owns these consumption utilities. It reads the L1 stream; it adds no new events.

<!-- anchor: o1vqspp0 -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | Consumes the `UnifiedEvent` stream; depends on its shape, adds nothing. |
| L4 | Exports the observer and collector utilities. |
| M06 | `splitBySubagent` groups using `isSubagent` / `subagentTaskId`. |
| M08 | Collectors fold per-event usage into a run total. |

<!-- anchor: diq2em77 -->
## Unified Contract (L1)

- **Observers** — `observeStream(stream, observer)` dispatches each event to typed callbacks; `createConsoleObserver()` is a ready-made observer for logging/CLI.
- **Collectors** — `collectEvents(stream)` drains to an array; `filterByType(events, type)` narrows to one variant; `splitBySubagent(events)` partitions parent vs. per-subagent streams. These operate purely on emitted L1 events.

<!-- anchor: 2g7t9cid -->
## Public API & Packaging (L4)

Exports `observeStream`, `createConsoleObserver`, `collectEvents`, `filterByType`, `splitBySubagent`, and related helpers from the package root.

<!-- anchor: mjon1di2 -->
## Edge cases

- Stream terminates with `error` → observers receive the `error` event; collectors include it (consumption never throws on a well-formed error event).
- `splitBySubagent` over events whose `subagentTaskId` is `undefined` (adapters that can't populate it) → those deltas attribute to the single-active/parent bucket per documented fallback.
- streaming-input run yielding multiple `result` events → collectors return all of them in order; consumers must not assume exactly one.

<!-- anchor: 75c5gpib -->
## Acceptance criteria

These verify observers and collectors cover the full taxonomy and behave on error/multi-result streams.

<tagged_list type="ac" tags="m09"/>
