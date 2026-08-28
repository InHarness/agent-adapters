<!-- anchor: c3xv3jii -->
# Changelog

All notable changes to `@inharness-ai/agent-adapters` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.9.8] — 2026-08-27

### ⚠ Behavioral change — read this even though nothing will fail to compile

`subagent_completed.status` stays typed `string`, on purpose: the vocabulary below is a specification obligation on what adapters **produce**, not a compile-time constraint on consumers (the same discipline M17 applies to `taskType`). So an exhaustive `switch` over the old values gets **no compiler warning** about the two new ones, and this note is your only signal.

- **`subagent_completed.status` is now a declared four-value vocabulary — `'completed' | 'failed' | 'aborted' | 'stopped'` — that adapters MAP onto rather than forward.** `'aborted'` means a **run-level** termination ended the run (a terminal `error` follows immediately); `'stopped'` means **one** delegation ended while the run kept producing events. They are deliberately distinct: collapsing them destroys the only signal for telling "my subagent was cancelled but the agent is still working" from "everything is over". Consumers switching on `status` should handle both new values. The union is exported as the type `SubagentStatus` for anyone who wants to opt into the narrower type.
- **Aborting or timing out a run now closes every subagent the adapter still had open**, with a synthesized `subagent_completed { status: 'aborted' }` emitted **before** the terminal `error`. Previously the stream simply ended and a consumer pairing `subagent_started` with `subagent_completed` was left holding an unmatched pair forever — its "clean up when every subagent is closed" step never fired. This applies to `abort()`, `timeoutMs`, and a background hold-cap expiry, whether the run ends with a terminal `error` or by natural iterator completion. Exactly **one** completion per start: a subagent that already reported its own end is not closed a second time.
  - The synthesized event reports that **this run stopped tracking that subagent** — not that the helper agent's own execution ended. Use it to close your own bookkeeping; do not read it as evidence that every delegated task actually stopped.
  - **Every run-ending path is covered, not only the terminal ones**: an SDK stream that throws for a reason of its own (transport failure, CLI crash), and the *ordinary* end of a run that still has a delegation the engine never reported on (`error_max_turns` closes the channel while an Agent-tool notification is still seconds away). Once the stream returns nothing can close that pair, so the flush runs there too — on the ordinary path it stands alone, with no error after it.
  - Deliberately the **opposite** of the `background_task_*` rule, which is unchanged: background work outlives the run and only the engine can honestly report its completion, so a remaining background task is still *abandoned* on a cap expiry rather than closed.
- **claude-code now maps its SDK's task status instead of forwarding it verbatim.** A status the adapter does not recognize and that is not cancellation-shaped is reported as `'failed'` plus **one** `warning` per run — never as `'completed'`, because a false claim of success is the one error a consumer would act on irreversibly. Cancellation-shaped spellings the SDK might add (`cancelled` / `canceled`, which its `task_updated` channel already shows) map to `'aborted'`. **If you branch on a raw forwarded value today, re-check that branch** — in particular `'stopped'`, which previously reached you as the SDK's own spelling and now arrives through the map. That `warning` is a **drift** signal, not a capability degradation: it means an SDK status arrived that nothing in the pinned range declared.
- **gemini no longer reports an aborted subagent thread as `'completed'`.** `agent_end` is mapped by `reason`: `failed` → `'failed'`, `aborted` → `'aborted'`, otherwise `'completed'`. The reason is native on that SDK, so the abort case is reported rather than inferred.
- **codex emits no subagent lifecycle events at all**, on any path including abort — documented previously as "at best synthesized", which implied events might arrive. The SDK has no subagent concept; the absence is the contract.

### Added

- **`assertSubagentLifecycle(events)`** in the exported testing toolkit (`@inharness-ai/agent-adapters/testing`). It asserts the two M06 invariants **together** — every `subagent_started` closed before the stream ends, and no start closed twice — plus that no `subagent_*` event follows the terminal error and that every `status` is inside the declared vocabulary. They ship as one assertion because pairing alone would pass a flush that double-closes already-settled subagents.
- **`mapSubagentStatus(raw, declared)`** exported for adapter authors: declared spelling → its counterpart; unrecognized-but-cancellation-shaped → `'aborted'`; anything else → `'failed'` with a `warn` flag. Never `'completed'` for an unrecognized value.

<!-- anchor: u5kp9nlm -->
## [0.9.6] — 2026-08-25

### ⚠ BREAKING

<!-- anchor: 375zq7kb -->
- **`allowedTools` is renamed `autoApproveTools`. There is no alias.** The old name read as a restriction, was documented as nothing, and was silently ignored by three of the four adapters — only claude-code passed it through, and there onto the SDK's permission *allow*-list, which auto-approves and never restricts. The new name says what the field does: tools listed here skip the approval prompt, and omitting a tool never makes it unavailable. To actually remove capability, use `disallowedToolGroups` below. An adapter with no auto-approval primitive (codex, opencode, gemini) now emits exactly one `warning` per run when the field is supplied, instead of dropping it in silence.
- **`planMode: true` now REFUSES the run on adapters that cannot enforce it, where it previously warned and ran anyway.** Plan mode is no longer a per-adapter improvisation; it desugars into `disallowedToolGroups: ['file-write', 'shell']` and inherits the fail-closed posture of tool gating. Concretely: **codex** used to map plan mode onto `sandboxMode: 'read-only'`, delivering a read-only sandbox with a fully live shell — the contract half-honoured, silently — and now refuses before dispatch, because `ThreadOptions` has no shell primitive at all. **opencode** used to `console.warn` "planMode not natively supported — ignored" while asserting `{ edit: 'allow', bash: 'allow' }`, and now genuinely enforces the preset through server-side permission buckets. **The documented opt-out is an explicit empty `disallowedToolGroups`**, which restores the previous behaviour exactly. Reads and web stay available under the preset — plan mode must still be able to research.

<!-- anchor: jveqr8i5 -->
### Added

<!-- anchor: d75z73i4 -->
- **Built-in tool gating — `disallowedToolGroups` (M18).** A consumer can amputate whole classes of built-in capability from a single run — `'shell' | 'file-read' | 'file-write' | 'web'` — declared once in engine-neutral terms and realized by each adapter with its own SDK primitive. The mapping always runs group → SDK identifiers, never the reverse. Absent or `[]` is a no-op, byte for byte. Groups are deny-only and additive: preset-derived and explicitly requested groups are **unioned**, so a preset can never be weakened by omitting its groups; duplicates collapse and order is insignificant.
- **It is deliberately fail-closed, which is the opposite posture from M15 path-scoping.** A requested group with no primitive on the target adapter refuses the run *before dispatch* rather than running with a hole in the policy, and an unknown group string refuses too rather than being silently dropped — enforcing less than was asked for is the failure mode a security policy cannot have. There is **no partial application**: the enforceable groups are not applied on their own. The refusal arrives as `{ type: 'error', error: AdapterToolPolicyError, phase: 'init' }` at the first `next()`, with nothing dispatched, no `adapter_ready` and no `result` — "pre-dispatch" describes the moment of decision, not the delivery channel, and the iterator still never throws.
- **`probeToolGating(architecture, groups)` — synchronous, callable before dispatch.** Returns one `{ group, enforceable, strength, escapeSurfaces }` record per requested group, because a startup *event* arrives too late for a consumer to decline the run. Strength is a separate axis from the capability bool: `hard` means enforced outside the model (an OS sandbox posture, or a server-side refusal before execution), `soft` means the tool is removed from the model's catalog — a model-behaviour gate, not a sandbox — and `none` means the group refuses. **A group with a documented escape surface is never reported `hard`**; the probe reports `soft` and names the surface.
- **`architectureCapabilities(arch).toolGating`.** A plain bool reporting only whether *some* gating mechanism exists. It is `true` on an adapter that can enforce some groups but not others (codex), which is exactly why it is not the thing to branch on for a real gate — `probeToolGating` is.
- **`PLAN_MODE_DENY_GROUPS`** — the plan-mode preset as an exported constant, and the first instance of the preset-registry convention: a named library-built value that desugars a coarse consumer flag into the fine-grained contract.
- **`AdapterToolPolicyError`, and every error class is now exported from the package root** (previously only some were). It carries the adapter id, the unenforceable groups, any unknown group strings, and the enforceable groups with their strength — so a consumer can tell "wrong adapter for this policy" from "typo in the policy" without parsing a message. Distinguishable by `instanceof` and by a `.name` that survives serialization, with `toJSON` carrying the extra fields through.
- **A `tool-gating` e2e scenario across all four adapters, with one negative test per documented escape surface** — so closing a hole shows up as a flipping test rather than as silence. Live-model runs matter more here than replay: only a live model distinguishes *the tool is gone* from *the model chose not to use it*. The residual-allow-list invariant is asserted on **the shape sent to the SDK**, not merely on today's tool set.

<!-- anchor: o34s3kmx -->
### Changed

<!-- anchor: cpdjwl1k -->
- **claude-code: deny-shaped for the consumer, allow-shaped inside the adapter.** The adapter derives a **residual allow-list** on `options.tools` from the non-denied groups and sets `options.disallowedTools` only as a backstop. The ordering is the point: a bare deny enumeration is fail-*open* on the next built-in Anthropic ships, whereas an allow-list blocks a tool this library has never heard of. The deny rides those two fields and deliberately **not** `settings.permissions.allow`/`deny`, which is shared with soft path-scope and auto-approval and could therefore re-widen it; where both land on that surface the M18 deny is applied last, so no allow rule is generated for a denied group at all. SDK `permissionMode: 'plan'` is still avoided, for the original reason: it would also defer consumer-curated MCP tools. Every group is reported `soft` — removing a tool from the model's catalog is a model-behaviour gate, not a sandbox.
- **claude-code: a run's denies are propagated into every subagent definition.** Without this, "deny the shell" would mean "deny the shell until the model delegates" — a subagent does not natively inherit the parent's denies. A definition may narrow its own toolset but never widen past the run's effective policy; a definition naming a tool from a denied group is **not an error** and does not fail the run, including definitions authored before tool gating existed — the intersection wins silently.
- **claude-code: a `shell` deny suppresses the `Skill` tool, and switches background-task capability off entirely.** A skill routinely instructs the model to run shell commands, so leaving the tool available reopens the group through the front door; this overrides the whitelist that otherwise keeps `Skill` available under the preset. And a background task *is* a shell task: with `shell` denied no `background_task_*` events are emitted and `result.backgroundTasks` is never populated — a skip, not a degradation to report. The existing `claude_disallowBackgroundBash` lever stays independent; both set at once is not a conflict, the deny is simply the stronger statement.
- **codex: `sandboxMode` is now composed narrowest-wins and assigned exactly once.** Three inputs land on that single field — `codex_sandboxMode`, the `additionalDirectories`-derived scope, and an M18 `file-write` deny — and it is computed once rather than written and overwritten. `file-write` maps onto `sandboxMode: 'read-only'` (hard, because the OS sandbox blocks writes even from the shell, but coarse: reads and the shell stay live) and `web` onto the SDK web-search toggle, setting both `webSearchMode` and `webSearchEnabled` so a run does not depend on which of the two the resolved CLI honours. `shell` and `file-read` have no primitive and refuse.
- **opencode: the blanket `{ edit: 'allow', bash: 'allow' }` is gone.** Permission buckets are now derived from the deny-groups with a `'*': 'allow'` default. A `file-read` deny covers the file, listing, search and code-search buckets **plus the delegation bucket** — otherwise reads get laundered through a subagent. Bucket names are verified against the running server, and that verification is load-bearing rather than pedantic: the server's permission schema ends in a catch-all, so a mistyped bucket is accepted and silently ignored with no validation error, and a typo would quietly enforce nothing. `hard` is claimed only for buckets confirmed against the binary actually running, since the SDK does not bundle the server.
- **gemini: the hardcoded plan-mode exclusion list (`write_file`, `replace`, `run_shell_command`, `save_memory`) is removed and subsumed by the group mapping.** A `shell` deny now also excludes the background-process tools, which are registered outside the enumerated built-in set. Exclusion happens when the tool registry is built — before the approval policy runs — so a denied tool is never registered and an auto-approving `yolo` mode cannot bypass it. But `excludeTools` is deny-only with no allow-list counterpart, so gemini cannot satisfy the residual-allow-list invariant and every group is capped at `soft`: a built-in added by a peer-SDK bump stays available until the mapping names it.
- **`disallowedToolGroups` joins the always-immutable resume set**, alongside `allowedPaths`/`disallowedPaths` — a capability gate must not shrink or grow mid-session, and a resume that quietly hands the shell back is the same class of failure as one that widens the sandbox. `findResumeViolations` compares the *effective* set, which is how **flipping `planMode` on resume is a violation too**, through the same field-level check with no special case for it.
- **MCP is explicitly out of scope, and stays that way.** Tool gating covers built-ins only: MCP tool names are opaque and cannot be reliably classified as shell/file-read/etc., and guessing wrong in either direction is worse than declining. A run with every group denied can still call every MCP tool it was given, and a filesystem MCP server survives a `file-read` + `file-write` deny. The consumer's remedy is to withhold the server.
- **Denying `file-read` or `file-write` while `shell` stays available emits exactly one `warning` per run.** Groups are independent — denying `file-write` does not auto-deny `shell` — but that combination is not a filesystem boundary, because a shell command reaches the same files. The run proceeds; the warning says so plainly.

<!-- anchor: b7t4m2xk -->
## [0.9.1] — 2026-07-28

<!-- anchor: n5r8k3wq -->
### Added
- **Background & long-running tasks (M17) — `background_task_*`, decoupled from `subagent_*`.** Engine-backgrounded side work gets its own lifecycle: `background_task_started { taskId, taskType, description }`, `background_task_progress { taskId, taskType, status?, outputFile? }`, `background_task_completed { taskId, taskType, status, outputFile?, summary?, usage? }`, where `taskType` is `'shell' | 'monitor' | 'workflow'` (unknown kinds pass through by name). `claude-code` splits the SDK's single `task_*` channel by the `task_type` captured on `task_started` — the discriminator is absent from `task_progress` / `task_notification`, so it is registered per task id and applied to every later message for that task. A `run_in_background` Bash command reports `task_type: 'local_bash'` (the SDK prefixes locally-executed kinds with `local_`; the prefix is stripped before mapping), so backgrounded shell work no longer surfaces as `subagent_started` / `subagent_completed` — the mislabelling that rendered three `sleep` commands as "3 subagents stopped" in consumer UIs. Absent or unrecognized `task_type` keeps the subagent path, so an SDK that stops sending it degrades to the previous shape rather than misrouting real subagents.
- **`result.backgroundTasks` in-flight signal.** A `result` emitted while tracked work is still in flight carries `backgroundTasks: { taskId, taskType, description? }[]`. **When non-empty that `result` is not end-of-run** — the engine holds the session, wakes the model when the work settles, and the stream yields the completion, the continuation turn, and a further `result` before the generator is `done`. Consumers must iterate `execute()` to `done`. The list carries **engine-backgrounded work only, never a subagent** — a subagent would promise a `background_task_completed` that never arrives — though subagents do still hold the session open. It comes from the adapter's own tracking unioned with the engine's own report (`SDKResultMessage` has no such field; the SDK publishes `background_tasks[]` on the Stop hook input, and a future `result` field would be unioned the same way), with every engine-supplied entry classified through the same task-kind mapping that routes the event families.
- **`claude_disallowBackgroundBash` (`architectureConfig`, default off).** Forbids backgrounded shell commands for consumers that cannot tolerate a turn outliving its `result` (strict per-turn billing, hard wall-clock budget). Realized as a synthesized `PreToolUse` deny-hook on Bash calls requesting `run_in_background`, with a deny reason telling the model to re-run the command synchronously.
- **`claude_backgroundGraceMs` / `claude_backgroundHoldCapMs` (`architectureConfig`, default 15000 / 90000).** Both bounds on the control-channel hold are now consumer-tunable. The grace window is dead time paid at the end of **every** run that started any task — including one whose subagents all finished inside the turn — after the consumer already holds its `result` but before the generator reaches `done`; only the consumer knows whether its wall-clock budget can afford the default. A value that is not a finite number above zero degrades to the default rather than disarming the bound, since a `0` would defeat the very protection the hold provides.
- **`COLLECT_EVENTS_DEFAULT_TIMEOUT_MS` exported from `utils`.** Names the 120s default `collectEvents()` applies, so the hold cap's obligation to stay under it is an assertable coupling rather than a comment.
- **Claude Opus 5 in the model catalog.** `opus-5` → `claude-opus-5` for `claude-code` (1M context window) and `claude-opus-5` → `anthropic/claude-opus-5` for `opencode-openrouter`, mirroring the M02 catalog canon. Adaptive-only, so it joins `ADAPTIVE_THINKING_ONLY` and the adapter leaves it on native adaptive thinking rather than pushing a budget it would reject. `claude_effort` is deliberately **not** widened: Opus 5 ships a `low|medium|high|xhigh|max` ladder, but whether to expose the two new rungs is an open spec question, and the three existing values are all valid on it meanwhile. New `test:e2e:claude:opus-5` and `test:e2e:claude:sonnet-5` scripts.
- **`assertNoBackgroundTasks()` exported from `testing`.** Pins the M17 degradation for adapters whose SDK never backgrounds work: no `background_task_*` event, no `result.backgroundTasks`, and — the part worth asserting — no warning about either. An absence reported as a per-turn warning is as wrong as an absence reported as an error, and a custom adapter has no other way to check that it degrades the blessed way.
- **`claude-code`: `abort()` and `timeoutMs` now ask the engine to interrupt the turn.** `Query.interrupt()` is fired (best-effort, un-awaited) before the transport is torn down, so the CLI unwinds its own turn instead of dying mid-write. Reachable only because every run rides an input channel — the SDK refuses to interrupt a plain string prompt. It is strictly additive: termination still rests on the abort controller and on settling outstanding user-input requests with `cancel`, and a rejecting, throwing, or entirely absent `interrupt()` cannot delay or block the abort it accompanies.

<!-- anchor: j9v6p1zd -->
### Fixed
- **`claude-code`: `Tool permission request failed: … Stream closed` after background work settles.** An `AskUserQuestion` raised by the woken model was denied inside the CLI in ~4ms with no host round-trip; the model retried twice and fell back to prose, so the consumer's UI saw its questions auto-rejected. Cause: the CLI is spawned with `--permission-prompt-tool stdio`, so its permission/control protocol shares the stdin the prompt channel feeds — and that channel was closed at the turn's `result` while the engine kept the session alive for in-flight work. Two independent closers reached the same `transport.endInput()`: the adapter's close-at-`result`, and the SDK's own single-turn shutdown for a plain string prompt (`isSingleUserTurn` → *"First result received for single-turn query, closing stdin"*). Both are gone. **Every** run now rides the input channel (`streamingInput` still gates `pushMessage()` alone; a one-shot run is still exactly one `result` and still terminates), and the channel outlives a `result` in any run that touched a task. Nothing-in-flight is deliberately *not* the close condition: on SDK 0.3.210 three subagents reported completion inside the turn and the engine still resumed the model for three further turns before asking. The hold is bounded twice, and **neither bound can fire while the model is producing** — a timer expiring mid-turn would close that same stdin and re-create this very defect. A **grace window** applies once everything tracked has settled (only a wake-up can still be owed) and is re-armed by every frame arriving while parked, so it measures engine silence rather than elapsed time; its expiry is silent, because settled work plus a quiet engine is simply where a task-touching run ends. A **90s cap** bounds the parked stretch while work is genuinely still running (a backgrounded `sleep 3600`) and is released the instant a continuation turn begins; only its expiry emits a `warning`, so the run always terminates and a real truncation is never silent. The adapter also registers a `Stop` hook to read the engine's own `background_tasks` report as a positive hold reason — measured to land ~3ms before the `result` it belongs to on both 0.3.153 and 0.3.210. Its *empty* answer is deliberately not trusted: on 0.3.153 it reported `[]` for a three-subagent session the engine then held open and resumed 2ms later.
- **`claude-code`: `abort()` could not terminate a run parked on an unanswered `user_input_request`.** The loop awaited the consumer's `onUserInput` handler with nothing racing the abort signal, and `abort()` only aborted the controller and closed the channel — neither settles a host promise that resolves on a human reply. A UI-backed consumer could therefore never reclaim such a session: the run parked forever holding its adapter and its SDK subprocess, and the symptom appeared to "heal on restart". The handler is now raced against the abort signal (as is the main loop's wait on the SDK), the outstanding request is answered `cancel` so the SDK-side promise cannot leak, and the stream ends with `AdapterAbortError` / `AdapterTimeoutError`.
- **`claude-code`: post-`result` background wake-up lost entirely on peer SDK 0.3.210.** On the adapter's default one-shot path the backgrounded task settled, its completion fired, and the run simply ended — the model was never resumed, so anything it was told to do afterwards silently never happened (measured: 13s and zero handler calls on 0.3.210 vs 35s and a delivered answer on 0.3.153). Both versions satisfy the declared peer range `>=0.3.0 <0.4.0`, so that range spans a behavioural break. Fixed by the same universal-channel change: all four cells of the work-shape × prompt-path matrix now pass on both versions.
- **`claude-code`: every healthy task-touching run ended with a false data-loss `warning`.** The keep-open condition is "this run started any task", and that set is never pruned, so a run whose subagents had all finished re-entered the hold at its final `result`, sat out the grace window, and ended via the truncation path — emitting *"background work settled but the engine did not resume the model … Anything the model was told to do after the task did not run."* Nothing had been lost; the work was done. Grace expiry is now silent and only the cap warns.
- **`claude-code`: the hard cap could cut off a live, resumed run mid-turn.** The cap timer was armed once at the first held `result` and never released, so a run the engine *did* resume was killed 120s later while the model was still working — closing the CLI's stdin and re-creating the `Stream closed` defect above via its own safety net. The bounds are now released as soon as the main model produces again (subagent chatter, which is what the held state looks like, does not count), and the grace is re-armed rather than disarmed by unrelated frames — the engine really does emit `system/status` and `system/background_tasks_changed` while it babysits work, and any one of them used to disarm the short bound outright.
- **`claude-code`: the wake-up grace window had no margin.** It has to cover the gap between the last task settling and the first frame of the continuation turn; measured with `includePartialMessages` (which the adapter always sets) that gap is 3.5s for backgrounded bash and 3.7s for three subagents on 0.3.210, and 5.0s on 0.3.153 without partials — against a 5s window. Raised to 15s, sized off the measurement. Expiry is silent, and it only delays the generator reaching `done` after the consumer already has its `result`.
- **`result.backgroundTasks` no longer reports subagents.** The field is defined as engine-backgrounded work only ("never a subagent") and as meaning "this result is not end-of-run", so a listed subagent promised a `background_task_completed` that never arrives. An ordinary completed subagent run shipped `backgroundTasks: [{ taskType: 'local_agent' }]`. Entries the engine supplies now also go through the same task-kind classifier as the event families rather than being passed through: `BackgroundTaskSummary.type` is a display label whose value is literally `'subagent'` for helper agents on 0.3.210, and `'local_bash'` for backgrounded shell work. Subagents still hold the session open — holding and reporting are separate decisions.
- **`takeUntilResult()` stopped at the first `result`, contradicting the contract this release introduced.** The exported helper ended consumption on a `result` carrying a non-empty `backgroundTasks`, which is exactly the bug that signal exists to prevent — handed to every consumer who reached for the ergonomic path instead of writing the loop by hand. It now passes a held `result` and stops at the terminal one.
- **The conformance toolkit rejected a legitimate trailing `warning`.** `assertSimpleText`'s terminality check read the last non-`flush` event, but the hold's cap warning is raised from a timer and therefore lands after the run's last `result`. It now reads the last non-`flush`, non-`warning` event — the same exemption the `adapter_ready` check already makes at the other end of the stream.
- **`claude-code`: task-id reconciliation (M16) no longer rests on one English sentence.** The engine-assigned id is recovered by regexing the `TaskCreate` tool_result, so a reworded CLI string would silently reinstate the duplicate-item bug fixed in 0.8.6. The extraction now prefers any structured identifier, accepts several phrasings, and rejects captures that are sentence words rather than ids; failing all that, a positional fallback aliases the unambiguous case (exactly one unreconciled create, an update naming an id never seen assigned) and anything ambiguous is left alone rather than guessed. A failure to resolve by any route is logged behind the debug flag.
- **The UI option metadata offered a thinking budget three models reject.** `CLAUDE_CODE_OPTIONS`' `claude_thinking.modelOverrides` is a view of `ADAPTIVE_THINKING_ONLY`, but only `opus-4.8` and `opus-4.7` were ever added to it — so a UI rendering the field for `fable-5`, `sonnet-5`, or `opus-4.6` offered a fixed budget the model answers with a 400. All six members are now listed, and `src/models.test.ts` pins the two lists together so the next adaptive-only model cannot be added to one without the other.
- **`claude-code`: the hold cap's truncation `warning` could be swallowed by the shutdown it caused.** Bound expiry closes the input channel, which ends the SDK stream — and the loop could observe that `done` before returning to the point where off-loop warnings are drained, so the run finished silently on exactly the path whose whole purpose is to say that background work was abandoned. Warnings are now drained once more after the loop exits. Relatedly, the cap default moved from 120s to **90s**: it was equal to the default timeout `collectEvents()` applies, and that clock starts earlier (at the run's start, not at the held `result`), so the helper would reject the run before the cap could ever report anything.

<!-- anchor: v2m7p4kd -->
### Documentation
- **The model catalog's mirrors had fallen three releases behind.** `src/models.ts` is the mirror of M02 canon, but the human-facing copies of it were never propagated: README's alias table still advertised `o4-mini` / `o3` / `codex-mini` for `codex` — none of which have been in the catalog for several releases — and both README and TESTS.md omitted `sonnet-5` and the whole `gpt-5.x` and `gemini-3.1` families. Both tables are now generated from the catalog and match it entry for entry. TESTS.md also claimed `resolveModel()` "throws an `AdapterError`" for an unknown alias; it warns and passes through, which is the difference between a model newer than this catalog working and not.
- **`claude-code` `result.usage` is per-turn, not per-`query()` cumulative** — the code comment claiming otherwise was wrong, and made summing several results look like double-counting. Measured across four live runs on both pins, a run's second `result` reports *fewer* tokens than its first in nearly every field, which a running total cannot do. Several `result`s in one run is normal (a mid-turn push, or a background wake-up), the run's billing is their sum via `sumUsageFromEvents()`, and `contextSize` is the last one's. No behaviour change.

[0.9.1]: https://github.com/InHarness/agent-adapters/compare/v0.9.0...v0.9.1

<!-- anchor: pf03z7hn -->
## [0.9.0] — 2026-07-15

<!-- anchor: kw2t8r4m -->
### Added
- **Hard peer-SDK version gate at init.** Every adapter that wraps a peer SDK (`claude-code`, `codex`, `opencode`, `gemini`) plus `createMcpServer` now checks the *installed* peer-SDK version against a narrow, CI-verified semver range immediately after the existing lazy `import()`/`require()` succeeds — a subtly incompatible SDK release used to fail silently or in confusing ways downstream instead of failing clearly at init. On a **confirmed** mismatch, init emits (or, for `createMcpServer`, throws) a non-suppressible `AdapterInitError` naming the installed version and required range; there is no config bypass. Version comparison accepts in-range prerelease builds (`semver.satisfies(..., { includePrerelease: true })`), so a beta/rc/alpha SDK install isn't wrongly flagged. New `src/sdk-version.ts` resolves the installed version primarily by walking `node_modules/<pkg>/package.json` upward from its own location (several peer SDKs block the `./package.json` subpath in their `exports` map, and `import.meta.resolve()` is invalid syntax in this package's CJS build output, ruling out both as the primary mechanism), with a `require.resolve()`-based fallback for layouts the walk can't see (chiefly Yarn PnP, which has no physical `node_modules` tree). When neither mechanism can determine the installed version — despite the SDK having just loaded successfully — that's treated as a distinct **'undeterminable'** outcome, not a mismatch: adapters degrade to a one-shot `warning` event and proceed (`createMcpServer` proceeds silently, having no event stream to warn through) rather than hard-failing a working install. Each package's range is declared once, in `sdk-version.ts`'s `PEER_SDK_RANGES`, which `package.json`'s `peerDependencies` mirrors (guarded by a test asserting they match) — the range is no longer duplicated as a second literal string at every adapter call site. Version resolution is memoized per package, since the installed version can't change within a process's lifetime.

<!-- anchor: hm91xq6c -->
### Changed
- **`claude-code` path-scope now confines to `cwd ∪ allowedPaths`, not deny-only.** When `allowedPaths`/`disallowedPaths` are requested under the soft (non-OS-sandbox) gate, the adapter drops its default `permissionMode: 'bypassPermissions'` (which auto-approved every tool, so the deny rules never fired) for a default-deny `dontAsk` mode with explicit `permissions.allow` rules over `cwd ∪ allowedPaths` and `permissions.deny` rules for `disallowedPaths`, each covering `Read`/`Edit`/`Write`. A read (or write) of a path outside the ceiling is now blocked even when it is not named in `disallowedPaths`. Config discovery is also contained: `settingSources` is narrowed to exclude the global `~/.claude` tier so ambient global settings / on-disk skill discovery cannot re-widen reach (inline skills, delivered via `options.plugins`, are unaffected). Outside path-scope, behaviour is unchanged — consumers not using scope keep `bypassPermissions`. The opt-in hard OS-sandbox path (`claude_sandbox.enabled`) is unchanged.
- **BREAKING (minor):** `peerDependencies` narrowed to the ranges actually verified in CI. Most were tightening an over-wide `>=` floor with no ceiling; `@anthropic-ai/claude-agent-sdk` goes from `>=0.2.0` to `>=0.3.0 <0.4.0` — a consumer still pinned to `@anthropic-ai/claude-agent-sdk` 0.2.x now hits the new hard init gate above. Full table: `@anthropic-ai/claude-agent-sdk` `>=0.3.0 <0.4.0`, `@openai/codex-sdk` `>=0.120.0 <0.121.0`, `@opencode-ai/sdk` `>=1.4.0 <2.0.0`, `@google/gemini-cli-core` `>=0.38.0 <0.39.0`, `@modelcontextprotocol/sdk` `>=1.0.0 <2.0.0`.

<!-- anchor: dz5c9ktf -->
### Fixed
- **`claude-code` soft path-scope no longer leaks a `disallowedPaths` file's contents.** A live model could `Read` (or `Write` under) a disallowed path because the soft gate layered a bare deny-list on top of `bypassPermissions`, which ignored it; the deny also never covered `Write`. Both are closed by the allow-confinement change above.
- **`createMcpServer` now throws `AdapterInitError` instead of a raw `MODULE_NOT_FOUND` when `@modelcontextprotocol/sdk` is missing.** Previously the lazy `createRequire` load had no surrounding try/catch.

[0.9.0]: https://github.com/InHarness/agent-adapters/compare/v0.8.6...v0.9.0

<!-- anchor: q4wz1k7f -->
## [0.8.6] — 2026-07-14

<!-- anchor: t8n2r5xp -->
### Fixed
- **`claude-code` task-tracking (`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`) now merges into `todo_list_updated` with the real SDK field names.** Newer Claude models emit this per-item CRUD family (behind a `ToolSearch` discovery gate) instead of the single `TodoWrite` tool. The projection now merges any of these into the running snapshot (`TodoWrite` still replaces it wholesale) using the actual `sdk-tools.d.ts` schema — `TaskCreateInput`/`TaskUpdateInput` key on `subject`/`description` with no `id`, and `TaskUpdateInput`/`TaskGetInput` key on `taskId`, not the previously guessed `id`/`content` shape. `TaskCreate` entries are keyed by `toolUseId` since the server-assigned id only appears in the `tool_result`, which the adapter doesn't parse; bare `TaskGet`/`TaskList` calls (no writable field) now leave their `tool_use`/`tool_result` events visible instead of being silently discarded. The whole `Task*` family plus `ToolSearch` was also added to the plan-mode read-only allowlist so a plan-mode turn never silently falls back to prose-only planning on a newer model.

<!-- anchor: r8k2v5q1 -->
## [0.8.5] — 2026-06-30

<!-- anchor: 9m3p7w2d -->
### Added
- **Filesystem path scoping (`allowedPaths` / `disallowedPaths`).** New engine-neutral path-scoping fields on `RuntimeExecuteParams` let consumers confine an agent's filesystem reach; each adapter maps the intent onto its SDK's native sandbox primitive, or emits a one-shot `warning` and runs unscoped. Purely additive — both fields absent is a no-op. `claude-code` maps `allowedPaths` → `additionalDirectories` and `disallowedPaths` → `settings.permissions.deny` (Read/Edit), with opt-in `claude_sandbox.enabled` flipping to a hard OS sandbox (seatbelt/bubblewrap) and a hard→soft `warning` when the host lacks one; `codex` maps `allowedPaths` → `additionalDirectories` (allow-list-only OS sandbox) and surfaces `disallowedPaths` as unenforceable; `gemini` applies a soft gate via `Config.includeDirectories`; `opencode` warns and runs unscoped. The new `src/path-scope.ts` module adds `probePathScope()` — a runtime-confirmable gate-strength signal (`'hard'|'soft'|'none'`) distinct from the static capability bool and callable before dispatch. `architectureCapabilities().pathScope` reports per-architecture support (`claude-code*`/`codex`/`gemini` true, `opencode` false); the `adapter_ready` event now carries the resolved `pathScope`. Path-scope fields are frozen for a resumed session's lifetime.
- **Claude Sonnet 5 in the `claude-code` catalog.** Registered the `sonnet-5` → `claude-sonnet-5` alias, marked adaptive-only (1M context window, adaptive thinking only — no fixed budget), mirroring the M02 model catalog canon.

<!-- anchor: x6ljutom -->
## [0.8.4] — 2026-06-18

<!-- anchor: gbzg7mpg -->
### Added
- **Programmatically defined subagents** — new `SubagentDefinition` type and optional `RuntimeExecuteParams.subagents` field give consumers a first-class, cross-adapter way to *define* subagents the model can invoke via its native agent tool (previously the library could only *observe* subagents through `subagent_started` / `subagent_progress` / `subagent_completed` / `isSubagent`). `claude-code` maps `subagents` onto the SDK's `Options.agents` (the `Agent`/`Task` tool is already whitelisted, so defined agents are invocable; each subagent's `model` is passed through verbatim for the SDK to resolve). `codex`, `gemini`, and `opencode` ignore the field and emit a one-shot `warning` event. `architectureCapabilities().subagentDefinition` reports support (true for `claude-code` and its provider variants, false elsewhere), and a `validateSubagents()` fail-fast helper enforces unique names and non-empty fields. README capability matrix and example updated.
- **Image input on mid-turn pushes.** `RuntimeAdapter.pushMessage(text, images?)` now accepts the same `ImageInput[]` shape as the initial prompt (v0.8.3 added images on the initial prompt only). Wired through the streaming-input push path on `claude-code` (the only adapter with `midTurnPush`). `pushMessage` stays **synchronous** (returns `boolean`) to preserve the keep-open atomicity and message-ordering invariants — images are normalized synchronously via the new `buildClaudeImageBlocksSync` / `readImageAsBase64Sync` (file sources read with `readFileSync`; base64/url need no I/O), so the signature stays non-breaking. A bad media type or unreadable file throws synchronously, distinct from the `false` return that signals a closed channel. The pushed `user_message` event now carries the attached `images`.



<!-- anchor: 98fmhy4z -->
### Added
- **Unified image input on the initial prompt.** New optional `RuntimeExecuteParams.images` field lets consumers attach images to the initial prompt across all four adapters with one shape. `ImageInput` reuses the existing output image-source vocabulary (`{type:'base64'|'url'}`) plus an input-only `{type:'file'}` variant; each adapter delivers images in its SDK's native form — claude-code native base64/url content blocks (file read+inlined, one-shot routed through the streaming input channel), gemini media content part, codex local-path (base64/url written to an abort-safe temp file, removed in `finally`), opencode file part. New `src/images-tempdir.ts` holds the shared helpers (media-type inference, Anthropic media-type validation, base64 read, lazy abort-safe temp workspace). `architectureCapabilities` now reports `imageInput` per architecture. README documents the API.

[0.8.6]: https://github.com/InHarness/agent-adapters/compare/v0.8.5...v0.8.6

[0.8.5]: https://github.com/InHarness/agent-adapters/compare/v0.8.4...v0.8.5

[0.8.4]: https://github.com/InHarness/agent-adapters/compare/v0.8.3...v0.8.4

[0.8.3]: https://github.com/InHarness/agent-adapters/compare/v0.8.2...v0.8.3

<!-- anchor: jqwd3v9i -->
## [0.8.2] — 2026-06-17

<!-- anchor: j2aznb3m -->
### Fixed
- **claude-code no longer crashes with `open EEXIST` (fd 0) under Phusion Passenger / CloudLinux CageFS** and similar sandboxed hosts. There, fd 0 is already owned by the process manager, so when the SDK import makes Node lazily construct `process.stdin` (`new Socket` on fd 0), libuv returns `EEXIST` — surfacing as `AdapterInitError: open EEXIST` (`syscall:"open"`, **no** `path`) on every request, right after `adapter_ready`. Despite the message this is **not** a filesystem error. `execute()` now detects a throwing `process.stdin` and replaces it with a benign empty `Readable` before importing the SDK. The SDK never reads the parent's stdin (the child `claude` process gets its own pipes), so streaming input is unaffected, and the guard is a no-op when `process.stdin` is healthy. The repair helper is also exported as `ensureUsableStdin()` for hosts that touch stdin at boot (before `execute()`) and must guard at process entry. Covered by `src/stdin-guard.test.ts`.

[0.8.2]: https://github.com/InHarness/agent-adapters/compare/v0.8.1...v0.8.2

<!-- anchor: 4w26rekt -->
## [0.8.1] — 2026-06-16

<!-- anchor: 9po8umdi -->
### Added
- **Serialization-safe `AdapterError`.** `AdapterError` now hoists OS system-error fields (`code`, `errno`, `syscall`, `path`) off its `cause` onto the instance and exposes a `toJSON()` so the structured context survives `JSON.stringify` and worker/bridge boundaries — where `Error.message`/`.stack` (non-enumerable) and a degraded bare `{ errno, code, syscall }` cause would otherwise be dropped. `AdapterInitError` also appends actionable, code-specific hints (e.g. `EEXIST` stale temp/lock, `EACCES`/`EPERM` permissions, `EROFS` read-only FS, `ENOSPC`, `ENOENT`) to its message. Covered by new unit tests in `src/types.errors.test.ts`.

[0.8.1]: https://github.com/InHarness/agent-adapters/compare/v0.8.0...v0.8.1

<!-- anchor: a63pg2lp -->
## [0.8.0] — 2026-06-14

<!-- anchor: e4vxjikq -->
### Fixed
- **Optional peer SDKs are no longer required at module load.** Importing anything from the main entry (e.g. `registerAdapter`, `createAdapter`) no longer throws `Cannot find package '@anthropic-ai/claude-agent-sdk'` when an optional peer SDK is absent. The `claude-code`, `codex`, and `opencode` adapters now keep only `import type` at the top level and load their SDK values lazily via `await import()` inside `execute()` (matching the existing `gemini` adapter), and `createMcpServer` lazily `createRequire`s `@modelcontextprotocol/sdk`. A consumer that never touches a given adapter never loads its SDK. Covered by a regression guard (`no-eager-sdk.test.ts`) that asserts `dist/index.js` statically imports none of the five optional SDKs.

<!-- anchor: hc79jkzd -->
### Removed
- **BREAKING (minor):** `createSdkMcpServer` and `tool` are no longer re-exported from `@inharness-ai/agent-adapters/claude-code`. They were thin pass-throughs to `@anthropic-ai/claude-agent-sdk` and a source of the eager-load bug above. Import them directly from the SDK instead: `import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'`. The library's own `createMcpServer`/`mcpTool` builders are unchanged.

[0.8.0]: https://github.com/InHarness/agent-adapters/compare/v0.7.0...v0.8.0

<!-- anchor: ovv4u7q7 -->
## [0.7.0] — 2026-06-14

<!-- anchor: e98wcmu6 -->
### Added
- **Mid-turn message injection (streaming-input mode)** — opt into `RuntimeExecuteParams.streamingInput: true` to keep the session's input channel open and push follow-up user messages into a live turn via the new optional `RuntimeAdapter.pushMessage(text): boolean`. Accepted pushes surface as a new `user_message` UnifiedEvent (`{ text, timestamp }`), and `execute()` may now yield **multiple** `result` events (one per delivered turn). `pushMessage` returns `false` when the channel is closed/closing or the adapter isn't in streaming-input mode, so callers re-dispatch after-turn with `resumeSessionId` — no lost-message window.
- **Capability discovery** — new `architectureCapabilities(architecture)` (and `ArchitectureCapabilities` type) reporting `{ midTurnPush }`. Only `claude-code` (and its provider variants) supports mid-turn push today, riding `@anthropic-ai/claude-agent-sdk`'s streaming-input mode; `codex`, `gemini`, `opencode`, and unknown architectures report `false`.
- New example `examples/claude-code/streaming-input.ts` and a streaming-input E2E that resolves whether the SDK delivers a pushed message between tool calls or at the turn boundary (risk R1).

<!-- anchor: og69812z -->
### Fixed
- **Subagents available to the claude-code adapter in plan mode** — `Task` was in `CLAUDE_CODE_MUTATING_BUILTINS`, so it landed in `disallowedTools` and was dropped from the plan-mode tools whitelist, blocking legitimate read-only subagent use (research, exploration) with "no access to Task". `Task` and `Agent` now live in `CLAUDE_CODE_READONLY_BUILTINS` (both names are needed: `Task`→`Agent` was renamed in Claude Code v2.1.63, but the `system:init` tools list still uses `Task`), leaving only the genuinely mutating built-ins (`Bash`, `Edit`, `Write`, `NotebookEdit`) gated. As in native Claude Code plan mode, read-only is **not** enforced inside a spawned subagent — a subagent does not inherit the parent's `disallowedTools`.

All additions are optional and backward compatible — with `streamingInput` off, `execute()` behaves exactly as before (one prompt, one `result`).

[0.7.0]: https://github.com/InHarness/agent-adapters/compare/v0.6.4...v0.7.0

<!-- anchor: tx9u5riz -->
## [0.6.4] — 2026-06-09

<!-- anchor: fch8ht0s -->
### Added
- **Fable 5 model support** — registered `fable-5` (id `claude-fable-5`) in `models.ts` with its context window and adaptive-thinking-only constraint, added a Fable 5 E2E test command in `package.json`, and documented the model alias and its adaptive-only behavior across README, TESTS, and the `claude-code-sdk` skill.

[0.6.4]: https://github.com/InHarness/agent-adapters/compare/v0.6.3...v0.6.4

<!-- anchor: 4tj99zs8 -->
## [0.6.3] — 2026-06-03

<!-- anchor: k5y59hvq -->
### Fixed
- **`Skill` built-in now available to the claude-code adapter in plan mode** — in plan mode the adapter restricts the model's built-in catalog to a read-only whitelist, which omitted `Skill`. As a result, inline skills (materialized as a local plugin) could never be opened during a plan-mode run — the SDK reported `No such tool available: Skill`. `Skill` is read-only (it only loads a skill's body into context); mutating actions remain gated by `disallowedTools`. Outside plan mode the full catalog was already available, so this only affected `planMode: true` calls that inject skills.

[0.6.3]: https://github.com/InHarness/agent-adapters/compare/v0.6.2...v0.6.3

<!-- anchor: m04gf29t -->
## [0.6.2] — 2026-05-29

<!-- anchor: c7cval95 -->
### Added
- **Session-resume constraint helpers** — new `getSessionResumeConstraints()` and `findResumeViolations()` exported from the public API, along with `ResumeFieldConstraint` and `ResumeConfigSnapshot` types. They report which option fields (e.g. `thinking`, reasoning effort) must stay constant across the turns of a resumed session and detect, before a turn runs, when a resumed call would change a locked field. Adapters stay stateless; callers use these to lock fields in their UI and pre-empt provider rejections.
- **`resumeImmutable` / `resumeImmutableReason` option metadata** — per-option flags describing fields that are fixed for the lifetime of a resumed session/thread, each carrying a human-readable reason for surfacing in UI and logs.

<!-- anchor: le7si8ol -->
### Changed
- **Session-resume documentation** — `resumeSessionId` JSDoc, README, and the `unified-architecture` / `claude-code-sdk` skills expanded to explain resume constraints and per-adapter behavior (claude-code rejects mismatched thinking config on resume; Codex reuses the thread's original reasoning effort).

[0.6.2]: https://github.com/InHarness/agent-adapters/compare/v0.6.1...v0.6.2

<!-- anchor: w45chded -->
## [0.6.1] — 2026-05-28

<!-- anchor: nieg8qxi -->
### Changed
- **Opus 4.8 context window corrected to 1,000,000 tokens** — `MODEL_CONTEXT_WINDOWS` entries for `opus-4.8` and `claude-opus-4.8` raised from 200,000 to 1,000,000, so `getModelContextWindow()` / `contextSize()` report the model's full 1M window.

[0.6.1]: https://github.com/InHarness/agent-adapters/compare/v0.6.0...v0.6.1

<!-- anchor: hf6j6aab -->
## [0.6.0] — 2026-05-28

<!-- anchor: b5pyf98b -->
### Added
- **Opus 4.8 model support** — new `opus-4.8` alias in `MODEL_ALIASES` with its context-window entry, plus `CLAUDE_CODE_OPTIONS` wiring for adaptive thinking and reasoning-effort levels on Opus 4.8. README and TESTS.md updated to use Opus 4.8 in the Claude Code adapter and its tests.

<!-- anchor: sr7txo83 -->
### Changed
- **Adaptive thinking handling** in the Claude Code adapter refined to stay compatible with Opus 4.6+ models; SKILL.md documents the updated adaptive-thinking requirements and Opus 4.6/4.7 troubleshooting, and the `thinking.ts` example demonstrates adaptive thinking with effort control.
- **`@anthropic-ai/claude-agent-sdk` bumped to 0.3.153** in `package.json` / `package-lock.json`.

[0.6.0]: https://github.com/InHarness/agent-adapters/compare/v0.5.0...v0.6.0

<!-- anchor: lblm35te -->
## [0.5.0] — 2026-05-27

<!-- anchor: fartowvs -->
### Added
- **Disk skill discovery** — new `listDiskSkills()` and `getSkillSearchDirs()` exported from the public API. They enumerate the SKILL.md skills each architecture auto-loads from disk (e.g. `~/.claude/skills`, project `.claude/skills`), parsing frontmatter metadata and reporting each skill's search location, scope, and on-disk layout. New `DiskSkill`, `ListDiskSkillsOptions`, `SkillSearchLocation`, `SkillScope`, and `SkillLayout` types accompany the helpers. README documents the feature with examples.

<!-- anchor: wvre06hh -->
## [0.4.0] — 2026-05-13

<!-- anchor: s6catney -->
### Added
- **Context-window tracking** — every `result` event now carries `contextSize` (total tokens occupying the model's context window after the turn). New `contextSize()` helper exported from the public API for callers who only kept `UsageStats`. Pair with `MODEL_CONTEXT_WINDOWS` / `getModelContextWindow()` to render an IDE-style "X / 400k" utilization bar.
- **`subtractUsage` helper** exported from the public API. Subtracts two `UsageStats` field-by-field (flooring at zero, cache fields preserved symmetrically with `addUsage`). Used internally by the Codex adapter to derive per-call delta from session-cumulative SDK usage, and available for any consumer with the same need.
- **`priorUsage` on `RuntimeExecuteParams`** — cross-process escape hatch for Codex. Passing the previous turn's raw cumulative usage on a resumed call keeps `result.usage` accurate when the adapter's in-memory LRU starts empty after a process restart. Ignored by claude-code, gemini, opencode.
- **`maxTurns` JSDoc** documenting the per-adapter semantics: claude-code counts cumulatively across the resumed session (low values error on resume), gemini maps to `maxSessionTurns`, codex and opencode ignore it.

<!-- anchor: ejpbnak3 -->
### Changed
- **`UsageStats` field semantics clarified** — `cacheReadInputTokens` and `cacheCreationInputTokens` are now documented as *subsets* of `inputTokens` (overlap, not additive), uniform across all adapters. Claude-code's normalization rolls Anthropic's three additive buckets into a single `inputTokens` so the contract holds.
- **`result.usage` JSDoc** distinguishes USAGE BILLING TOKENS (per-call billing cost, sums across calls can exceed the context window) from USAGE CONTEXT WINDOW (`result.contextSize`, bounded by the model's window).

<!-- anchor: d5ut2mpq -->
### Fixed
- **Codex cumulative-as-delta usage** — the underlying `@openai/codex-sdk` reports session-cumulative usage in `turn.completed.usage` (openai/codex#17539); the adapter now subtracts the prior cumulative (tracked in a module-scoped LRU) so `result.usage` is a true per-`execute()` delta, matching the other three adapters.

<!-- anchor: upcjvqma -->
## [0.3.1] — 2026-05-09

<!-- anchor: pgahr73u -->
### Added
- **Cumulative-usage helpers** (`addUsage`, `sumUsage`, `sumUsageFromEvents`) exported from the public API, so consumers can aggregate `UsageStats` across multiple `execute()` calls. Documented that `result.usage` is the per-call delta on every adapter; an `assertResumeUsageIndependence` e2e helper verifies this on all four adapters.
- **Codex local ChatGPT OAuth** — adapter now falls back to `~/.codex/auth.json` (after `codex login`) when `OPENAI_API_KEY` is not set, mirroring the claude-code subscription pattern.
- **Codex thread resumption** — adapter captures `thread_id` from `thread.started` events and propagates it as `sessionId` so resumed sessions reattach to the same thread.
- **New Codex model aliases** — `gpt-5.4`, `gpt-5.4-codex`, `gpt-5.4-mini`, and `gpt-5.5` variants.

<!-- anchor: cg2wovny -->
### Changed
- **Codex error handling** — extracts and de-duplicates human-readable messages from JSON-stringified API responses; suppresses duplicates when a turn-failure event is also emitted.
- **Codex e2e gating** — suite no longer skips on missing `OPENAI_API_KEY` (skips only on explicit `SKIP_CODEX_E2E`), so OAuth-only setups run the full test matrix.

<!-- anchor: u7yhn31e -->
## [0.3.0] — 2026-04-28

<!-- anchor: lml5fhmt -->
### Added
- **User message handling in the OpenCode adapter** — assistant text deltas now filter out the `PROMPT_ECHO` prefix so user input doesn't leak back as model output. The adapter tracks message roles to scope this filter to user messages only, with a new SSE fixture scenario and unit + E2E coverage.

<!-- anchor: n6qv5hqs -->
### Changed
- README no longer shows `new ClaudeCodeAdapter()` and SDK-native MCP helpers as a parallel path to the unified API — keeping docs aligned with the package's one-interface-across-adapters pitch.

<!-- anchor: ehpa2h2k -->
## [0.2.2] — 2026-04-28

<!-- anchor: c1usmbzl -->
### Added
- **Session resumption across all adapters** (`claude-code`, `codex`, `opencode`, `gemini`) via a unified `sessionId` / resume contract, plus expanded test coverage.
- **Unified inline skills** parameter (`InlineSkill`) wired through every adapter, including multi-file inline skills via `InlineSkill.files`. Documented in the README inline-skills section.
- **`adapter_ready` event** — startup snapshot of SDK-native config (secrets redacted) emitted once before the first message.
- **`createConsoleObserver` factory** with SDK-config filtering options for opt-in verbosity.
- **Try it** section in README pointing to `@inharness-ai/agent-chat` for an interactive multi-adapter demo (`npx @inharness-ai/agent-chat basic`).

<!-- anchor: 8nncxanh -->
### Changed
- Unified pre-SDK error handling across adapters — config / availability / resolution failures now surface as a typed `AdapterError` before any SDK call.
- Refactored model resolution so unknown aliases throw consistently with the list of valid aliases for that architecture.

<!-- anchor: f8j14eig -->
### Removed
- `allowedTools` field on `InlineSkill` (pre-public, dropped in same release window as inline-skill landing).

<!-- anchor: tyviq8nf -->
## [0.2.1] — 2026-04-22

<!-- anchor: lufdlm9a -->
### Added
- **Unified `todo_list_updated` event** across `claude-code` and `opencode` adapters, replacing paired `tool_use` / `tool_result` emissions for TodoWrite operations. Introduces a new `TodoItem` type and `result.todoListSnapshot` reflecting the last-known state of the agent's todo list.
- **Per-message usage data** on Claude Code assistant normalization. `normalizeAssistantMessage` now exposes a `usage` field so consumers can inspect per-response cache behavior (cache read/creation tokens) without aggregating the session total.
- **Plan mode permission model** for the Claude Code adapter. Consumer-curated MCP tools remain executable while built-in mutating tools are hidden via `tools` + `disallowedTools`.
- E2E coverage for plan mode and for the unified todo-list event across adapters.

<!-- anchor: hk9q8dtl -->
### Changed
- `RuntimeExecuteParams.planMode` typing clarified; adapter-specific mapping documented in `src/types.ts`.

<!-- anchor: 1ke5na3b -->
### Removed
- Legacy `pages/unified-architecture/SKILL.md` duplicate (documentation consolidated under `.claude/skills/`).

<!-- anchor: no135fmi -->
## [0.2.0] — 2026-04

Initial public release on npm under the `@inharness-ai` scope. Baseline feature set: Claude Code, Codex, OpenCode, and Gemini adapters; MCP server integration; E2E testing framework.

[0.5.0]: https://github.com/InHarness/agent-adapters/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/InHarness/agent-adapters/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/InHarness/agent-adapters/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/InHarness/agent-adapters/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/InHarness/agent-adapters/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/InHarness/agent-adapters/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/InHarness/agent-adapters/releases/tag/v0.2.0
