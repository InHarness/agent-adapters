<!-- anchor: dx1xxey2 -->
# A01 — claude-code

> The reference adapter. Its SDK maps almost one-to-one onto the unified contract, and it is the only adapter that can both *define* subagents and *push* a message mid-turn — so it is the yardstick every other adapter degrades against.

<!-- anchor: 4o8v4n21 -->
## Purpose & SDK identity

Wraps `@anthropic-ai/claude-agent-sdk` (optional peer dependency — imported lazily inside `execute()` so loading the package never hard-requires the SDK). It is the closest mapping to `UnifiedEvent` and the implementation other adapters are measured against. Architecture id `claude-code`, with provider variants `claude-code-ollama` and `claude-code-minimax` (see M03).

<!-- anchor: mn3ytsj4 -->
## Event mapping (L1)

How each SDK message becomes a `UnifiedEvent`:

| SDK message | UnifiedEvent |
| --- | --- |
| `stream_event` → `content_block_delta` → `text_delta` | `text_delta` |
| `stream_event` → `content_block_delta` → `thinking_delta` | `thinking` |
| `assistant` | `assistant_message` (+ `tool_use`, `todo_list_updated`) |
| `user` (tool_result blocks) | `tool_result` |
| `tool_use_summary` | `tool_result` |
| `system` `task_started` / `task_progress` / `task_notification`, `task_type` = subagent | `subagent_started` / `subagent_progress` / `subagent_completed` |
| `system` `task_started` / `task_progress` / `task_notification`, `task_type` ∈ `'shell'` / `'monitor'` / `'workflow'` | `background_task_started` / `background_task_progress` / `background_task_completed` (M17) |
| `system` `compact_boundary` | `flush` |
| `result` (`subtype: success`) | `result` |
| `result` (non-success) | `error` (runtime phase) |
| `AskUserQuestion` via `canUseTool` / `onElicitation` | `user_input_request` (+ legacy `elicitation_request`) |
| accepted `pushMessage` | `user_message` |

The SDK multiplexes real subagents **and** backgrounded side work onto one `task_*` channel; `SDKTaskStartedMessage.task_type?` (plus `subagent_type?` / `workflow_name?`) is the discriminator. Because `task_progress` / `task_notification` carry only `task_id` / `status` / `output_file` / `summary` / `usage` (no `task_type`), the adapter must capture `task_type` on `task_started` into a `Map<task_id, task_type>` and route every later message for that `task_id` through it — subagent kinds to `subagent_*` (M06), `'shell'` / `'monitor'` / `'workflow'` to `background_task_*` (M17). Unknown / absent `task_type` defaults to the subagent path (legacy behavior). `subagentTaskId` is resolved through a `parent_tool_use_id` → `task_id` map populated on `task_started`. Task-tracking `tool_use` blocks project to `todo_list_updated` (source `model-tool`) with their echoed `tool_result` suppressed as redundant; the `TodoWrite` ↔ `TaskCreate/…` matrix, the `ToolSearch` gate, snapshot accumulation, and the rename-durable projection semantics are owned by M16 (see <section_ref anchor="3dln3isl"/>).

The harness **scheduling** family (`ScheduleWakeup`, `CronCreate` / `CronList` / `CronDelete`, and the `/loop` slash command) has **no row above**: these tools are hard-suppressed before they can reach the stream, so they never map onto any `UnifiedEvent` (see <section_ref anchor="sw3cwrsm"/>). `Monitor` is *not* in this family — it works headless (it streams a background process) and stays an ordinary `tool_use` → `assistant_message`.

<!-- anchor: c4qvzzks -->
## Capability support & degradation (L2)

This adapter is the positive column in every capability matrix — those matrices live in the capability-modules (one-home rule), not here:

- MCP transports → M04 owns the matrix; claude-code accepts all four (stdio, SSE, HTTP, in-process SDK).
- Subagent definition → M06; claude-code is the only adapter where `subagentDefinition` is true.
- Mid-turn push → M11; claude-code is the only adapter where `midTurnPush` is true.
- Images → M10; accepts base64 + url, materializing `file` sources to inline base64.
- Path-scope → M15 owns the matrix; claude-code is the only adapter with a fine-grained, **deny-expressible** gate and is **hard-capable** (OS sandbox) — soft by default, hard on opt-in.
- Background tasks → M17 owns the matrix; claude-code is today the only adapter with engine-backgrounded shell work (`run_in_background`) and SDK-native session-hold on in-flight tasks.

`architectureCapabilities('claude-code')` returns `{ midTurnPush: true, imageInput: true, subagentDefinition: true, pathScope: true }`.

<!-- anchor: sw3cwrsm -->
## Per-capability consumption

- **Models** (<section_ref anchor="9gu9zp7z"/>) — `resolveModel('claude-code', …)`; honors `claude_thinking` (auto-converts `enabled` → `adaptive` for `ADAPTIVE_THINKING_ONLY` models) and restores the `summarized` thinking display for Opus 4.7.
- **MCP (M04)** — passes the unified `mcpServers` config straight through; in-process `sdk` servers are handed over by instance.
- **Skills (M05)** — materializes `InlineSkill`s into a per-call tmpdir registered as a `local` plugin; the `Skill` tool is whitelisted even in plan mode.
- **Subagents (M06)** — maps `subagents` to `Options.agents`; both defines and observes lifecycle.
- **Images (M10)** — builds Anthropic image blocks; a `file` image is read and inlined as base64.
- **Mid-turn (M11)** — runs a real streaming-input channel (`AsyncIterable<SDKUserMessage>`); `pushMessage` enqueues and the channel stays open across turns while messages are pending. The channel backs **every** run, `streamingInput` or not (reason in the M17 bullet below); only `pushMessage` is gated on the flag.
- **Abort / timeout (M13)** — `abort()` must break the loop wherever it can park, including an `await` on the consumer's `onUserInput` handler, which a UI-backed consumer may never resolve; the outstanding request is answered `cancel` and the SDK subprocess is torn down (`Query.interrupt()`, available on every run now that the channel path is universal).
- **Resume (M07)** — sets `options.resume`; usage reported by `result` covers this `query()` only, **not** the resumed session's history.
- **Path-scope (M15)** — realizes M15's **allow-confinement** contract, not a bare deny-list.
  - *Soft default.* When path-scope is requested the run switches **off** the adapter's usual `permissionMode: 'bypassPermissions'` (under which everything not explicitly denied is auto-approved — allow-confinement is impossible) and onto a **default-deny** mode (`permissionMode: 'default'`/`'dontAsk'`) with `permissions.allow` rules for `cwd ∪ allowedPaths` and `permissions.deny: ['Read(…)','Edit(…)']` rules for `disallowedPaths`. This confines reads/writes to the ceiling (model-visible). Outside path-scope the adapter keeps today's `bypassPermissions`, so consumers not using scope see no regression.
  - *Hard gate (opt-in).* Enabling `claude_sandbox.enabled` enforces at the OS syscall level (bubblewrap/seatbelt): `sandbox.filesystem` `allowWrite`/`denyWrite`/`denyRead` for write confinement, plus **managed allow-read confinement** (`allowManagedReadPathsOnly` + `allowRead` for `cwd ∪ allowedPaths`) for reads — because the SDK's default read model is deny-based, merely allowing the scope would not exclude the rest. When the OS sandbox is requested but unavailable on the host, the gate degrades hard→soft with a `warning`; a security consumer reads the runtime strength signal before dispatch (the static capability only says *hard-capable*).
  - *Config-discovery containment.* When path-scope (or the sandbox) is requested the adapter narrows `options.settingSources` to exclude the global user tier (`~/.claude`), disabling ambient global settings and disk-skill discovery that could otherwise re-widen the agent's reach outside scope. Inline skills are delivered via `options.plugins` (see M05), so this narrowing does **not** disable inline-skill materialization.
- **Usage (M08)** — rolls Anthropic's three input buckets (`input` + `cache_read` + `cache_creation`) into a single `inputTokens`; `contextSize` = input + output. Each `result` reports **that turn's own cost**, so no delta subtraction is needed (unlike codex): measured across both pins, a run's second `result` routinely reports fewer tokens than its first in every field, which a running total cannot do. A run that emits several `result`s — a mid-turn push (M11) or a background-work wake-up (M17) — is billed as their sum.
- **plan mode** — hides mutating built-ins via `tools` / `disallowedTools` rather than the SDK's `permissionMode: 'plan'`, so consumer-curated MCP tools still execute. **Durability requirement:** the read-only allowlist must track *every current alias* of a renamed or relocated built-in across SDK versions — the same discipline already applied to `Task` → `Agent` — and must keep the task-tracking family plus the `ToolSearch` discovery gate available (the family, its `TodoWrite` ↔ `TaskCreate/…` drift, and projection semantics are owned by M16 — see <section_ref anchor="3dln3isl"/>), so a plan-mode turn on a newer model always retains a usable task-tracking tool and never silently degrades to prose-only planning. Stated as an invariant on behavior, not on a frozen tool list.
- **Background tasks (M17)** — the Bash tool's `run_in_background` parameter backgrounds the shell process (never the agent). Mechanics the adapter realizes:
  - *`task_type` capture & routing.* Read `task_type` (+ `subagent_type?` / `workflow_name?`) on `task_started`, keep the `Map<task_id, task_type>`, and route `task_progress` / `task_notification` (fields: `task_id`, `status`, `output_file`, `summary?`, `usage?`) to `background_task_*` vs `subagent_*` accordingly (see the mapping table above). Absent or unrecognized `task_type` keeps the subagent path, so an SDK that stops sending the discriminator degrades to the pre-M17 shape rather than misrouting.
  - *In-flight tracking is adapter-side.* `SDKResultMessage` carries no in-flight list (the SDK exposes `background_tasks[]` on `StopHookInput` / `SubagentStopHookInput`, not on `result`), so the adapter maintains the set itself. **Both** kinds are tracked, because both can outlive the turn's `result` — a late-settling subagent is the shape the original bug report showed. Two signals move a task through the set: `task_updated` carrying a terminal `patch.status` marks it *finished* — which is what distinguishes "still working" from "done, wake-up pending", and so which hold bound applies — and `task_notification` removes it and emits the completion event. Measured on 0.3.153 and 0.3.210: `task_updated` precedes its `task_notification` by milliseconds, and both fire for subagents as well as for backgrounded shell work.
  - *Holding is not reporting.* The tracked set drives the **hold** for both kinds — a subagent holds the session exactly as a backgrounded command does — but it populates M01's `result.backgroundTasks` for **background kinds only**. Listing a subagent there would promise a `background_task_completed` that never arrives, and M17/M01 define the field as never-a-subagent. An engine-supplied list — `StopHookInput.background_tasks` today, a `result.background_tasks` field should a future SDK add one — is unioned with the tracked set, never substituted for it, and every entry is classified through the same `task_type` mapping first: `BackgroundTaskSummary.type` is a **display label**, and on 0.3.210 it is literally `'subagent'` for helper agents, so passing it through unclassified both leaks subagents into the signal and mislabels `local_bash`.
  - *`task_type` spellings are observed, not assumed.* Live against 0.3.153 a `run_in_background` Bash command reports `task_type: 'local_bash'` — not `'shell'`; the SDK prefixes locally-executed kinds with `local_` (`local_workflow` appears alongside `workflow_name`). The adapter strips that prefix before mapping. The type declarations say only `task_type?: string`, so any table of kinds must be checked against a live probe, never inferred from the types.
  - *Push resume — the run ends at iterator `done`, and the **input channel** must outlive `result`.* The SDK holds the `query()` open while background work is in flight: the turn's `result` arrives, the session pauses, and on `task_notification` the SDK wakes the model, which continues to a further `result`. Ending the adapter's consume loop only on `done` is necessary but **not sufficient** — the CLI is spawned with `--permission-prompt-tool stdio`, so its permission/control protocol shares the prompt channel (stdin). Closing that channel at `result` leaves the loop running over a session whose control transport is dead: the woken model's `AskUserQuestion` is denied inside the CLI within milliseconds, with no host round-trip and no error on the stream. The adapter therefore keeps the channel open while its tracked set is non-empty (M17's control-channel hold), and closes on the continuation `result` once the set has drained.
  - *One-shot runs use the channel too.* A plain string prompt makes the SDK mark the query single-turn and call `transport.endInput()` on the first `result` — the same stdin close, done by the SDK where the adapter cannot intervene. So **every** run is driven through the seeded input channel; `streamingInput` continues to gate `pushMessage()` only (M11 — <section_ref anchor="fr2hhuye"/>). This also restores the streaming-only control surface (`Query.interrupt()`) on ordinary runs. Empirically the string-prompt path additionally loses the post-`result` wake-up outright on some peer-range SDK versions, which the channel path does not.
  - *Whether to hold: the `Stop` hook answers half the question.* `StopHookInput.background_tasks` is documented as letting hooks "distinguish 'session is done' from 'session is paused waiting for background work to wake it'", and the adapter registers a `Stop` hook (additively, alongside the disable-lever `PreToolUse` hook and project hooks from `settingSources`) to read it. **Measured, both pins:** it fires ~3ms *before* the `result` it belongs to, and its positive answer is exact. Its *empty* answer is not — on 0.3.153 the three-subagent shape reported `[]`, after which the engine held the session, woke the model 2ms later, and ran a further full turn; 0.3.210 does list subagents there (`type: 'subagent'`), so the gap is version-dependent across the supported range. It is therefore consumed as a **positive hold reason only**, unioned with the adapter's own tracking, and never as permission to close.
  - *The hold is bounded, and neither bound may fire while the model is producing.* A **grace window** armed only once everything tracked has settled and re-armed by every frame that arrives while parked (so it measures engine silence — the engine really does emit `system/status` and `system/background_tasks_changed` frames while it babysits work, and the previous version let any one of them disarm the grace outright); and an absolute **cap** on the parked stretch, released the instant a continuation turn's first main-model frame arrives, because from there the run is an ordinary live turn bounded by `timeoutMs` / `abort()` (M13). Subagent chatter (`parent_tool_use_id` set) is not a resumption and does not release it. Only cap expiry emits a `warning`; grace expiry is silent (M17 — <section_ref anchor="q9u5sbot"/>).
  - *Grace sizing is an empirical result, not a preference.* What it must cover is the gap between the last task settling and the first frame of the continuation turn. Measured with `includePartialMessages` (which the adapter always sets): **3.5s** (backgrounded bash) and **3.7s** (three subagents) on 0.3.210; **5.0s** on 0.3.153 without partials. A 5s window therefore had no margin at all, and expiry mid-wake-up closes the control transport — the defect this whole section exists to prevent. The constant is set well above the worst observed (**15s**, ~4× the worst) and re-measured whenever the peer range moves.
  - *Both bounds are levers, and the cap has a ceiling it must respect.* `architectureConfig.claude_backgroundGraceMs` / `claude_backgroundHoldCapMs` (L3 keys, contract in M17) let a consumer trade the tail against the risk of cutting a wake-up short — the grace is dead time paid at the end of **every** run that started any task, including one whose subagents all finished in-turn, and only a consumer knows its own wall-clock budget. A non-numeric or non-positive value degrades to the default rather than disarming the bound. The cap default is **90s**, deliberately under the 120s default of the library's own `collectEvents()` helper: that clock starts earlier (at the run's start, not at the held `result`), so an equal cap could never emit its truncation `warning`.
  - *Disable recipe.* There is no SDK option to forbid backgrounding; the lever is a synthesized `PreToolUse` deny-hook that rejects any Bash call with `run_in_background: true` (forcing synchronous execution). Proposed config surface: `architectureConfig.claude_disallowBackgroundBash: true` (L3 key, default off) — contract in M17.
  - *Known gaps (unused SDK controls).* `Query.stopTask()`, `Query.backgroundTasks()`, and the `is_backgrounded` flag are not consumed — per-task stop and mid-run enumeration are unrealized; `abort()` remains the coarse stop (M13). (`StopHookInput.background_tasks` *is* consumed — see the hold bullets above.)
- **Scheduling (harness) — hard-suppressed** — the harness scheduling subsystem (`ScheduleWakeup`, `CronCreate` / `CronList` / `CronDelete`, `/loop`) is a construct of the *interactive* Claude Code harness, not a primitive of `@anthropic-ai/claude-agent-sdk`. Under the headless drive this library uses, a scheduled wake-up never fires: the model calls the tool, the turn ends, and the requested work is **silently lost** with no error. The adapter therefore hard-suppresses the whole family — always, with no config gate. Mechanism (behavior, not code): set `CLAUDE_CODE_DISABLE_CRON=1` via `custom_env` (kills the scheduler, `/loop`, and the cron tools) and/or append the tool names to `disallowedTools` — the same wiring already used to hide mutating built-ins in plan mode. `Monitor` is deliberately **excluded** from this suppression: it works headless.

<!-- anchor: 47rpb8n4 -->
## Auth model (L6)

The SDK manages credentials internally — local OAuth / cached subscription credentials or `ANTHROPIC_API_KEY`; **no API key is required** for the subscription OAuth path. Provider variants inject `ANTHROPIC_BASE_URL` (and provider env) through `custom_env` (see M03). Failure mode: an init-phase fault — model resolution, SDK import, skill materialization, or image build — is emitted as an `error` event with `phase: 'init'` (`AdapterInitError`), never thrown.

<!-- anchor: 49zu34oc -->
## SDK compatibility & schema drift (L7)

- **Supported peer-SDK range** — `@anthropic-ai/claude-agent-sdk` `>=0.3.0 <0.4.0` (the 0.3 line verified in CI; dev-pinned `^0.3.153`). The exact bound is a semver decision in the release brief (M12): narrowing today's over-wide `>=0.2.0` peer entry is breaking for consumers pinned to 0.2.x, so it ships as a deliberate major/minor call, not silently.
- **Version gate (HARD)** — at init the adapter reads the installed SDK version and `satisfies` it against the range; a mismatch **emits** `error` `phase:'init'` (`AdapterInitError`, "installed X, requires Y"), non-suppressible, no config gate.
- **Version-acquisition mechanism** — resolve the installed `@anthropic-ai/claude-agent-sdk` `package.json` `version` (e.g. `createRequire` / `require.resolve` to the package manifest); fall back to the nearest resolvable manifest if the `exports` map hides `package.json`. <todo comment="Confirm claude-agent-sdk package.json is reachable (not blocked by its exports map) before implementing the gate"/>
- **Availability probe** — the lazy `import('@anthropic-ai/claude-agent-sdk')` inside `execute()` already surfaces absence as `AdapterInitError`; the version gate runs immediately after a successful import.
- **Known schema-drift points** — the task-tracking tool cutover is the reference case: `TodoWrite` (full-list replace, removed ~0.2.82) → the per-item `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` CRUD family, fronted by a `ToolSearch` discovery gate on newer models. Because the declared range starts at 0.3.0, `TodoWrite` is **out-of-declared-range** and retained only as a defensive read. Matrix + projection: M16 (see <section_ref anchor="3dln3isl"/>).
- **Defensive-read / in-range degradation** — the projection reads task-tracking input from `Record<string,unknown>` on a dual path across the legacy and CRUD field names (`subject` / `description` / `taskId`), so a field rename inside the range never yields a silent empty todo (see M16). The CRUD family also needs the create's **`tool_result`**, the only place the engine reports the id it assigned (`"Task #1 created successfully: …"`); without aliasing it to the created item, a later `TaskUpdate({ taskId })` appends a blank-titled second item instead of changing the first one's status.
- **MCP form elicitation is refused by the engine's client** — an in-process SDK-MCP server calling `elicitInput({ message, requestedSchema })` gets `Client does not support form elicitation` from the MCP layer on 0.3.153, so `onElicitation` / `user_input_request { source: 'mcp-elicitation' }` never fires no matter how the adapter is wired (contract + consequences in M04, <section_ref anchor="wxyessab"/>). The adapter's bridge stays in place for the day the client advertises it; the live e2e for it self-skips with the refusal message rather than pretending to pass.

<!-- anchor: a01e2ecv -->
## e2e coverage (L5)

claude-code's per-adapter real-model coverage — which scenarios from the M12 catalog (see <section_ref anchor="xe2ecat1"/>) its `claude-code.e2e.test.ts` suite exercises. This is the **coverage home** for this adapter (one-home for coverage; the capability nuance for each scenario lives in the owning module beside its matrix). Verified against the dev-pinned SDK `^0.3.153` (the L7 *verified range*, see <section_ref anchor="49zu34oc"/>), parametrized over the M02 model catalog via `E2E_CLAUDE_MODEL` / the `test:e2e:claude:*` scripts.

| Scenario | Owning module | Status |
| --- | --- | --- |
| `simple-text` (alias + full id) | M01 / M02 | ✅ covered |
| `thinking` | M01 | ✅ covered |
| `tool-use` (in-process MCP) | M04 | ✅ covered |
| `subagents` (+ consumer-defined subagent) | M06 | ✅ covered |
| `plan-mode` (blocks writes / allows reads / keeps MCP executable) | M15 | ✅ covered |
| `todo` (TodoWrite → `todo_list_updated`) | M16 | ✅ covered |
| `user-input` (AskUserQuestion + decline path) | M01 | ✅ covered |
| `resume` (turn-2 recall + per-call usage) | M07 | ✅ covered |
| `abort` | M13 | ✅ covered |
| `unknown-model` (warn + passthrough) | M02 | ✅ covered |
| `image` (base64 / url / file → described) | M10 | ◻ planned |
| `mid-turn` (real `pushMessage` round-trip → `user_message`) | M11 | ◻ planned |
| `path-scope` (allow-confinement `allowedPaths` / `disallowedPaths`) | M15 | ◻ planned |
| `usage` (billing vs `contextSize`, cache buckets) | M08 | ◻ planned |
| MCP elicitation (`elicitation_request` / `onElicitation`) | M04 | ◻ planned |
| model matrix (core scenarios × M02 catalog) | M02 | ◻ planned |
| error/resilience (`timeoutMs`, out-of-range SDK → `AdapterInitError`) | M13 | ◻ planned |

Per-scenario acceptance detail is authored as AC entities: claude-code-specific ones under `a01` / `a01-edge` (below), shared-capability ones under the owning module's `mNN` tag with `verifies` pointing at the capability.

<!-- anchor: 677rc2wh -->
## Edge cases

- `timeoutMs` exceeded → `AdapterTimeoutError`; `abort()` → `AdapterAbortError`; both runtime-phase, and the input channel is closed.
- Under cPanel/Passenger or CageFS, `ensureUsableStdin()` replaces a throwing `process.stdin` **before** the SDK is imported (see M13).
- plan mode hides mutating built-ins from the parent, but a spawned subagent does not inherit `disallowedTools` — matching native Claude Code behavior.
- streaming-input run → may emit multiple `result` events; a `pushMessage` arriving after the channel closes returns `false`.
- path-scope with the OS sandbox enabled → a Bash subprocess writing outside scope is blocked at the syscall level (no `command` parsing); under the soft default it is only protected by `Bash(...)` permission patterns. Host without bubblewrap/seatbelt → hard→soft degradation with a `warning`.
- path-scope requested → the soft run drops `bypassPermissions` for a default-deny mode; a read of a file outside `cwd ∪ allowedPaths` is blocked even when it is not named in `disallowedPaths`. Outside path-scope the run keeps `bypassPermissions` unchanged.
- path-scope / sandbox requested → `settingSources` is narrowed to drop the global `~/.claude` tier, so global `settings.json` and disk skills there are not discovered; inline skills (via `options.plugins`) are unaffected.
- `run_in_background` Bash call → the turn's `result` arrives with the background task still running; the SDK holds the session open and the completion (`task_notification` → `background_task_completed`) plus the continuation turn arrive **before** iterator `done`. A consumer that stops at the first `result` never sees them (M17's canonical bug).
- `run_in_background` Bash call → the woken model's `AskUserQuestion` still reaches the consumer, because the input channel outlived the turn's `result`. Closing it there instead produces the failure signature this rule exists to prevent: a `tool_result` reading `Tool permission request failed: … Stream closed`, the model retrying and then asking in prose, and no `user_input_request` on the stream.
- `abort()` while a `user_input_request` is outstanding and the consumer's handler is still pending → the run terminates with `AdapterAbortError` and the SDK subprocess is torn down; it does **not** wait for an answer that may never come.
- harness scheduling tools (`ScheduleWakeup`, `Cron*`, `/loop`) are inert under the headless SDK — they would end the turn without ever firing the wake-up, silently dropping the scheduled work → the adapter **hard-suppresses** them so the model never sees them (no silent no-op). `Monitor` is exempt (it works headless) and stays available.

<!-- anchor: e3az4o5i -->
## Acceptance criteria

These verify the reference mappings and the two capabilities unique to this adapter (subagent definition, mid-turn push).

<tagged_list type="ac" tags="a01"/>
