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
| M18 | A background task is a shell task — a `shell` deny disables this module's capability for that run. |
| A01 | Today's only adapter with engine-backgrounded work; owns the SDK mechanics (<section_ref anchor="sw3cwrsm"/>). |

<!-- anchor: 01or0cpk -->
## Unified Contract (L1)

- Lifecycle: `background_task_started { taskId, taskType, description }`, `background_task_progress { taskId, taskType, status?, outputFile? }`, `background_task_completed { taskId, taskType, status, outputFile?, summary?, usage? }`. `taskType` is the **unified** vocabulary consumers see — `'shell'` (backgrounded shell command), `'monitor'` (a watch/monitor task), `'workflow'` (an orchestration run) — **not** the SDK's on-the-wire discriminator. Each adapter maps its SDK's own task-kind spelling onto these names; the wire values may differ and MUST NOT be matched against this enum directly (Claude Code, for one, sends `task_type: 'local_bash'`, prefixing locally-executed kinds with `local_`, which the adapter strips before mapping — see A01 <section_ref anchor="sw3cwrsm"/>). Adapters route only non-subagent kinds here (real subagents stay `subagent_*`, M06).
- `outputFile`, when present, is the **tail target**: a file path the engine streams the backgrounded process's output into. Consumers wanting live output tail that file; the unified stream itself carries lifecycle, not the process's stdout.
- **Push resume model (the blessed path).** The engine — not the consumer — keeps the session alive while background tasks are in flight: the model's turn ends, the underlying query stays open, and on task settlement the engine emits the completion and wakes the model, which continues and produces a further `result`. The consumer's only obligation is to keep iterating `execute()` until the generator is `done`. No watcher, no polling, no backoff in consumer code.
- Consequently a `result` carrying a non-empty `backgroundTasks` in-flight signal (M01) is **not** end-of-run; the stream later yields the `background_task_completed`, the continuation turn, and a further `result` before `done`.
- **`backgroundTasks` carries background work only — never a subagent.** It is the same split as the event families: real spawned helper agents are `subagent_*` (M06), and a subagent listed here promises a `background_task_completed` that will never arrive, so a consumer obeying "iterate to `done`" waits for an event that does not exist. Subagents *do* hold the session — that is the control-channel hold's job, and it holds for both kinds — but holding and reporting are separate decisions. Where the engine's own report uses a friendly display label rather than its internal discriminator (Claude Code's `BackgroundTaskSummary.type` is literally `'subagent'` for helper agents), adapters MUST classify it through the same mapping that routes the event families rather than passing it through.
- **This rule binds the library's own helpers, not just consumers.** Anything shipped that consumes a stream — `takeUntilResult()` and the conformance suite included — must honour the in-flight signal. A helper that stops at the first `result` hands every consumer that uses it the exact bug the signal exists to prevent (L4).
- **Control-channel hold (adapter obligation).** While the engine holds the session past a turn's `result` — for background work *or* for a subagent that outlives the turn — the adapter MUST keep its input/control channel to the engine open. Where the engine multiplexes its control protocol (permission prompts, user-input requests, hook callbacks) onto the same channel that carries prompt input — as Claude Code does over the CLI's stdin — closing that channel at the turn's `result` destroys the control transport while the session is still alive. The consequence is not a transport error the consumer can see: the engine wakes the model, the model asks its question, and the request is **denied locally** because no answer can be written back. A silent capability loss, so the invariant is stated on the adapter, not left to the SDK.
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


The hold and the routing are proved live, not only by construction: claude-code's suite runs a wake-up matrix over {backgrounded bash, subagents} × {one-shot, streaming}, which is what makes the "control channel held with the session" row a measured ✅ rather than a design intent — coverage is owned by the adapter (see <section_ref anchor="a01e2ecv"/>).


**Suppressed by an M18 `shell` deny.** Engine-backgrounded work is shell work: the tool that starts it *is* the shell tool, run with a background flag. A run that denies the `shell` group (<section_ref anchor="4j6f86yq"/>) therefore has no background-task capability at all — the family is never emitted and `backgroundTasks` is never populated, exactly as on an adapter whose SDK cannot background work. This is the skip strategy above, reached by a different route, and it is deliberately *not* a degradation to report: the consumer removed the shell, so the absence of shell tasks is the requested outcome rather than a shortfall. The disable lever in L3 stays independent — it forces backgrounded shell work to run synchronously, whereas an M18 deny removes the shell itself.

<!-- anchor: 52ymvppn -->
## Configuration & Extensibility (L3)

A consumer that cannot tolerate turns outliving `result` (e.g. strict per-turn billing, hard wall-clock budget) can forbid backgrounding per adapter via an adapter-prefixed `architectureConfig` key — proposed `claude_disallowBackgroundBash: true` for A01, realized as a deny on the backgrounding parameter so the command runs synchronously instead (mechanics in A01, <section_ref anchor="sw3cwrsm"/>). Default is off: backgrounding stays available.

**Stop lever.** A run with in-flight background work is still bounded by M13's `timeoutMs` / `abort()` — aborting closes the session and orphans-or-kills the backgrounded work per the SDK's own semantics. Adapters whose SDK exposes a per-task stop control (e.g. Claude Code's `Query.stopTask()`) may surface it; until then, abort is the coarse stop.

**Hold-bound levers.** Both bounds on the control-channel hold (see <section_ref anchor="q9u5sbot"/>) are consumer-tunable through adapter-prefixed `architectureConfig` keys — `claude_backgroundGraceMs`, `claude_backgroundHoldCapMs`. The defaults are sized off measurements of one engine at one version, and the grace is paid as **dead time at the end of every task-touching run**: the consumer already holds its `result`, but the generator does not reach `done` until the window expires. A consumer on a tight wall-clock budget, or one that never expects a wake-up, must be able to buy that tail back rather than fork the adapter. A value that is not a finite number above zero degrades to the default — a `0` would disarm a bound whose purpose is keeping the control channel open, which is the failure the module exists to prevent, so "invalid" must never mean "no bound".

<!-- anchor: q9u5sbot -->
## Edge cases

- Consumer stops iterating at the first `result` while `backgroundTasks` is non-empty → the completion is never observed and the consumer waits out its own timeout — the exact bug this module exists to prevent. The contract rule (M01) makes this a consumer error, not an adapter one.
- Background task settles *during* the model's continuation turn → the engine's own channel serializes events; the completion precedes the final `result` in stream order.
- `abort()` / `timeoutMs` fires with work in flight → the run terminates per M13; no `background_task_completed` is owed after termination.
- Backgrounding disabled via the L3 lever → the same command runs synchronously inside the turn; no `background_task_*` events are emitted and `result` carries no in-flight signal.
- **Work that never settles / a wake-up that never arrives** → the hold must not become a hang. Holding the channel open hands the run's lifetime to the engine, which is correct while work is genuinely in flight and unbounded when it is not (a backgrounded `sleep 3600`, or an SDK version that drops the post-`result` wake-up). Adapters therefore bound the hold twice, and **neither bound may run while the model is producing** — a bound firing mid-turn closes the control channel the hold exists to protect, re-creating the very defect. So:
  - a short **grace window**, armed only once everything tracked has settled (the sole outstanding thing is then a wake-up) and **re-armed by every frame that arrives while parked**, so what it measures is engine *silence*. Sizing it is an empirical question, not a taste one: it must exceed the gap between the last task settling and the first frame of the continuation turn (A01 records the measurement — <section_ref anchor="sw3cwrsm"/>).
  - a hard **cap** on the parked stretch, for work that is still running and may never finish. Released the moment a continuation turn begins, because from there the run is an ordinary live turn again and is bounded by `timeoutMs` / `abort()` (M13) like any other.
- **The two bounds have opposite outcomes: grace expiry is silent, cap expiry is a terminal `error`.** They are not two flavours of one mechanism. *Grace* fires with everything settled and the engine quiet — that is how a healthy task-touching run *ends*, exactly where the pre-hold adapter closed the channel, at `result`. Announcing it would fire on the happy path and tell every such run that its work was cut short: a false data-loss report, and a noisy one, since it lands on every run that so much as spawned a subagent. So grace closes the channel and says nothing; the run ends at `result` like any other. *Cap* fires with something genuinely unsettled **and the engine still alive** — and that second half is what forbids the quiet ending. Closing the control channel under a live engine is the defect the hold exists to prevent, only relocated: the session keeps talking while permission prompts, hook callbacks, MCP calls and elicitation are all silently dead behind a closed transport. The cap therefore **ends the run** — it interrupts and aborts the session, down the same path `abort()` uses — and the run's last event is an `error` carrying a typed hold-expiry error (M13 — <section_ref anchor="8q9q7ty7"/>) that names the bound it hit and the lever that moves it.
- **The cap's signal is an `error`, not a `warning`, and that is load-bearing.** A warning-and-carry-on shape was tried and is precisely what this rule forbids: a warning string arriving among dozens of successful-looking empty tool results is not something a consumer can branch on, while a terminal, typed error is. So the obligation is threefold — the error is **typed** (distinguishable by class *and* by a `name` that survives serialization, so a hold expiry is never confused with a consumer `abort()` or a consumer timeout), it **carries the cap** (both as a field and inside the human-readable message, alongside the config key that raises it), and it is **terminal** (nothing follows it; the run is over). A consumer that sees it knows exactly one thing happened: background work stopped making progress, the session was ended rather than left half-dead, and any remaining task is abandoned with its completion never to be reported.
- **The cap must stay strictly under whatever timeout the consumer applies to the stream** — including the one the library's own `collectEvents()` helper applies by default. The two clocks race and the consumer's starts *earlier* (at the run's start; the cap only arms at a held `result`), so a cap set at or above it can never surface its own error: the helper rejects the run first, the failure is reported as a generic timeout, and the specific signal that background work was abandoned is lost. Adapters pick a default below the helper's, and the lever's documentation says to raise both together.
- **Deciding whether to hold.** Where the engine publishes its own in-flight report (Claude Code exposes `background_tasks` on the `Stop` hook), the adapter reads it as a **positive signal only**: non-empty means hold. An *empty* report is not permission to close — measured on 0.3.153, it reported `[]` on a session the engine then held open, woke, and ran a further turn (A01). The adapter's own task tracking stays the fallback, and the hold takes the union.

- `shell` denied under M18 while the disable lever is also set → no conflict and no error; the deny is the stronger statement and the lever has nothing left to act on.
- A run denies `shell` on an adapter whose background work survives the deny (a documented M18 escape surface) → the family may still be emitted, and consumers must still iterate to `done`. M17's contract is unchanged by the policy; what changes is only whether such a task can start.

<!-- anchor: 02okhxqj -->
## Acceptance criteria

These verify the decoupled lifecycle, the push resume rule (stream ends at `done`, not at first `result`), and the disable lever.

<tagged_list type="ac" tags="m17"/>

Edge-case criteria:

<tagged_list type="ac" tags="m17-edge"/>
