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
| `system` `task_started` / `task_progress` / `task_notification` | `subagent_started` / `subagent_progress` / `subagent_completed` |
| `system` `compact_boundary` | `flush` |
| `result` (`subtype: success`) | `result` |
| `result` (non-success) | `error` (runtime phase) |
| `AskUserQuestion` via `canUseTool` / `onElicitation` | `user_input_request` (+ legacy `elicitation_request`) |
| accepted `pushMessage` | `user_message` |

`subagentTaskId` is resolved through a `parent_tool_use_id` → `task_id` map populated on `task_started`. Task-tracking `tool_use` blocks project to `todo_list_updated` (source `model-tool`) with their echoed `tool_result` suppressed as redundant; the `TodoWrite` ↔ `TaskCreate/…` matrix, the `ToolSearch` gate, snapshot accumulation, and the rename-durable projection semantics are owned by M16 (see <section_ref anchor="3dln3isl"/>).

The harness **scheduling** family (`ScheduleWakeup`, `CronCreate` / `CronList` / `CronDelete`, and the `/loop` slash command) has **no row above**: these tools are hard-suppressed before they can reach the stream, so they never map onto any `UnifiedEvent` (see <section_ref anchor="sw3cwrsm"/>). `Monitor` is *not* in this family — it works headless (it streams a background process) and stays an ordinary `tool_use` → `assistant_message`.

<!-- anchor: c4qvzzks -->
## Capability support & degradation (L2)

This adapter is the positive column in every capability matrix — those matrices live in the capability-modules (one-home rule), not here:

- MCP transports → M04 owns the matrix; claude-code accepts all four (stdio, SSE, HTTP, in-process SDK).
- Subagent definition → M06; claude-code is the only adapter where `subagentDefinition` is true.
- Mid-turn push → M11; claude-code is the only adapter where `midTurnPush` is true.
- Images → M10; accepts base64 + url, materializing `file` sources to inline base64.
- Path-scope → M15 owns the matrix; claude-code is the only adapter with a fine-grained, **deny-expressible** gate and is **hard-capable** (OS sandbox) — soft by default, hard on opt-in.

`architectureCapabilities('claude-code')` returns `{ midTurnPush: true, imageInput: true, subagentDefinition: true, pathScope: true }`.

<!-- anchor: sw3cwrsm -->
## Per-capability consumption

- **Models** (<section_ref anchor="9gu9zp7z"/>) — `resolveModel('claude-code', …)`; honors `claude_thinking` (auto-converts `enabled` → `adaptive` for `ADAPTIVE_THINKING_ONLY` models) and restores the `summarized` thinking display for Opus 4.7.
- **MCP (M04)** — passes the unified `mcpServers` config straight through; in-process `sdk` servers are handed over by instance.
- **Skills (M05)** — materializes `InlineSkill`s into a per-call tmpdir registered as a `local` plugin; the `Skill` tool is whitelisted even in plan mode.
- **Subagents (M06)** — maps `subagents` to `Options.agents`; both defines and observes lifecycle.
- **Images (M10)** — builds Anthropic image blocks; a `file` image is read and inlined as base64.
- **Mid-turn (M11)** — runs a real streaming-input channel (`AsyncIterable<SDKUserMessage>`); `pushMessage` enqueues and the channel stays open across turns while messages are pending.
- **Resume (M07)** — sets `options.resume`; usage reported by `result` is per-`query()` cumulative, **not** cross-session.
- **Path-scope (M15)** — realizes M15's **allow-confinement** contract, not a bare deny-list.
  - *Soft default.* When path-scope is requested the run switches **off** the adapter's usual `permissionMode: 'bypassPermissions'` (under which everything not explicitly denied is auto-approved — allow-confinement is impossible) and onto a **default-deny** mode (`permissionMode: 'default'`/`'dontAsk'`) with `permissions.allow` rules for `cwd ∪ allowedPaths` and `permissions.deny: ['Read(…)','Edit(…)']` rules for `disallowedPaths`. This confines reads/writes to the ceiling (model-visible). Outside path-scope the adapter keeps today's `bypassPermissions`, so consumers not using scope see no regression.
  - *Hard gate (opt-in).* Enabling `claude_sandbox.enabled` enforces at the OS syscall level (bubblewrap/seatbelt): `sandbox.filesystem` `allowWrite`/`denyWrite`/`denyRead` for write confinement, plus **managed allow-read confinement** (`allowManagedReadPathsOnly` + `allowRead` for `cwd ∪ allowedPaths`) for reads — because the SDK's default read model is deny-based, merely allowing the scope would not exclude the rest. When the OS sandbox is requested but unavailable on the host, the gate degrades hard→soft with a `warning`; a security consumer reads the runtime strength signal before dispatch (the static capability only says *hard-capable*).
  - *Config-discovery containment.* When path-scope (or the sandbox) is requested the adapter narrows `options.settingSources` to exclude the global user tier (`~/.claude`), disabling ambient global settings and disk-skill discovery that could otherwise re-widen the agent's reach outside scope. Inline skills are delivered via `options.plugins` (see M05), so this narrowing does **not** disable inline-skill materialization.
- **Usage (M08)** — rolls Anthropic's three input buckets (`input` + `cache_read` + `cache_creation`) into a single `inputTokens`; `contextSize` = input + output.
- **plan mode** — hides mutating built-ins via `tools` / `disallowedTools` rather than the SDK's `permissionMode: 'plan'`, so consumer-curated MCP tools still execute. **Durability requirement:** the read-only allowlist must track *every current alias* of a renamed or relocated built-in across SDK versions — the same discipline already applied to `Task` → `Agent` — and must keep the task-tracking family plus the `ToolSearch` discovery gate available (the family, its `TodoWrite` ↔ `TaskCreate/…` drift, and projection semantics are owned by M16 — see <section_ref anchor="3dln3isl"/>), so a plan-mode turn on a newer model always retains a usable task-tracking tool and never silently degrades to prose-only planning. Stated as an invariant on behavior, not on a frozen tool list.
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
- **Defensive-read / in-range degradation** — the projection reads task-tracking input from `Record<string,unknown>` on a dual path across the legacy and CRUD field names (`subject` / `description` / `taskId`), so a field rename inside the range never yields a silent empty todo (see M16).

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
- harness scheduling tools (`ScheduleWakeup`, `Cron*`, `/loop`) are inert under the headless SDK — they would end the turn without ever firing the wake-up, silently dropping the scheduled work → the adapter **hard-suppresses** them so the model never sees them (no silent no-op). `Monitor` is exempt (it works headless) and stays available.

<!-- anchor: e3az4o5i -->
## Acceptance criteria

These verify the reference mappings and the two capabilities unique to this adapter (subagent definition, mid-turn push).

<tagged_list type="ac" tags="a01"/>
