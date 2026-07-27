<!-- anchor: c3xv3jii -->
# Changelog

All notable changes to `@inharness-ai/agent-adapters` are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

<!-- anchor: b7t4m2xk -->
## [0.10.0] — 2026-07-27

<!-- anchor: n5r8k3wq -->
### Added
- **Background & long-running tasks (M17) — `background_task_*`, decoupled from `subagent_*`.** Engine-backgrounded side work gets its own lifecycle: `background_task_started { taskId, taskType, description }`, `background_task_progress { taskId, taskType, status?, outputFile? }`, `background_task_completed { taskId, taskType, status, outputFile?, summary?, usage? }`, where `taskType` is `'shell' | 'monitor' | 'workflow'` (unknown kinds pass through by name). `claude-code` splits the SDK's single `task_*` channel by the `task_type` captured on `task_started` — the discriminator is absent from `task_progress` / `task_notification`, so it is registered per task id and applied to every later message for that task. A `run_in_background` Bash command reports `task_type: 'local_bash'` (the SDK prefixes locally-executed kinds with `local_`; the prefix is stripped before mapping), so backgrounded shell work no longer surfaces as `subagent_started` / `subagent_completed` — the mislabelling that rendered three `sleep` commands as "3 subagents stopped" in consumer UIs. Absent or unrecognized `task_type` keeps the subagent path, so an SDK that stops sending it degrades to the previous shape rather than misrouting real subagents.
- **`result.backgroundTasks` in-flight signal.** A `result` emitted while tracked work is still in flight carries `backgroundTasks: { taskId, taskType, description? }[]`. **When non-empty that `result` is not end-of-run** — the engine holds the session, wakes the model when the work settles, and the stream yields the completion, the continuation turn, and a further `result` before the generator is `done`. Consumers must iterate `execute()` to `done`. The list carries **engine-backgrounded work only, never a subagent** — a subagent would promise a `background_task_completed` that never arrives — though subagents do still hold the session open. It comes from the adapter's own tracking unioned with the engine's own report (`SDKResultMessage` has no such field; the SDK publishes `background_tasks[]` on the Stop hook input, and a future `result` field would be unioned the same way), with every engine-supplied entry classified through the same task-kind mapping that routes the event families.
- **`claude_disallowBackgroundBash` (`architectureConfig`, default off).** Forbids backgrounded shell commands for consumers that cannot tolerate a turn outliving its `result` (strict per-turn billing, hard wall-clock budget). Realized as a synthesized `PreToolUse` deny-hook on Bash calls requesting `run_in_background`, with a deny reason telling the model to re-run the command synchronously.

<!-- anchor: j9v6p1zd -->
### Fixed
- **`claude-code`: `Tool permission request failed: … Stream closed` after background work settles.** An `AskUserQuestion` raised by the woken model was denied inside the CLI in ~4ms with no host round-trip; the model retried twice and fell back to prose, so the consumer's UI saw its questions auto-rejected. Cause: the CLI is spawned with `--permission-prompt-tool stdio`, so its permission/control protocol shares the stdin the prompt channel feeds — and that channel was closed at the turn's `result` while the engine kept the session alive for in-flight work. Two independent closers reached the same `transport.endInput()`: the adapter's close-at-`result`, and the SDK's own single-turn shutdown for a plain string prompt (`isSingleUserTurn` → *"First result received for single-turn query, closing stdin"*). Both are gone. **Every** run now rides the input channel (`streamingInput` still gates `pushMessage()` alone; a one-shot run is still exactly one `result` and still terminates), and the channel outlives a `result` in any run that touched a task. Nothing-in-flight is deliberately *not* the close condition: on SDK 0.3.210 three subagents reported completion inside the turn and the engine still resumed the model for three further turns before asking. The hold is bounded twice, and **neither bound can fire while the model is producing** — a timer expiring mid-turn would close that same stdin and re-create this very defect. A **grace window** applies once everything tracked has settled (only a wake-up can still be owed) and is re-armed by every frame arriving while parked, so it measures engine silence rather than elapsed time; its expiry is silent, because settled work plus a quiet engine is simply where a task-touching run ends. A **120s cap** bounds the parked stretch while work is genuinely still running (a backgrounded `sleep 3600`) and is released the instant a continuation turn begins; only its expiry emits a `warning`, so the run always terminates and a real truncation is never silent. The adapter also registers a `Stop` hook to read the engine's own `background_tasks` report as a positive hold reason — measured to land ~3ms before the `result` it belongs to on both 0.3.153 and 0.3.210. Its *empty* answer is deliberately not trusted: on 0.3.153 it reported `[]` for a three-subagent session the engine then held open and resumed 2ms later.
- **`claude-code`: `abort()` could not terminate a run parked on an unanswered `user_input_request`.** The loop awaited the consumer's `onUserInput` handler with nothing racing the abort signal, and `abort()` only aborted the controller and closed the channel — neither settles a host promise that resolves on a human reply. A UI-backed consumer could therefore never reclaim such a session: the run parked forever holding its adapter and its SDK subprocess, and the symptom appeared to "heal on restart". The handler is now raced against the abort signal (as is the main loop's wait on the SDK), the outstanding request is answered `cancel` so the SDK-side promise cannot leak, and the stream ends with `AdapterAbortError` / `AdapterTimeoutError`.
- **`claude-code`: post-`result` background wake-up lost entirely on peer SDK 0.3.210.** On the adapter's default one-shot path the backgrounded task settled, its completion fired, and the run simply ended — the model was never resumed, so anything it was told to do afterwards silently never happened (measured: 13s and zero handler calls on 0.3.210 vs 35s and a delivered answer on 0.3.153). Both versions satisfy the declared peer range `>=0.3.0 <0.4.0`, so that range spans a behavioural break. Fixed by the same universal-channel change: all four cells of the work-shape × prompt-path matrix now pass on both versions.
- **`claude-code`: every healthy task-touching run ended with a false data-loss `warning`.** The keep-open condition is "this run started any task", and that set is never pruned, so a run whose subagents had all finished re-entered the hold at its final `result`, sat out the grace window, and ended via the truncation path — emitting *"background work settled but the engine did not resume the model … Anything the model was told to do after the task did not run."* Nothing had been lost; the work was done. Grace expiry is now silent and only the cap warns.
- **`claude-code`: the hard cap could cut off a live, resumed run mid-turn.** The cap timer was armed once at the first held `result` and never released, so a run the engine *did* resume was killed 120s later while the model was still working — closing the CLI's stdin and re-creating the `Stream closed` defect above via its own safety net. The bounds are now released as soon as the main model produces again (subagent chatter, which is what the held state looks like, does not count), and the grace is re-armed rather than disarmed by unrelated frames — the engine really does emit `system/status` and `system/background_tasks_changed` while it babysits work, and any one of them used to disarm the short bound outright.
- **`claude-code`: the wake-up grace window had no margin.** It has to cover the gap between the last task settling and the first frame of the continuation turn; measured with `includePartialMessages` (which the adapter always sets) that gap is 3.5s for backgrounded bash and 3.7s for three subagents on 0.3.210, and 5.0s on 0.3.153 without partials — against a 5s window. Raised to 15s, sized off the measurement. Expiry is silent, and it only delays the generator reaching `done` after the consumer already has its `result`.
- **`result.backgroundTasks` no longer reports subagents.** The field is defined as engine-backgrounded work only ("never a subagent") and as meaning "this result is not end-of-run", so a listed subagent promised a `background_task_completed` that never arrives. An ordinary completed subagent run shipped `backgroundTasks: [{ taskType: 'local_agent' }]`. Entries the engine supplies now also go through the same task-kind classifier as the event families rather than being passed through: `BackgroundTaskSummary.type` is a display label whose value is literally `'subagent'` for helper agents on 0.3.210, and `'local_bash'` for backgrounded shell work. Subagents still hold the session open — holding and reporting are separate decisions.
- **`takeUntilResult()` stopped at the first `result`, contradicting the contract this release introduced.** The exported helper ended consumption on a `result` carrying a non-empty `backgroundTasks`, which is exactly the bug that signal exists to prevent — handed to every consumer who reached for the ergonomic path instead of writing the loop by hand. It now passes a held `result` and stops at the terminal one.
- **The conformance toolkit rejected a legitimate trailing `warning`.** `assertSimpleText`'s terminality check read the last non-`flush` event, but the hold's cap warning is raised from a timer and therefore lands after the run's last `result`. It now reads the last non-`flush`, non-`warning` event — the same exemption the `adapter_ready` check already makes at the other end of the stream.
- **`claude-code`: task-id reconciliation (M16) no longer rests on one English sentence.** The engine-assigned id is recovered by regexing the `TaskCreate` tool_result, so a reworded CLI string would silently reinstate the duplicate-item bug fixed in 0.8.6. The extraction now prefers any structured identifier, accepts several phrasings, and rejects captures that are sentence words rather than ids; failing all that, a positional fallback aliases the unambiguous case (exactly one unreconciled create, an update naming an id never seen assigned) and anything ambiguous is left alone rather than guessed. A failure to resolve by any route is logged behind the debug flag.

<!-- anchor: v2m7p4kd -->
### Documentation
- **`claude-code` `result.usage` is per-turn, not per-`query()` cumulative** — the code comment claiming otherwise was wrong, and made summing several results look like double-counting. Measured across four live runs on both pins, a run's second `result` reports *fewer* tokens than its first in nearly every field, which a running total cannot do. Several `result`s in one run is normal (a mid-turn push, or a background wake-up), the run's billing is their sum via `sumUsageFromEvents()`, and `contextSize` is the last one's. No behaviour change.

[0.10.0]: https://github.com/InHarness/agent-adapters/compare/v0.9.0...v0.10.0

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
