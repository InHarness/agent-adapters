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
- **Collectors** — `collectEvents(stream)` drains to an array; `filterByType(events, type)` narrows to one variant; `splitBySubagent(events)` partitions parent vs. per-subagent streams. These operate purely on emitted L1 events. A `taskId` may carry more than one lifecycle pair (M06 — <section_ref anchor="0f6287ae"/>). `splitBySubagent` keys on `subagentTaskId`, never on the pair, so both cycles of a re-entered agent land in the **same** bucket, in stream order: the bucket is neither re-created nor split, and the resumed cycle's deltas are indistinguishable from the first cycle's by key alone. A consumer that needs the cycles apart reads the `resumed` marker on the starts inside the bucket.
- **Helpers that stop early MUST honour the in-flight signal.** `takeUntilResult()`, and anything else that ends consumption on a `result`, treats a `result` carrying a non-empty `backgroundTasks` as **not** terminal and keeps going (M01, M17). A shipped helper that stops at the first `result` is worse than a consumer hand-writing the loop: it hands everyone reaching for the ergonomic path the precise bug the signal was added to prevent, while looking like the endorsed way to do it. What this module exports is held to the contract it exists to make easy.

<!-- anchor: 2g7t9cid -->
## Public API & Packaging (L4)

Exports `observeStream`, `createConsoleObserver`, `collectEvents`, `filterByType`, `splitBySubagent`, and related helpers from the package root.

<!-- anchor: mjon1di2 -->
## Edge cases

- Stream terminates with `error` → observers receive the `error` event; collectors include it (consumption never throws on a well-formed error event).
- `splitBySubagent` over events whose `subagentTaskId` is `undefined` (adapters that can't populate it) → those deltas attribute to the single-active/parent bucket per documented fallback.
- `splitBySubagent` over a stream where one `taskId` closed and then re-opened (a `subagent_started { resumed: true }` after a `subagent_completed`) → one bucket carrying both cycles in arrival order. A consumer that treated the first `subagent_completed` as the bucket's terminator sees events arrive after it; the terminator is the **last** completed for that `taskId`, not the first.
- streaming-input run yielding multiple `result` events → collectors return all of them in order; consumers must not assume exactly one.

<!-- anchor: 75c5gpib -->
## Acceptance criteria

These verify observers and collectors cover the full taxonomy and behave on error/multi-result streams.

<tagged_list type="ac" tags="m09"/>
