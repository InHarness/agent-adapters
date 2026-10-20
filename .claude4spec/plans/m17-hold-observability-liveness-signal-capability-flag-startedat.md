---
type: plan
title: 'M17 hold observability — liveness signal, capability flag, startedAt'
created_at: '2026-08-25T20:58:21.221Z'
created_by: agent
applied: false
---
# M17 hold observability — liveness signal, capability flag, `startedAt`

<!-- anchor: moculf6q -->
## Intent (whose need, why now)

A downstream consumer (claude4spec) is a **localhost-only, single-user HTTP server streaming SSE to a browser**. It has chosen the **hold** path — it accepts engine-backgrounded work and keeps the connection open across the hold — rather than opting out via `claude_disallowBackgroundBash`. It already holds SSE open for minutes for its own blocking tooling, client disconnect does not abort its adapter run, and a late-joining client replays a buffer. So "keep the connection" is an existing pattern there, not a new one.

That decision is workable today, but it exposes a real asymmetry in our contract: **`result` stopped meaning "end of run", and we gave nothing back that lets a consumer reason about the hold.** During a hold the unified stream can be *completely silent* — the engine's `system/status` and `system/background_tasks_changed` frames are consumed adapter-internally to re-arm the grace window and deliberately dropped. A consumer that must emit keepalive therefore fabricates it blind: its keepalive asserts liveness it cannot observe.

This plan closes that gap. It is **not** a redesign of the push-resume model — that model stays blessed, and the pull/detach alternative stays out of scope. It adds observability to a hold the consumer has already agreed to wait through.

Consumer has accepted three boundary conditions, which shape what we do *not* need to build: cap always set explicitly and **never `null`**, consumer `timeoutMs` **above** the cap, and a cap on their own replay buffer.

**Out of scope, decided:** ETA / predicted duration on `BackgroundTaskRef`. Neither engine nor adapter can honestly estimate how long a model-issued shell command runs; a fabricated ETA is worse than none because consumers build thresholds on it. `startedAt` (W3) is the honest substitute. Consumer has withdrawn the ETA request.

**Role boundary:** this plan changes `spec/` only. Every code change flows through a release brief to the brief-implementer; no workstream here touches `src/`.

<!-- anchor: r21n9n59 -->
## Workstreams, in consumer priority order

<!-- anchor: lzigd72t -->
### W1 — Liveness signal during the hold (priority 1)

**Need.** Tell a parked consumer that the session is alive and what it is waiting for, at a guaranteed cadence, so keepalive stops being a lie and the UI can say "waiting on 2 tasks" instead of showing an anonymous spinner.

**Shape.** A new side-band `UnifiedEvent` variant. Type home is M01 (L1 vocabulary); emission semantics are owned by M17; the claude-code mechanics land in A01.

Proposed payload:

```
{ type: 'hold_heartbeat';
  heldForMs: number;                    // since the hold armed at the held `result`
  backgroundTasks: BackgroundTaskRef[]; // same rule as result.backgroundTasks — never a subagent
  subagentCount: number }               // held subagents, counted but not enumerated
```

Three design commitments to write explicitly, because each is a place a later "optimization" would silently break something:

1. **Adapter-generated on a timer, not a pass-through of engine frames.** Passing engine heartbeats through inherits their cadence, which is undefined and version-dependent — and a cadence guarantee is the entire point. A consumer needs to know the maximum silence, not to hope.
2. **The heartbeat MUST NOT re-arm the grace window or the cap.** It is our own frame; feeding it back into the bounds would make the run immortal — precisely the failure the bounds exist to prevent. It is an output of the hold, never an input.
3. **The split from `<inline_mention type="ac" slug="ac-result-backgroundtasks-lists-engine-backg"/>` is preserved.** `backgroundTasks` here carries background kinds only, exactly as on `result`; held subagents surface as a *count*, so they are visible as liveness without ever being listed as something that will emit a `background_task_completed`.

**Terminality.** The variant joins `flush` and `warning` in the side-band class — exempt from the terminality rule and from ordering assertions. This edits four places that currently name the exempt set by enumeration: M01's definition of terminal (<section_ref anchor="8do90d06"/>), M12's toolkit contract (<section_ref anchor="n44tj2yh"/>), M09's helper obligations (<section_ref anchor="diq2em77"/>), and M09's observer surface (a new typed callback).

**L3 lever.** `claude_backgroundHeartbeatMs` as an adapter-prefixed `architectureConfig` key, sitting beside `claude_backgroundGraceMs` / `claude_backgroundHoldCapMs`. Same invalid-value discipline as its siblings.

**Files.** M01 (type home + terminality), M17 L1 (semantics, the three commitments) + L2 (support row) + L3 (the lever) + edge cases, A01 per-capability consumption (mechanics, cadence source), M09 L1, M12 L5.

<!-- anchor: pbyskhwr -->
### W2 — `architectureCapabilities(arch).backgroundTasks` (priority 2)

**Need.** The consumer wants architecture-generic code and refuses to hardcode "claude-code → yes" on its side. Today it must, because M17 is the only capability module with a support matrix and **no flat flag** — M11 has `midTurnPush`, M15 `pathScope`, M18 `toolGating`, M17 has nothing. This is an inconsistency with our own L2 convention, which M18 explicitly cites.

**Shape.** A plain bool, advertising only whether the adapter's SDK can background work at all — deliberately saying nothing about hold strength or bounds, mirroring how `toolGating` refuses to carry strength. `true` for the three claude-code architectures, `false` for codex / opencode / gemini and for unknown/custom.

**Files.** M17 L2 (declares the flag, one row per adapter, links the existing matrix), M01 L2 (the flat-flag mechanism gains one member), M12 (contract-extension checklist: capability matrix bump).

<!-- anchor: ys67f85z -->
### W3 — `startedAt`, plus two undocumented fields (priority 3)

**Need.** A "running for 4 min" counter and a threshold decision, without inventing an ETA.

**Shape.** `startedAt` (ISO-8601, consistent with `NormalizedMessage`'s timestamp) on `background_task_started` and on `BackgroundTaskRef`.

**Fold in two drifts found while answering the consultation** — both are cases where the shipped type is wider than the spec:

- `BackgroundTaskRef` carries `description?`, which M17's L1 list omits.
- `background_task_progress` carries `description?`, likewise unlisted.

**Files.** M01 (type home), M17 L1 (semantics + the two drift fixes).

<!-- anchor: 4fgu2a43 -->
### W4 — The `timeoutMs` > cap rule, written for the consumer (priority 4)

**Need.** We document the cap-vs-`collectEvents()` race but never state the same rule for a consumer's own `timeoutMs`. The consultation surfaced that three clocks are in play with three different zero points, and nothing says so: consumer `timeoutMs` is **absolute from run start and never re-armed**, the grace window measures **engine silence**, and the cap measures **time since the held work last moved**. A hold therefore spends the consumer's timeout budget, and a `timeoutMs` at or below the cap guarantees the typed `AdapterBackgroundHoldExpiredError` is never seen — the run dies as a generic timeout instead, losing the only signal that says *why*.

**Shape.** A rule in M17 L3 beside the existing `collectEvents()` note, plus the three-clocks statement, plus a cross-reference from M13's error hierarchy so a reader arriving from the error finds the ordering constraint.

**Files.** M17 L3 (<section_ref anchor="52ymvppn"/>) + edge cases, M13 L1 (<section_ref anchor="8q9q7ty7"/>).

<!-- anchor: bycm61dj -->
### W5 — Iterator abandonment and `taskId` durability (priority 5)

**Need.** The consumer is currently relying on my read of the implementation for two behaviours the spec never states. Both belong in the contract, because both are load-bearing for anyone choosing between hold and detach.

**Shape.** Two statements in M17, written as contract rather than as observed behaviour:

- **Abandoning the iterator is a silent abort, not a detach.** Breaking out of `for await` runs the adapter's teardown; the session ends, and per the existing abort rule no `background_task_completed` is owed afterwards. Consumers must not read "stop iterating" as "let it run and collect later".
- **`taskId` is run-scoped and has no durability.** It is meaningful inside one `execute()` and is not promised across a process restart or a resumed session. This makes explicit why the pull/detach alternative is not merely unstandardized but currently unbuildable on our identifiers — closing a door the spec today leaves ambiguous by silence.

**Files.** M17 L1 (<section_ref anchor="01or0cpk"/>) + edge cases (<section_ref anchor="q9u5sbot"/>).

<!-- anchor: s0rhhd2g -->
### W6 — `status` as an open union (priority 6, gated)

**Need.** Today `status` is a bare `string` on `background_task_progress`, `background_task_completed` and `subagent_completed`, with no enumerated values anywhere — so a consumer cannot distinguish a task that succeeded from one that failed, and has (correctly) decided to render it as an opaque label.

**Shape.** An open union in M01 that enumerates the known values and keeps the escape hatch — exactly the pattern already used for `TodoItem.status` and for `BackgroundTaskType`. Includes naming the value that means failure.

**Gate — this workstream cannot start on the others' schedule.** A01's L7 discipline is explicit that task-channel spellings are **observed, not assumed** (the `local_bash` case is the standing reminder). Writing an enum from memory is exactly the failure that discipline exists to prevent. So W6 is blocked on a live probe across the declared peer-SDK range, recording actual `status` values for a succeeding and a failing backgrounded command, plus a subagent. Until the probe lands, the spec keeps saying `string` — deliberately, not by omission.

**Files.** M01 (type home), M17 L1 + edge cases, A01 L7 (a probe row).

<!-- anchor: 3lk0fkmb -->
## Cross-cutting work

- **Acceptance criteria.** Each of W1–W5 gets `ac` entities via entity-tools, tagged `m17` / `m17-edge` (and `m13` for the W4 cross-reference), created through MCP rather than as inline checklists — matching how M17's criteria already live. At minimum: guaranteed heartbeat cadence while parked; heartbeat never re-arms either bound; heartbeat excluded from terminality; `backgroundTasks` on the heartbeat never lists a subagent; the flag is `false` on the three non-backgrounding adapters; abandonment owes no completion.
- **Semver + CHANGELOG (M12).** W1–W3 are additive to `UnifiedEvent` / capability / param shapes → **minor** under M12's rule. W1 additionally alters runtime behaviour on an existing path (a previously silent hold now emits frames), so it takes an explicit **behavioral CHANGELOG note** under the same rule the M15 path-scope hardening set. W4–W6 are documentation plus one type widening.
- **e2e (L5).** The claude-code wake-up matrix gains heartbeat assertions: cadence during a silent backgrounded `sleep`, and silence-free coverage of the subagent-parked case. A new scenario-catalog row per M12's contract-extension checklist.
- **Index drift check.** M17's row and the key-relations diagram after the flag and the new event land.
- **Release brief.** One brief covering W1–W3 as a single contract wave; W4–W5 ride along as documentation; W6 follows its probe. The brief is the handoff to the brief-implementer — this plan stops at the spec boundary.

<!-- anchor: ilxxwmrg -->
## Open decisions — need your call before I write W1

**D1 — heartbeat scope and, consequently, its name.** The hold serves *both* engine-backgrounded work and subagents that outlive their turn. If the event is scoped to background tasks only and named `background_task_heartbeat`, then the commonest silent case — a run parked on a long subagent — stays silent, which defeats the purpose. **My recommendation: family-neutral `hold_heartbeat`, emitted for any hold**, with the payload split above keeping the background/subagent distinction intact. The alternative is a narrower, more obviously-named event that solves less.

**D2 — default cadence.** Proposal **10 s**, comfortably under common proxy idle timeouts while adding little noise; the consumer is localhost-only so nothing forces it lower. The knob is what handles the general case.

**D3 — does the heartbeat fire outside a hold?** Recommendation **no** — only while parked. A general-purpose stream heartbeat is a different feature with a different owner, and emitting during an active turn duplicates a stream that is already flowing.

<!-- anchor: 0j0gxntt -->
## Sequencing

1. Resolve D1–D3.
2. W1 + W2 + W3 as one wave: M01 type home first (it is the type home for all three), then M17, then A01, then M09 / M12 / index.
3. W4 + W5 as a documentation pass in the same wave.
4. AC entities for W1–W5.
5. Release brief for the wave.
6. W6 after its probe, as a separate, smaller wave.
