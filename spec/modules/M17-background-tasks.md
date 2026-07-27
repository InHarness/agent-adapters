<!-- anchor: 9mq8rabh -->
# M17 — Background & long-running tasks

> The agent never runs in the background — only a shell process does. M17 gives that backgrounded work its own lifecycle (`background_task_*`), keeps the run alive until it settles, and tells consumers the one rule that prevents the classic timeout bug: **read the stream to `done`, not to the first `result`**.

<!-- anchor: c9orks2t -->
## Purpose

Consumers driving long shell commands (builds, test suites, deploys) through an agent need the run to survive the command outliving the model's turn. When the engine backgrounds a shell command (e.g. Claude Code's `run_in_background` Bash parameter), the model's turn may end with work still in flight; the engine holds the session open, wakes the model when the work settles, and the model continues in a new turn. M17 owns this whole story for the unified contract: the decoupled `background_task_started` / `background_task_progress` / `background_task_completed` event family (M01 owns the type home), the **push resume model** consumers rely on, the `outputFile` tail target, and the stop/disable levers. It exists because the previous shape — background shell tasks sharing the `subagent_*` family — caused a real consumer bug: treating the first `result` as terminal and waiting out the full timeout while the completion event went unread.

**Agent ≠ background.** Only the *shell process* is backgrounded, never the agent itself. A "background task" here is engine-managed side work observed through the stream; it is not a detached agent run, and it is not a subagent (M06 — <section_ref anchor="gs9qkh5p"/> — is scoped to real Task subagents).

<!-- anchor: 8qbvk9c5 -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `background_task_*` events + the `result.backgroundTasks` in-flight signal (type home: M01). |
| L2 | Owns the per-adapter background-task support matrix + degradation. |
| L3 | Disable lever as an adapter-prefixed `architectureConfig` key (e.g. `claude_disallowBackgroundBash`). |
| M06 | Sibling family: `subagent_*` is real subagents only; background shell work routes here instead. |
| M11 | Owns the input channel the control-channel hold keeps open; the hold extends its end-of-turn close policy without changing `pushMessage` semantics. |
| M07 | Out-of-scope alternative (pull model) would build on resume; the blessed path does not need it. |
| M13 | A whole-run `timeoutMs` / `abort()` still bounds a run with in-flight background work. |
| A01 | Today's only adapter with engine-backgrounded work; owns the SDK mechanics (<section_ref anchor="sw3cwrsm"/>). |

<!-- anchor: 01or0cpk -->
## Unified Contract (L1)

- Lifecycle: `background_task_started { taskId, taskType, description }`, `background_task_progress { taskId, taskType, status?, outputFile? }`, `background_task_completed { taskId, taskType, status, outputFile?, summary?, usage? }`. `taskType` discriminates the kind of backgrounded work — `'shell'` (backgrounded shell command), `'monitor'` (a watch/monitor task), `'workflow'` (an orchestration run); adapters map their SDK's task-kind discriminator onto it and route only non-subagent kinds here (real subagents stay `subagent_*`, M06).
- `outputFile`, when present, is the **tail target**: a file path the engine streams the backgrounded process's output into. Consumers wanting live output tail that file; the unified stream itself carries lifecycle, not the process's stdout.
- **Push resume model (the blessed path).** The engine — not the consumer — keeps the session alive while background tasks are in flight: the model's turn ends, the underlying query stays open, and on task settlement the engine emits the completion and wakes the model, which continues and produces a further `result`. The consumer's only obligation is to keep iterating `execute()` until the generator is `done`. No watcher, no polling, no backoff in consumer code.
- Consequently a `result` carrying a non-empty `backgroundTasks` in-flight signal (M01) is **not** end-of-run; the stream later yields the `background_task_completed`, the continuation turn, and a further `result` before `done`.
- **Control-channel hold (adapter obligation).** While a run holds in-flight background work, the adapter MUST keep its input/control channel to the engine open. Where the engine multiplexes its control protocol (permission prompts, user-input requests, hook callbacks) onto the same channel that carries prompt input — as Claude Code does over the CLI's stdin — closing that channel at the turn's `result` destroys the control transport while the session is still alive. The consequence is not a transport error the consumer can see: the engine wakes the model, the model asks its question, and the request is **denied locally** because no answer can be written back. A silent capability loss, so the invariant is stated on the adapter, not left to the SDK.
- The hold is **bounded** (see Edge cases): the run must still terminate if the work never settles or the wake-up never arrives.

*Out-of-scope alternative (documented, not blessed):* a **pull model** — consumer treats `result` as terminal, ends the run, then re-enters via session resume (M07 — <section_ref anchor="uav99wwn"/>) on its own backoff schedule to ask "is it done yet". It works, but it re-implements what the engine already does, costs extra turns, and races the settlement. The spec deliberately does not standardize it.

<!-- anchor: ujhcafnf -->
## Capability & Degradation (L2)

**Background-task support matrix** (canonical home — adapters link here):

| Behavior | claude-code | codex | gemini | opencode |
| --- | :---: | :---: | :---: | :---: |
| Engine-backgrounded shell work | ✅ `run_in_background` | ❌ | ❌ | ❌ |
| `background_task_*` lifecycle | ✅ from `task_*` channel | — | — | — |
| Session held open on in-flight work | ✅ SDK-native | — | — | — |
| Control channel held with the session | ✅ adapter-enforced, bounded | — | — | — |
| Disable lever (force synchronous) | ✅ deny-hook on `run_in_background` | n/a | n/a | n/a |

Degradation: adapters whose SDK never backgrounds work simply never emit the family and never populate `backgroundTasks` on `result` — an absence, not a failure (skip strategy). Consumers written to "iterate to `done`" are correct on every adapter unchanged.

<!-- anchor: 52ymvppn -->
## Configuration & Extensibility (L3)

A consumer that cannot tolerate turns outliving `result` (e.g. strict per-turn billing, hard wall-clock budget) can forbid backgrounding per adapter via an adapter-prefixed `architectureConfig` key — proposed `claude_disallowBackgroundBash: true` for A01, realized as a deny on the backgrounding parameter so the command runs synchronously instead (mechanics in A01, <section_ref anchor="sw3cwrsm"/>). Default is off: backgrounding stays available.

**Stop lever.** A run with in-flight background work is still bounded by M13's `timeoutMs` / `abort()` — aborting closes the session and orphans-or-kills the backgrounded work per the SDK's own semantics. Adapters whose SDK exposes a per-task stop control (e.g. Claude Code's `Query.stopTask()`) may surface it; until then, abort is the coarse stop.

<!-- anchor: q9u5sbot -->
## Edge cases

- Consumer stops iterating at the first `result` while `backgroundTasks` is non-empty → the completion is never observed and the consumer waits out its own timeout — the exact bug this module exists to prevent. The contract rule (M01) makes this a consumer error, not an adapter one.
- Background task settles *during* the model's continuation turn → the engine's own channel serializes events; the completion precedes the final `result` in stream order.
- `abort()` / `timeoutMs` fires with work in flight → the run terminates per M13; no `background_task_completed` is owed after termination.
- Backgrounding disabled via the L3 lever → the same command runs synchronously inside the turn; no `background_task_*` events are emitted and `result` carries no in-flight signal.
- **Work that never settles / a wake-up that never arrives** → the hold must not become a hang. Holding the channel open hands the run's lifetime to the engine, which is correct while work is genuinely in flight and unbounded when it is not (a backgrounded `sleep 3600`, or an SDK version that drops the post-`result` wake-up). Adapters therefore bound the hold twice: a short **grace window** after the last task settles, in which the continuation turn must begin, and a hard **cap** on total hold time measured from the first held `result`. On either expiry the adapter closes the channel and lets the run end, emitting a `warning` naming the bound — the truncation is visible, never silent. Both bounds degrade to the pre-hold behaviour (the run ends at `result`), so a bounded hold is never worse than no hold. `timeoutMs` / `abort()` (M13) remain the consumer-facing levers; the bounds are the adapter's own backstop.

<!-- anchor: 02okhxqj -->
## Acceptance criteria

These verify the decoupled lifecycle, the push resume rule (stream ends at `done`, not at first `result`), and the disable lever.

<tagged_list type="ac" tags="m17"/>

Edge-case criteria:

<tagged_list type="ac" tags="m17-edge"/>
