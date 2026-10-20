---
type: plan
title: Specify timeoutMs arming semantics in RuntimeExecuteParams (M01/L1)
created_at: '2026-09-21T20:48:30.620Z'
created_by: agent
applied: true
---
<!-- anchor: xxnrz5l5 -->
## Intent

This plan previously read as a documentation gap: "the specification never says what arms `timeoutMs`, so write a sentence." That framing is withdrawn. The origin is a **defect in the primitive**, reported from code:

`timeoutMs` arms **one** absolute timer at run start and nothing can extend it (`src/adapters/claude-code.ts:1705`, per the consumer's report — not yet verified by us; see entry 0). A run is therefore bounded by elapsed time, while the thing worth bounding is **silence**. The consequence reached a user: with a blocking nested turn the parent's absolute clock swallows the child's time, and a child started at minute 20 kills the parent with a bare timeout at minute 60 instead of the collapsed error the consumer's contract promises.

The consumer's owner has decided their own side: no turn has an absolute timeout; the turn clock is an idle clock. They built it, and their code review caught the same class of bug twice more:

1. a blocking child turn — the stream is silent while the child runs;
2. a single long foreground tool call — the stream is silent from `tool_use` until `tool_result`, so a 10-minute build dies as "agent went silent".

**The lesson, and the reason this plan exists:** the rule "re-arm on the last sign of life" is the wrong shape. Silence means nothing on its own; it means something only when **nothing is known to be in flight**. The correct primitive is a set of **outstanding work** states, not a list of signals that reset a timer. Every fix built the other way is a special case, and the list of special cases is never complete.

The question this plan must settle is therefore **not** how to word a bullet. It is: **is an absolute, non-extendable whole-run timer the right primitive for this library, given that its only consumer has now tripped over its absence three times?**

<!-- anchor: n1h1axil -->
## Decisions
**Decided by the owner, binding on this plan:**

- An unanswered `user_input_request` is **outstanding work**: the idle clock stops. It is not agent silence. (This bears on `modules/M13-errors-resilience.md` `1vd9sye5` — see entry 5.)
- **Entry 1 → branch (C).** `timeoutMs` stays an absolute backstop, and a separate outstanding-work-aware idle primitive (`idleTimeoutMs`) is added. Entries 2, 3, 4, 5, 6 (6a–6d) and 7 all execute in their (C) shape.
- **Entry 4 → a distinct error class, `AdapterIdleTimeoutError`**, not `AdapterTimeoutError` with a discriminating reason. This follows the pattern the hierarchy already holds: a separate bound gets a separate class, as `AdapterBackgroundHoldExpiredError` already does.

**Nothing is blocking. Entry 0 has run; its facts are below.**
<!-- anchor: 2fahu1nc -->
## Entries, in execution order

<!-- anchor: 0codever -->
### 0. Verify the runtime in code — BLOCKED, must run first
**EXECUTED 2026-09-22**, against `src/` at HEAD `9a7e0f5`. The statements below are no longer hearsay; every downstream entry may rely on them. Where an answer could not be established, it says so.

| # | Question | Fact | Address |
| --- | --- | --- | --- |
| 1 | Where armed; shared or copied | **Four separate, hand-copied blocks.** No shared abstraction, no helper, no import — each is the same `let timedOut = false; let timeoutId; if (params.timeoutMs) { … }` under a `// Timeout handling` comment. | `claude-code.ts:1704-1711`, `codex.ts:387-394`, `opencode.ts:469-477`, `gemini.ts:659-668` |
| 2 | Level of arming; clear/reset | **Whole `execute()` call, armed exactly once** before the main loop. Not per iteration, not per SDK request. `clearTimeout` only on init-error early returns and in the run `finally`; **no code path re-arms it.** | `claude-code.ts:1726…2613`, `codex.ts:593`, `opencode.ts:892`, `gemini.ts:974` |
| 2a | Init inside or outside the bound | Differs per adapter: claude-code arms **before** skills/images/MCP/SDK spawn (init inside the bound); codex and gemini arm **after** SDK import and session start (init outside); opencode arms after server spawn but before `session.create`. | as above |
| 3 | `timeoutMs` omitted | **No timer at all, in all four. No fallback default anywhere.** The guard is truthiness, so `0` and `NaN` also mean "no timer"; no validation or clamping exists. The field is declared `timeoutMs?: number;` with **no JSDoc**. | `types.ts:816` |
| 3a | The only default clock in the repo | `COLLECT_EVENTS_DEFAULT_TIMEOUT_MS = 120_000` — a consumer-side helper (`collectEvents`), rejecting with a plain `Error`, not `AdapterTimeoutError`. Not an adapter bound. | `utils.ts:17,22-46` |
| 4 | `streamingInput` / `pushMessage` | **One timer spans the entire streaming session and ticks through idle gaps between pushes.** The push path never touches `timeoutId`. Multiple `result` events per run all run under that one timer. | `claude-code.ts:1705-1711,1787`; `types.ts:839-854` |
| 4a | Test coverage for it | Partial. A held streaming run with `timeoutMs: 300` and an e2e with `timeoutMs: 8000` both exist, but **no test anywhere combines `pushMessage()` with `timeoutMs`** — nothing asserts whether a push affects the clock. | `claude-code.subagent-lifecycle.test.ts:282-293`; `e2e/claude-code.e2e.test.ts:1700-1725` |
| 4b | Timeout tests per adapter | **Only claude-code has any.** codex, opencode and gemini have zero `timeoutMs` tests of any kind. | `e2e/shared.ts:1002-1006` |
| 5 | Any extension path | **None** — no live code, no dead code, no commented-out code. Greps returning 0: `extendTimeout`, `refreshTimeout`, `resetTimeout`, `resetTimeoutOnProgress`, `keepAlive`, `idleMs`, `idleTimeout`, `touchTimeout`, `armTimeout`, `rearm`, `bumpTimeout`, `renewTimeout`, `timeoutBudget`, `maxTotalTimeout`, `progressToken`, `onProgress`. | — |
| 5a | The only re-armable clock that exists | The background-hold grace and cap: `park()` re-arms grace from **any** frame, `armCap()` re-arms the cap only from `isBackgroundProgress(event)`. A separate mechanism from `timeoutMs`, and **claude-code only**. | `claude-code.background-hold.ts:417-446,468-498`; `claude-code.ts:2046` |
| 6 | `abort()` after 0.10.0 | **There is no 0.10.0 in this tree** — `package.json` is `0.9.10`, latest tag `v0.9.9`. The question as posed is not answerable; what follows is HEAD. | `package.json:3` |
| 6a | What `abort()` does | Iterates every live run: `interruptRun(run)` (fire-and-forget, errors swallowed) → `abortController.abort()` → `closeInputChannel?.()`. | `claude-code.ts:993-1003,1019-1025,1081-1091` |
| 6b | Does it race a pending `onUserInput` | **claude-code: yes** — `abortPromise` is raced against the handler and settles the request `cancel`. **opencode: no** — bare `await params.onUserInput(req)`. **gemini: no** — bare await. **codex: n/a** — the handler is refused with a warning and never invoked. | `claude-code.ts:1441-1449,1969-1987`; `opencode.ts:582-584`; `gemini.ts:714-720`; `codex.ts:185-190` |
| 6c | Consequence in opencode/gemini | Their loops race only `{sdk.next(), wake}` — **no abort branch**. A timeout while parked on a bare `onUserInput` cannot unpark the generator, so the `finally` never runs: `clearTimeout`, `serverClose()` and cleanup are all skipped and opencode's spawned server stays open. | `opencode.ts:596-599,890-895`; `gemini.ts:746-751,971-974` |
| 6d | Is `abort()` a trustworthy sole bound | No. It is **consumer-triggered only**; nothing in the library calls it. With `timeoutMs` omitted and no consumer call, a quiet stream has **no bound at all** in codex, opencode and gemini. | arm sites, row 1 |
| 7 | Background hold cap | `src/adapters/claude-code.background-hold.ts`. Default **`MAX_BACKGROUND_HOLD_MS = 90_000`**; grace `BACKGROUND_WAKEUP_GRACE_MS = 15_000`. Config keys `claude_backgroundHoldCapMs` (min 5000, max 600000) and `claude_backgroundGraceMs`. | `background-hold.ts:297,327`; `options.ts:184-198` |
| 7a | Independent of `timeoutMs` | **Fully independent** — separate timers, separate config, **claude-code only**, and armed at a held `result` rather than at run start. Disarming it via `null` leaves the run bounded by `timeoutMs`/`abort()` alone. Expiry produces `AdapterBackgroundHoldExpiredError`, already a distinct class. | `background-hold.ts:388-393,434-460`; `types.ts:1066-1095` |
| 8 | Does the clock run through a consumer's MCP tool call | **Yes.** A plain wall-clock `setTimeout` with no dependency on adapter state. An in-process (`type:'sdk'`) handler runs in the same process; the main loop simply parks on `sdkIterator.next()` while it executes and the timer fires independently. | `mcp.ts:96-131`; `claude-code.ts:1268-1277,2018-2033` |
| 8a | The peer SDK's own per-call MCP knob | Documented there as a hard wall-clock limit per call that **progress notifications do not extend** — and this library does not expose it: `McpServerConfig` has no `timeout` field, and for `type:'sdk'` the adapter rebuilds the object as exactly `{type, name, instance}`, dropping extra keys. | `types.ts:463-508`; `claude-code.ts:1268-1275` |
| 9 | `resetTimeoutOnProgress` for in-process MCP servers | **Not set, and not ours to set.** Zero occurrences in `src/`. It is a **client-side** `RequestOptions` field of `@modelcontextprotocol/sdk`; this library only ever builds the **server** half. There is no object in `src/` on which it could be set. Whether the peer SDK exposes any route to that client option: **not established.** | `mcp.ts:96-131` |

**What the table changes downstream:**

- Rows 1, 3, 5, 6d and 7a are the inputs entry 1 needed. Four copies, no extension path, and an outstanding-work-aware clock that exists in exactly one adapter — all of it argues the same way, and entry 1 was decided **(C)** on it.
- Row 3 settles entry 2's third bullet: omission is written as a guarantee of **no wall-clock bound**, naming the background hold cap as the standing exception, and noting that the exception itself is claude-code-only (row 7a).
- Row 4 settles entry 2's fourth bullet: one arm per `execute()` call, ticking through idle gaps — this is current behaviour, not just the reading the plan preferred.
- **Row 9 withdraws the M04 candidate in entry 5.** `resetTimeoutOnProgress` is not a fact of this library and no M04 edit follows from it. Row 8a is the fact worth having instead, and it is an M04 question only if someone decides `McpServerConfig` should carry a per-server timeout — not part of this plan.
- **Row 6c is a finding this plan did not go looking for**, outside its scope and not to be fixed here: `modules/M13-errors-resilience.md` `1vd9sye5` requires every adapter to race abort against every consumer handler it awaits, and two adapters do not. That is a spec-vs-code divergence for a follow-up, not an entry.
<!-- anchor: 553a3h1x -->
### 1. Decide where the re-armable clock lives — decision, no edit

This is the consumer's own question (3) put back to us, which the previous version of this plan wrongly treated as already answered. That they chose to build a watchdog of their own settles **their** clock; it does not settle whether this library should keep offering only an absolute, non-extendable one.

- **(A) The absolute timer stays; idle policy belongs to the consumer.** The library's existing line: knowing whether silence is still work is the consumer's judgement.
- **(C) `timeoutMs` stays an absolute backstop, and a separate outstanding-work-aware idle primitive is added** (`idleTimeoutMs`, possibly with an explicit extension call).

**The argument that decides it, and the reason (C) is the recommendation here:** under (A) the consumer must reconstruct the correlation *this library already performs* — pairing `tool_use` with `tool_result` across parallel calls, subagent tool calls, background tasks, parked phases, and an unanswered `user_input_request` — and must reconstruct it identically for four different SDKs whose raw shapes only this layer normalises. The consumer that knows this stream best got it wrong twice in a single pull request. The next one will get it wrong the same way.

**What (A) costs if it is chosen anyway, and it is not nothing:** (A) is only honest if every entry into and exit from an outstanding-work state is **observable in the normalized stream**. That is a contract obligation this specification does not currently carry, and choosing (A) means writing it — otherwise we are telling consumers to build a watchdog on a stream that does not promise them the transitions it needs.

Blocking: entries 2–7 take their shape from this answer.

<!-- anchor: 48l2b7uv -->
### 2. Give `timeoutMs` its type home in M01, as an absolute backstop

Executed under either branch; the wording differs only in what it points at.

- **Address:** `modules/M01-unified-core.md`, `## Unified Contract (L1) — implementor`, anchor `8do90d06`. Append it as the **last** bullet of the `RuntimeExecuteParams` family, after `autoApproveTools` — the section's order is thematic (M15 path-scope → M18 tool-gating → M12 `autoApproveTools`), not alphabetical.
- **Schema fields answered** (`layers/L1-unified-contract.md`, `## Module slice schema`, anchor `yc5ftl18`, implementor shape): the param shape in **how-mode** — "what each variant means and which invariants hold across all adapters". One prose bullet, as the neighbouring fields do it. The field has no type home today; that is the defect this entry closes.
- **Content:**
  1. What it bounds — the whole run, terminating it with `AdapterTimeoutError` (runtime phase), `section_ref` to M13 `8q9q7ty7` for the class and `1vd9sye5` for the outcome. Do not restate M13's outcome; point at it.
  2. **That it is absolute and deliberate** — armed once at run start, never re-armed by any event, frame or progress. Under (C) this is stated as its *role*: it is the backstop, which is why it does not re-arm; the idle clock of entry 3 is the one that does.
  3. **What omission means** — per entry 0 row 3. If omission means no timer, it is written as a guarantee ("no wall-clock bound on the run"), not as an observation, and it names the standing exception: the background hold cap of `modules/M17-background-tasks.md` `q9u5sbot` ends a run regardless of `timeoutMs`. "No limit at all" would be false.
  4. **The unit of arming under `streamingInput`** — `modules/M11-mid-turn-input.md` `fr2hhuye` has the channel live until it drains or `abort()`, yielding one `result` per delivered turn. As an absolute backstop the answer is one arm per `execute()` call; say it, because it is exactly where the ambiguity bites.
- **Idiom:** the neighbours carry two variants of the same phrase in this very section — "Type home is here; absent fields preserve today's behavior" and "Type home is here; Absent field preserves today's behavior byte for byte". Pick one shape; do not copy the words where they would be false (a guarantee is not a preserved status quo).
- **Rule:** rule 3 (a sentence answering an L1 schema field belongs in the L1 section, not in `## Domain`) and rule 2's filling-vs-behavior test (a contract guarantee → the implementor module's L1 section, never the layer file).

<!-- anchor: 3idlemdl -->
### 3. State the outstanding-work model — the substance of this plan

Under **(C)**: this is the new primitive's definition. Under **(A)**: the same model is written as the **observability guarantee** entry 1 names — the stream's promise that a consumer can see every transition — because a consumer cannot build the clock without it. Either way the model is written once, and M01 is its home: it is a contract that holds across all adapters, and it is the clock's own semantics, not error taxonomy.

- **Address:** `modules/M01-unified-core.md`, `## Unified Contract (L1) — implementor`, anchor `8do90d06`, as its own bullet after entry 2's.
- **Content — the model, not a list of signals:**
  - A run is at every moment in one of two states: **nothing outstanding**, where silence means the engine owes us something, and **work in flight**, where silence is expected.
  - The idle clock advances **only** in the first state. This is the whole rule; it replaces "re-armed by the last sign of life", which is the formulation that produced two regressions.
  - **What counts as outstanding** — enumerated, because the enumeration is the contract: a `tool_use` with no matching `tool_result`; a subagent or task in flight; a background task not yet settled; an unanswered `user_input_request` (**decided**, see `<index>`-level decision above); a nested turn the consumer started from inside the run.
  - **Negative scope, stated deliberately:** a pause with nothing outstanding is idleness, however short.
- **The invariant that keeps this from being a hole:** while work is outstanding the run is not unbounded — it is bounded by **that work's own cap**, not by nothing. M17's hold cap (`q9u5sbot`) is the existing instance of exactly this shape; under (C) the model generalises it rather than competing with it. Without this sentence, a hung MCP tool hangs until the absolute backstop.
- **The clock count changes and must be restated where it is stated today.** M17 `q9u5sbot` already contrasts a grace window (re-armed by every frame while parked) with a hard cap on the parked stretch, and assigns `timeoutMs`/`abort()` to M13. Adding an idle clock makes four. The bullet's contrast must name them as distinct and not collapse into an M01-vs-M17 dichotomy; the consumer's invariant is built on telling them apart.
- **Rule:** rule 2 — one home. The enumeration lives here; M04, M06, M11 and M17 get at most a sentence and a `section_ref` back, never their own copy of the list.

<!-- anchor: 4errid8n -->
### 4. Give idle expiry its own error identity in M13

Executed under **(C)** only.

- **Address:** `modules/M13-errors-resilience.md`, anchors `8q9q7ty7` (the class list) and `1vd9sye5` (the outcome).
- **Decision inside the entry:** a distinct class (e.g. `AdapterIdleTimeoutError`) versus `AdapterTimeoutError` carrying a discriminating reason. A consumer must be able to tell "the agent went quiet" from "the run outlived its budget" — they are different user-facing messages and different retry policies, and the consumer's code already distinguishes them.
- **Rule:** rule 2 — M13 owns error identity and phase, M01 owns the clock. Neither restates the other.

<!-- anchor: vb4oh6ao -->
### 5. Reconcile the neighbours the model touches

The previous version of this plan wrote the nested-turn case as negative scope — "how `timeoutMs` composes with a turn started from inside a run is not a contract of this specification". **That is withdrawn.** It was the precise case that broke the consumer, and declaring it out of contract would have recorded the defect as a boundary. Under entry 3 a nested turn is outstanding work and the model covers it.

- **`modules/M13-errors-resilience.md` `1vd9sye5`** — today: "`abort()` / `timeoutMs` while a `user_input_request` is unanswered → still terminates". That stays true of the **absolute** backstop and of `abort()`. It must be reworded so it cannot be read as also governing the idle clock, which now stops there by decision. This is the one place where the owner's decision collides with text already written.
- **`modules/M17-background-tasks.md` `8qbvk9c5`** — "A whole-run `timeoutMs` / `abort()` still bounds a run with in-flight background work" stays true and is the nearest existing precedent for entry 3's invariant. Check it reads consistently once four clocks exist.
- **`modules/M04-mcp-integration.md` `wxyessab`** — the consumer reports that Claude Code does not set `resetTimeoutOnProgress`, so MCP progress notifications extend nothing. Per entry 0 row 9: if that is ours to set or expose, it is an M04 fact and a candidate entry of its own. Do not write it before entry 0 confirms it.
- **`modules/M11-mid-turn-input.md` `fr2hhuye`** and the subagent module — at most a sentence and a `section_ref` to entry 3's enumeration. Rule 2: no second copy of the list.

<!-- anchor: nyl33elk -->
### 6. Acceptance criteria

Type `ac`. Convention verified on M01 (10 criteria tagged `m01`, two of them also `m01-edge`) and on the pattern of M17 `02okhxqj` / M18 `2rln5a4l`: `mXX` on every criterion of the module, `mXX-edge` additionally on those from `## Edge cases`. The existing `ac-adaptertimeouterror-is-produced-when-tim` carries `m13` and states the outcome; none of the new criteria may restate it.

One observable thing each:

- **6a — omission.** `kind: requirement`, tags `m01`. The behaviour of a run executed with `timeoutMs` absent, per entry 0 row 3. Under the no-timer answer it asserts the absence of a *wall-clock* bound, not of every bound.
- **6b — the backstop does not re-arm.** `kind: edge-case`, tags `m01`, `m01-edge`. A run that keeps emitting events past `timeoutMs` measured from run start still terminates.
- **6c — silence during a tool call is not idleness.** `kind: edge-case`, tags `m01`, `m01-edge`. Under (C): a run whose only activity is one long `tool_use` with no `tool_result` yet does not expire on the idle clock. This is the regression the consumer's review caught, written as a criterion so it cannot come back.
- **6d — an unanswered `user_input_request` does not expire on the idle clock.** `kind: edge-case`, tags `m01`, `m01-edge`. Under (C). The owner's decision, made observable.
- **Consequence:** M01's `## Acceptance criteria` (anchor `a7kxmtyl`) carries only `<tagged_list type="ac" tags="m01"/>` today. These are the module's first edge-case criteria, so the section gains a second embed `<tagged_list type="ac" tags="m01-edge"/>` under an "Edge-case criteria:" lead-in, in the shape M17 `02okhxqj` and M18 `2rln5a4l` already use.

No criterion for entry 5's reconciliations: they are rewordings, not new observable behaviour.

<!-- anchor: xsnwqobd -->
### 7. Re-read for redundancy and for what cites the edited section

- **M13** `8q9q7ty7`, `1vd9sye5` — after entries 2–4, M13 owns error identity and phase, M01 owns the clocks. Delete any duplicated outcome from the **new** bullets, never from M13.
- **M17** `q9u5sbot`, `8qbvk9c5` — check the opposite direction: that the four-clock statement and entry 3's per-work cap invariant do not contradict what M17 already decided.
- **The three sections citing `8do90d06`** — `modules/M16-task-tracking.md` `i3tt2nrj` and `qgg6repw`, `modules/M18-tool-gating.md` `4j6f86yq`. They cite it for its type-home framing; confirm two new bullets do not change what they point at.

<!-- anchor: 8goyyatg -->
## Seen, not planned

- `<index>` open question 7 (`0aj92zki`), the deferred autonomous self-scheduling loop with its "whole-cycle timeout/abort" — the eventual home of multi-turn clock composition. Entry 3 covers a nested turn as outstanding work; it does not settle the self-scheduling cycle.
- The four adapter edge-case sections (`677rc2wh`, `26dlg7ut`, `d9ugsejh`, `99avio4b`) each map `timeoutMs` to `AdapterTimeoutError` in one line and none states a per-adapter default. Under (C) each will eventually have to say whether its SDK can honour the outstanding-work model; that is a per-adapter question for after entry 0, not a pre-emptive edit.
- `adapters/A01-claude-code.md` e2e coverage (`a01e2ecv`) marks the `timeoutMs` scenario "covered". Criteria 6c and 6d are not covered by that row, and they are exactly the kind that only a live run proves. Whether L5 coverage must grow is an M12/L5 question.
- `modules/M01-unified-core.md` names its first section `## Purpose`, not `## Cel`, so the module is invisible to the style's purpose sweep (`^## Cel$`). A corpus-wide heading matter.
- The consumer's own pull request (claude4spec #234) carries the mirror-image change on their side. Whatever entry 1 decides, their brief's "what counts as a sign of life" rule is superseded by the outstanding-work model; they know this and intend to file a patch. Coordination, not an edit here.
