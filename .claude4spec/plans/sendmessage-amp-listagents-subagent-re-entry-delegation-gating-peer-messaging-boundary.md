---
type: plan
title: >-
  SendMessage &amp; ListAgents — subagent re-entry, delegation gating,
  peer-messaging boundary
created_at: '2026-09-21T21:33:14.045Z'
created_by: agent
applied: true
---
# SendMessage & ListAgents — subagent re-entry, delegation gating, peer-messaging boundary

Plan only. Nothing below has been applied. Addresses are `page#anchor`; every anchor was returned by `get_page_outline` / `search_pages` in this thread.

<!-- anchor: x5y7hwr9 -->
## 1. Intent (read back)

You want the specification to stop being silent about a tool the SDK already ships and the adapter already meets at runtime. `SendMessage` is **one** SDK tool with **three** distinct uses, and the specification currently covers none of them:

1. **Same-session subagent continuation** — the Agent tool result literally instructs the model to use `SendMessage`; SDK 0.3.263 backgrounds `Agent` by default, so continuation is the normal path, not an exotic one.
2. **Agent-team teammates.**
3. **Cross-session peers** (other local sessions, Remote Control, cloud), including **inbound** peer messages the run did not initiate.

Two of these already produce observable trouble, but only one of them is an *adapter* defect. The second lifecycle pair the adapter emits on re-entry is **correct** — what is wrong is the specification's assumption of one cycle per `taskId` (§3a), so (1) is a contract correction, not a bug fix. Delegation tools vanishing from the allow-list is a genuine defect. The third is an un-defaulted ingress surface. The plan treats (1) as a **contract correction**, (2)+(3) as a **documented scope boundary with a pinned safe default**, and records the promotion question as an open question rather than inventing a module for it.

**Revised 2026-09-22 against the source.** This thread had filesystem access and re-checked every runtime claim against the installed packages. Five claims were wrong and are corrected in place (§2); four of the six open decisions are closed; the delegation `ToolGroup` moved from *optional* to *required*; two proposed edits were **withdrawn** because the code already says what the spec says; and the allow-list defect turned out to be **29 tools wide, not 2**. Read §2's "Source verification" block before any entry below.

**One correction to the request, stated up front.** `M14 / L6` is not the home for `crossSessionInbound`. `L6` (`layers/L6-auth-credentials.md#le0v4g4j`) is a four-point *auth-declaration* convention (default source / via provider / required env / failure mode) and nothing else; `M14` (`modules/M14-audit-redaction.md#5c0hi9kf`) is scoped to the `adapter_ready` event, `redactSecrets`, and the warning→ready ordering. Neither says anything about runtime message provenance. The option is an adapter-prefixed SDK option with **no cross-adapter contract**, so under the one-home rule (<index> `pvms8npr`) it is **adapter content** in `A01`, consumed inline in `## Per-capability consumption` exactly as `codex_sandboxMode` and `gemini_thinkingBudget` are (`layers/L3-configuration-extensibility.md#gapa5rc5`). M14 does get **one** legitimate touch, and it is the honest core of your instinct: the pinned posture must be **auditable** on `adapter_ready`.

<!-- anchor: ax332110 -->
## 2. Current state (what the specification says today)

Scout result, re-verified: **zero hits** for `SendMessage`, `ListAgents`, `crossSessionInbound` and `teammate` across all 30 pages and all 210 `ac` entities — re-confirmed by a raw `grep` over `spec/` on 2026-09-22 (0 files). Two terms of the original sweep are **not** zero: `peer` occurs 13 times across 12 pages and in 3 `ac` entities, `resumed` 7 times across 6 pages and in 4 `ac` entities — every hit a homonym (`peer-SDK range`; `findResumeViolations`, `isSessionFieldMutable`, M07's session-resume vocabulary), none of them multi-agent.

Per-module readings:

| Address | What it says today | Bearing on this change |
| --- | --- | --- |
| `modules/M06-subagents.md#0f6287ae` | `subagent_started { taskId, description, toolUseId }`; `subagentTaskId` on deltas matches `subagent_started.taskId` | No field distinguishes a first start from a second under a reused `taskId`. `toolUseId` is carried once, at the original start, with no re-emission rule. |
| `modules/M06-subagents.md#4b8iv50p` | Termination synthesizes a closing `subagent_completed` for every unpaired start, "**at most once per `taskId`**" | **Verified accurate against the code** — see (a). The guard is `flushedSubagents: Set<taskId>` walked over `tasks.inFlight`, and it runs once per run. |
| `modules/M06-subagents.md#70dpqgcb` | "Scope — real subagents only… actual spawned helper agents" | Says nothing about agents this run did **not** spawn (peers, teammates). |
| `modules/M17-background-tasks.md#01or0cpk` | "Subagents **do** hold the session — that is the control-channel hold's job, and it holds for both kinds" | **(b) is already implemented**, not 80% covered — see (b). Only the re-entry sentence is unwritten. |
| `modules/M17-background-tasks.md#q9u5sbot` | Grace "armed only once everything tracked has settled… re-armed by every frame"; "the hold takes the union" | The settle-then-re-enter case is already handled by `TaskRegistry.start()`; one genuinely unhandled sub-case remains (E8). |
| `modules/M18-tool-gating.md#4j6f86yq` | `ToolGroup = 'shell' \| 'file-read' \| 'file-write' \| 'web'`; residual allow-list; "*a built-in the library has never heard of is blocked, not allowed*" | Verified verbatim in `spec/modules/M18-tool-gating.md:42,56` and in `src/tool-groups.ts:55`. |
| `adapters/A01-claude-code.md#sw3cwrsm` | Allow-list "must track *every current alias*… and must keep the task-tracking family plus the `ToolSearch` discovery gate available **whenever writes are denied**" | **The spec understates its own code on three counts** — see (c1). |
| `adapters/A01-claude-code.md#mn3ytsj4` | `Map<task_id, task_type>`; `parent_tool_use_id` → `task_id` map populated on `task_started` | Both maps are in fact **already** re-entry-safe; the first draft described the second one backwards — see E13. |
| `adapters/A01-claude-code.md#49zu34oc` | Verified-pin log; newest row `2026-09-07 \| ^0.3.251 (resolved 0.3.263)` | Still the current pin: `package.json` dev-pin `^0.3.251`, `node_modules` resolves **0.3.263**. Findings append to that row. |
| `adapters/A01-claude-code.md#a01e2ecv` | Coverage table; `subagents` row is `⚠️ partial` | Extendable. |
| `modules/M12-conformance-release.md#xe2ecat1` | Catalog row `subagents`; row `abort` proves closure "at most once per `taskId`" | The `abort` row's wording is **correct as it stands** — see (a). |
| `modules/M14-audit-redaction.md#0tycjmv6` | `adapter_ready { sdkConfig }`, redacted, exactly once | The seam through which a pinned posture becomes auditable. |

---

<!-- anchor: nwnral4v -->
### Source verification — 2026-09-22, against the installed packages

This thread had filesystem access. **Every runtime claim in the previous version was re-checked against source.** Versions read from `node_modules`: `@anthropic-ai/claude-agent-sdk` **0.3.263** (`manifest.json`: CLI `2.1.263`, commit `37ae3f38`, built 2026-09-06), `@openai/codex-sdk` **0.120.0**, `@opencode-ai/sdk` **1.15.11**, `@google/gemini-cli-core` **0.38.2**.

**Confirmed by source:**

1. **`Agent` is backgrounded by default.** `sdk-tools.d.ts` → `AgentInput.run_in_background`: *"Agents run in the background by default; you will be notified when one completes."* `AgentInput.name`: *"Makes it addressable via `SendMessage({to: name})` while running."*
2. **A resumed subagent produces a fresh `task_started`.** `sdk.d.ts` → `SDKTaskStartedMessage.is_backgrounded`: *"**A resumed subagent is always registered in the background.**"* The message carries **no** `resumed` flag, so the marker (a) proposes must be adapter-derived — which is exactly what the plan assumed.
3. **`Options.tools` is a positive base-set replacement.** `sdk.d.ts`: *"Specify the base set of available built-in tools… `[]` (empty array) — Disable all built-in tools."* The adapter sets it at `src/adapters/claude-code.ts:1161-1167` (`options.tools = toolPolicy.allow; options.disallowedTools = toolPolicy.deny`). So omission from that array really does remove a tool.
4. **`crossSessionInbound` exists with exactly the declared union** — `sdk.d.ts:8242`, `'accept' | 'hold' | 'refuse'` — and its **mode-parity default is documented verbatim**: *"Unset (mode parity): a message auto-delivers only when the sending session's permission-mode class matches yours (bypass↔bypass or prompting↔prompting); a mismatched sender's message is held for your approval; a sender that asserts no class is held only while this session bypasses permission prompts."* `isolatePeerMachines?: boolean` at `sdk.d.ts:8234`.
5. **The peer/task-notification origins are typed** — and far wider than the plan assumed. See correction (E) below.

**Corrected by source — five claims that were wrong:**

- **(A) `crossSessionInbound` is not on `Options`.** Both it and `isolatePeerMachines` live on `export declare interface Settings` (`sdk.d.ts:5748`), the settings.json shape — together with `teammateMode`, `remoteControlAtStartup`, `autoUploadSessions`. The adapter cannot pass `crossSessionInbound` as a query option. It must go through `Options.settings?: string | Settings` (`sdk.d.ts:2050`, the `'flag'` tier of `ResolvedSettingSource`) — **not** `Options.managedSettings`, which is *"filtered restrictive-only — non-allowlisted keys are dropped regardless"* and would silently drop the pin.
- **(B) The allow-list defect is 29 tools wide, not 2.** `sdk-tools.d.ts` declares **45** tool input schemas at this pin. `src/adapters/claude-code.ts` knows **24** names. Absent from the library's inventory and therefore **stripped from `options.tools` whenever any group is denied**: `Artifact, ClaudeDesign, CronCreate, CronDelete, CronList, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, ListMcpResources, Mcp, Monitor, Projects, ProposeGoal, ProposeSkills, PushNotification, REPL, ReadMcpResource, ReadMcpResourceDir, ReadNotifications, RefreshMcpTools, RemoteTrigger, ReportFindings, ScheduleWakeup, SendFeedback, ShowOnboardingRolePicker, TaskOutput, TaskStop, Workflow`. `SendMessage` / `ListAgents` are not even in that 45 — they are deferred beyond the schema file, so the defect has **two layers**: catalogued-but-unknown, and not-catalogued-at-all.
- **(C) The carve-out is already general in code; the spec understates it.** `CLAUDE_CODE_UNGATED_BUILTINS` (`src/adapters/claude-code.ts:198-204`) = `TodoWrite, TaskCreate, TaskGet, TaskUpdate, TaskList, ToolSearch, AskUserQuestion, Task, Agent`, prepended **unconditionally under any deny** (`claude-code.ts:230`), and the test is literally named *"keeps task-tracking **and delegation** available under any deny"* (`claude-code.tool-gating.test.ts:83`). `A01#sw3cwrsm` says "the task-tracking family plus the `ToolSearch` discovery gate… **whenever writes are denied**" — it omits `AskUserQuestion`, omits `Task`/`Agent`, and narrows "any deny" to "writes denied". **Pre-existing spec/code drift, independent of this change.**
- **(D) The inventory already exists and is dead code.** `claudeCodeKnownBuiltins()` (`claude-code.ts:206-213`), documented *"Every built-in this library knows about."*, has **no reference anywhere in `src/`** and is not re-exported from `src/index.ts`. (c1)'s "the rule runs on an inventory" is therefore a matter of *wiring and completing* an existing function, not of inventing one.
- **(E) `SDKMessageOrigin` has nine variants, not two** (`sdk.d.ts:4685-4745`): `human`, `channel`, `peer`, `task-notification`, `coordinator`, `unclassified`, `observer`, `auto-continuation`, `observer-activity`. And the `peer` variant is **not purely out of scope**: it carries `senderTaskId` — *"Task id of the **in-process background subagent** that sent this message… **Absent for cross-session peers.**"* That field is the discriminator between the in-scope case (M06) and the out-of-scope one, which makes (d)'s boundary writable as a rule rather than as a refusal.

**What still cannot be verified from source, and stays a probe transcript:** the `SendMessage` tool-result shape (`{ success, message: 'Resuming agent …', resumedAgentId }`) and the live *"no `SendMessage` tool"* symptom. The SDK package ships **no CLI** — `manifest.json` points at a ~199 MB native `claude` binary fetched separately — so nothing in `node_modules` carries that behaviour. `SendMessage`/`ListAgents` appear in `sdk.mjs` only inside the alias map and an option description; `ToolSearch` appears **nowhere in the entire package** (0 hits in `sdk.d.ts`, `sdk-tools.d.ts`, `sdk.mjs`) while being live in the running harness — which is itself the proof that an SDK-published list does not enumerate deferred tools.

**The alias map, read out of `sdk.mjs` — this is the authority for "every current alias":**

```
Task → Agent            KillShell → TaskStop        KillBash → TaskStop
AgentOutputTool → TaskOutput                        BashOutputTool → TaskOutput
AgentOutput → TaskOutput                            BashOutput → TaskOutput
ListPeers → ListAgents  Brief → SendUserMessage
ListMcpResources → ListMcpResourcesTool
ReadMcpResource → ReadMcpResourceTool
ReadMcpResourceDir → ReadMcpResourceDirTool
```

Two consequences the plan did not have: **`ListPeers` is a current alias of `ListAgents`** and must appear in any allow-list beside it; and **`BashOutput` / `KillBash` / `KillShell` — the three spellings the adapter's `shell` group names — are legacy aliases whose canonical names are `TaskOutput` and `TaskStop`**, which the adapter does not name at all (E25).

**Environment note for whoever applies this:** the `module-dependency` entity type is **INACTIVE** in this project. Rule 3a does not apply — cross-module relations live in each module's own prose `## Dependencies` table and in `<index>` `vancl72m`. Only `ac` is active (210 records).

<!-- anchor: v8cwvo1d -->
## 3. Decisions taken, with the reasoning that produced them

<!-- anchor: qpa4446y -->
### (a) M06 — a re-entered `taskId` is a second cycle, explicitly marked

**Decision.** `taskId` identifies **the agent**; `toolUseId` identifies **the invocation**. A re-entry therefore emits a genuine second `subagent_started` with the **same `taskId`** and a **new `toolUseId`** (the `SendMessage` tool_use id), closed by its own `subagent_completed`. The adapter's current emission is **correct**; the specification's assumption of one cycle per `taskId` is what is wrong.

**Verified against the code.** `task_started` → `tasks.start(taskId, …)` → `yield { type: 'subagent_started', taskId, description, toolUseId }` unconditionally (`src/adapters/claude-code.ts:2343-2364`), and every `task_notification` yields a `subagent_completed` (`claude-code.ts:2389-2432`). So a second cycle already produces a second pair today, with **no** marker distinguishing it. The SDK side is corroborated by `SDKTaskStartedMessage.is_backgrounded`'s own doc: *"A resumed subagent is always registered in the background."*

**The `resumed` marker, stated precisely.** `subagentTaskId` on the resumed agent's deltas continues to resolve from the **original** `Agent` tool_use id, so a consumer bucketing by `taskId` (`M09`'s `splitBySubagent`) sees a closed bucket silently reopen. A *stateful* consumer holding the whole stream can derive the bit; what it cannot do is derive it without retaining closure state, and a consumer joining mid-run cannot derive it at all. The marker exists for those two, and because a guarantee the consumer has to reconstruct is not a guarantee.

**Placement.** M06's `## Unified Contract (L1)` section, not a new `## Domain`. L1's slice schema (`layers/L1-unified-contract.md#yc5ftl18`) asks for "any field it contributes, each stated with the guarantee that field carries" — the identity semantics of `taskId`/`toolUseId` **is** a field guarantee.

**Semver.** `resumed?` is an optional field added to an event the library already emits: additive, **minor** under M12's rules.

**CORRECTED — the termination rule does NOT need re-keying.** The first version proposed rewriting "at most once per `taskId`" into "at most once per unpaired `subagent_started`". The code says that is unnecessary and slightly misleading:

```ts
const flushedSubagents = new Set<string>();           // keyed on taskId
for (const taskId of [...tasks.inFlight]) { … }       // claude-code.ts:1691-1698
```

The guard is per-`taskId` **by construction**, it walks `inFlight` (from which `settle()` has already removed every closed cycle), and `flushOpenSubagents()` runs **once per run** at terminal teardown. At any instant a `taskId` carries at most one unpaired start — re-entry follows settlement — so per-`taskId` and per-unpaired-start are the same set, and the existing phrasing is exactly what the data structure gives. Re-keying it to `(taskId, toolUseId)` would describe bookkeeping the adapter does not do.

**What the sections actually need** is not a re-key but a **disambiguation**: the phrase constrains the *synthesis at termination*, not the pairing across the run. E6 and E19 are rewritten accordingly, and the two `ac` re-keyings in E23 are withdrawn.

<!-- anchor: puwxalny -->
### (b) M17 — codify that a re-entered subagent re-enters the in-flight set

**Decision.** Codify, do not redesign — and the verification strengthens this: **the behaviour is already implemented and correct.**

```ts
start(taskId, rawTaskType, description) {
  const kind = { ...classifyTaskType(rawTaskType), description };
  kindById.set(taskId, kind);   // refreshes on a repeat id
  inFlight.add(taskId);         // re-enters the tracked set
  return kind;
},
settle(taskId) { inFlight.delete(taskId); finished.delete(taskId); … }
```

(`src/adapters/claude-code.background-hold.ts:189-206`.) A settled `taskId` that sees a second `task_started` therefore re-enters `inFlight` and is absent from `finished`, so `noWorkLeftRunning()` goes false and both bounds re-arm. E8 and E17 are **codifications of existing behaviour**, which is the cheapest kind of entry to apply and the most valuable to have written down.

**One genuinely unhandled sub-case, found during verification.** `markFinished` (from `task_updated.patch.status`) adds to `finished`; only `settle` (from `task_notification`) clears it. A `task_started` re-arriving for an id that was marked finished but has **not** yet settled leaves that id in both `inFlight` and `finished`, so `noWorkLeftRunning()` reports true and the grace window arms while a live cycle is running. Narrow — it needs a re-entry inside the `task_updated` → `task_notification` gap — but it is the exact failure this section exists to prevent, so it gets an edge case of its own rather than being smoothed into the general sentence.

`result.backgroundTasks` is untouched: `ac-result-backgroundtasks-lists-engine-backg` correctly excludes subagents from the **reporting** signal, and holding ≠ reporting is already canon in that section.

<!-- anchor: bwyjn3p7 -->
### (c) M18 — two changes, one required, one to confirm

**Both changes are now required. The verification removed the optionality from (c2) and widened (c1) by an order of magnitude.**

**(c1) — the rule, restated against what the code actually does.** The first version framed this as *generalizing a narrow carve-out*. Source says the carve-out is **already general** (`CLAUDE_CODE_UNGATED_BUILTINS`, prepended under **any** deny, already carrying `Task`/`Agent`/`AskUserQuestion`), and that the inventory function **already exists** (`claudeCodeKnownBuiltins()`, `claude-code.ts:206-213`) but is **dead code**. So the defect is not a missing rule — it is:

1. **A spec that understates its own code.** `A01#sw3cwrsm` says "task-tracking family plus `ToolSearch`… whenever writes are denied". The code preserves nine names under any deny. Correcting this is E14b's real job.
2. **An inventory that is 29 tools short.** Whenever any group is denied, `options.tools` silently strips `TaskOutput`, `TaskStop`, `Monitor`, `Workflow`, `Artifact`, `ReportFindings`, `ScheduleWakeup`, `RemoteTrigger`, `PushNotification`, `EnterWorktree`/`ExitWorktree`, `REPL`, `Mcp`, `RefreshMcpTools`, the three MCP-resource tools, `ProposeSkills`, `ProposeGoal`, `SendFeedback`, `ClaudeDesign`, `Projects`, `ReadNotifications`, `CronCreate`/`CronDelete`/`CronList`, `ShowOnboardingRolePicker`, `EnterPlanMode`, `ExitPlanMode` (§2/B). `SendMessage` and `ListAgents`/`ListPeers` are one instance of a 29-instance class.
3. **A list that cannot be derived from anything the SDK publishes.** `ToolSearch` — which the adapter already whitelists — appears **nowhere** in the SDK package, yet is live in the harness. A generated schema file is not a catalog of the run's tools.

*(One alarm raised and cleared during verification: `ExitPlanMode` is in the stripped set, but the adapter deliberately never sets `permissionMode: 'plan'` (`claude-code.ts:1152-1155`), so no run needs it. Recorded so the next round does not re-raise it.)*

**So the L1 rule stands as written, but its justification changes**: it is not *"delegation tools should survive a deny"*, it is *"a positive allow-list built from a 24-name hand list against a 45-name SDK catalog plus an unbounded deferred set is fail-closed **by accident**, on tools the library was never asked to gate."* The rule and its inventory obligation are what make that difference between **unknown** (blocked, by design) and **unclassified** (preserved) decidable.

**Placement — resolved.** The open L1-vs-L2 question is settled toward **L1**: the sentence states what the constructed allow-list *contains*, which is a contract fact about a field the consumer sees. The *behaviour toward an SDK release that ships an unnamed built-in* is the L7 drift obligation and goes to E16, not to L2.

**(c2) — a fifth `ToolGroup`: `delegation`. Now REQUIRED, not optional.** The first version declined to require it because "codex, opencode and gemini have no delegation primitive". **That is false for two of the three:**

- **A03 opencode — has one, and already gates it, ad hoc.** `src/adapters/opencode.ts:118-124` maps the `task` permission bucket into `file-read`, with the code comment *"The DELEGATION bucket is deliberately part of `file-read`: without it a subagent launders exactly the reads the parent just denied."* The bucket is confirmed against the running server (`opencode.tool-gating.test.ts:28,72-74`). SDK side: `SubtaskPartInput { type:'subtask', prompt, description, agent }`, `agents()` listing, `mode: 'subagent'|'primary'|'all'`. **The `delegation` group already exists in this codebase — as a comment apologising for not having it.**
- **A04 gemini — has one, and it is UNGATED.** `SubagentTool`, `SubagentToolWrapper`, `AgentRegistry` in `@google/gemini-cli-core@0.38.2`, with real tool names `codebase_investigator`, `cli_help`, `generalist`, `confucius` — **none of them in `GEMINI_TOOL_GROUPS`** (`src/adapters/gemini.ts:210-226`). A `file-read` deny on gemini therefore leaves a read-capable subagent tool registered: **the exact laundering hole opencode closes, open on A04 today.** This is a live defect, not a design question (E24).
- **A02 codex — genuinely none.** `ThreadOptions` has no per-tool or per-bucket field at all; the `ThreadItem` union has no task/subagent variant. `none → throw` is the honest cell, and codex already throws pre-dispatch for a group it cannot express (`codex.ts:162-166`).

So `delegation` is a **three-of-four-adapter** concept with one real strength per adapter and **no unverified cells** — which dissolves §5's second open decision entirely. Cost is unchanged and now clearly worth paying: `<index>`'s M18 scope cell, M18 `Purpose` + L1, the L2 matrix (A01 `soft`, A02 `none → throw`, A03 `hard`, A04 `soft`), the L3 preset registry (`planMode` must **not** include it), and a semver note under M12.

**TaskOutput / TaskStop — the contradiction is sharper than the plan thought, and it resolves the other way.** The first version proposed leaving the task inspector unclassified. Source forbids that: per the SDK alias map, `BashOutput` → **`TaskOutput`** and `KillBash`/`KillShell` → **`TaskStop`**. The adapter's `shell` group already denies all three legacy spellings (`claude-code.ts:167-168`), i.e. **it already classifies these tools as `shell` — under names the SDK no longer uses.** Leaving `TaskOutput`/`TaskStop` ungated would not resolve a contradiction; it would create one, gating a tool under its old name and exempting it under its new one. The correct resolution is the opposite of the first draft's: **name the canonical spellings in the `shell` group** (E25), and keep M18's `shell` definition — *including background-process inspection* — as it stands. The concern that motivated the draft (a delegation-only run losing the ability to read its subagents' output) is real but belongs to the `delegation` group's own semantics, not to an exemption.

<!-- anchor: 7hitg74l -->
### (d)+(e) Peer and team messaging — documented capability gap with a pinned default

**Decision: inbound cross-session ingress is not in scope as a capability, and not a new module — but the argument has to be restated, because verification falsified half of it.**

**What was wrong.** The first version argued "no cross-adapter contract exists to specify: codex, opencode and gemini have no equivalent". For **outbound agent-to-agent messaging** that is false: `@google/gemini-cli-core` ships `A2AClientManager.sendMessageStream(agentName, message, …)` over `@a2a-js/sdk`, and `@opencode-ai/sdk` ships `session.prompt({ agent })` plus `AgentPartInput { type:'agent', name }`. Two of four adapters can address a named agent by message.

**What survives, and it is the load-bearing half.** The boundary that holds is not *messaging* — it is **inbound cross-session ingress**: a turn this process did not initiate, arriving from another session on the machine. Nothing in codex, opencode or gemini has that. So:

1. **Outbound** agent-addressed messaging is a real cross-adapter shape and belongs in a future round, alongside `delegation` (c2) — recorded as an open question, not specified here.
2. **Inbound cross-session ingress** is one-adapter and unprobed, and specifying an unprobed shape is what L7's *declared range == verified range* discipline exists to prevent.
3. **`M19` is spoken for** — `<index>` `0aj92zki` OQ7 pencils it for the self-scheduling loop.

**The security default — now verified, and the mechanism corrected.** The mode-parity behaviour is documented verbatim in the SDK (§2/4): unset, a message auto-delivers **when the sending session's permission-mode class matches**, so a `bypassPermissions` library run auto-accepts inbound turns from any other bypass session on the machine. For an embedded library that is unauthenticated ingress into a consumer's process through a default they never chose. The adapter must pin `'refuse'`.

**But not the way the first version said.** `crossSessionInbound` is a **`Settings`** key, not an `Options` key (§2/A). The pin goes through **`Options.settings`**, and that has a concrete integration constraint the entry must carry: the adapter **already** writes `options.settings = { permissions: { allow, deny } }` inside the soft path-scope branch (`claude-code.ts:1336`) and narrows `options.settingSources = ['project','local']` under path-scope (`claude-code.ts:1302-1306`). The pin must **merge into** that object and must be set on **every** run, not only when path-scope is requested. `Options.managedSettings` is the wrong channel: it is *"filtered restrictive-only — non-allowlisted keys are dropped regardless"*, so the pin could vanish without an error.

**And one thing the boundary gains from verification.** `SDKMessageOrigin` (§2/E) makes the boundary **decidable** rather than merely asserted: `{kind:'peer'}` carrying `senderTaskId` is an **in-process subagent** (M06, in scope); `{kind:'peer'}` without it is a cross-session peer (out of scope); `{kind:'task-notification', subkind:'peer-send-message'}` is a coordinator co-member delivery (out of scope). The scope sentence can therefore name a discriminator instead of drawing a line in prose.

**Placement:** the pin and its reasoning → `A01#sw3cwrsm`. The auditability → `M14#0tycjmv6`. The scope boundary → `M06#70dpqgcb` (one clause) and `A01#c4qvzzks`. The promotion question → `<index>` OQ9.


---

<!-- anchor: bskaa375 -->
#### (d2) The OUTBOUND half — added 2026-09-22 after the live `ListAgents` probe

**The first two versions of this plan described one direction of a two-directional problem.** The `ListAgents` probe (SDK 0.3.263, `listagents.log`) shows that a programmatic `query()` run **registers itself as an addressable peer session** and is handed a listing of every other Claude Code session of the same user — by name, short id, kind and state:

```
This session is probe-fa [edfb82] — the name other sessions use to message it…
Subagents (1):
  aaa01138af701fc55 · general-purpose · running · started 1s ago
Peer sessions (8):
  claude-code-adapter-messaging [6aee91] · interactive · busy · started 13h ago
  …
```

So an embedded library run — a customer's agent started by the consumer's application — can **enumerate the developer's interactive sessions and `SendMessage` a prompt into them**. That is prompt injection *out of* the sandboxed run and *into* a human's session, and `crossSessionInbound: 'refuse'` does nothing about it: that option governs only what arrives.

**Two consequences, and they pull against each other.**

1. The obvious mitigation — drop `SendMessage` / `ListAgents` from the allow-list — is **exactly what (c1) and E14b forbid**, because the same tool is how the model re-enters its own subagent. `SendMessage({to})` is one tool serving two audiences, and **no tool-name-level gate can separate them**. Nor can a `delegation` `ToolGroup`: denying it closes re-entry too.
2. Nothing in `Options` or `Settings` disables *sending* alone. `isolatePeerMachines` only requires approval for reaching a peer on **another machine** via Remote Control; same-machine peers are untouched.

**The seam that does separate them is `canUseTool`**, which receives `(toolName, input)` before execution (`sdk.d.ts:209`). The adapter already installs it — but **conditionally**, only when a user-input handler is present, and it currently allows everything except `AskUserQuestion` (`src/adapters/claude-code.ts:1483-1531`). The adapter also already holds the set of task ids this run started (`TaskRegistry`), which is precisely the predicate needed. See **E26**.

**This also reframes the M14 touch.** `ListAgents`' listing carries the names of the consumer's unrelated sessions into the model's context. Whether that is an audit/redaction concern or merely noise is a question M14 can answer; it is recorded here rather than folded in.

<!-- anchor: yolc1unt -->
### (f) A01 edge cases + e2e

Edge cases get the runtime facts; coverage gets one extended row plus one new one; the L7 log gets the probe findings appended to the **existing** `0.3.263` row.

---

<!-- anchor: 6zohygbv -->
## 4. Entries — in execution order

Layer files and `<index>` first, then modules, then the adapter, then entities. No layer file changes: every schema this touches already has the field the change answers.

**Three preconditions, before entry 1.**

1. **Settle (c2).** Six things are gated on it — E1, the second half of E9, E10, E11, clause (c) of E3's open question, and the two gated criteria in E23. The plan cannot be started without the answer, so it is a precondition rather than an open question to be discovered halfway through.
2. **Sweep the corpus for the re-keyed phrase.** `search_pages({ regex: "at most once per", mode: "hits" })` before E6 and E19. The phrase was confirmed present in M06 and M12 and nowhere else *that was looked at*; the other 28 pages were never swept, and one missed occurrence leaves the old one-cycle contract alive on a page nobody re-reads.
3. **Copy every literal `find` string out of the live page, never out of this plan.** Several sections carry markup this plan's prose flattens: in M18 `4j6f86yq` the fail-closed sentence and the word `*including*` in the `shell` definition are italicised; in A01 `49zu34oc` the pin cell backticks each version separately; in M06 `70dpqgcb` the bold span closes after the period. The strings in E7 and E16 have been corrected against the source — everything else here is quoted for reading, not for matching.

<!-- anchor: s58ooubi -->
### E1 — `<index>` `0kaqumsu` (Modules table) — *only if (c2) is accepted*

Rule 3 / `<index>` canon. In the **M18** row's *Scope* cell, change "four engine-neutral `ToolGroup`s" → "five engine-neutral `ToolGroup`s". **No longer conditional** — (c2) is required (§3c). No other cell changes.

<!-- anchor: rxk4jvdt -->
### E2 — `<index>` `vancl72m` (Key relations)

Append two lines to the existing ASCII relation block, in the style of the lines already there:

```
M06 Subagents ── re-entry holds via ──> M17 Background tasks (a resumed subagent re-enters the in-flight set; the hold re-arms)
M18 Tool gating ── must preserve ──> M06 Subagents delegation tools (a deny of one group must not remove the ability to delegate)
```

<!-- anchor: jj75fcn8 -->
### E3 — `<index>` `0aj92zki` (Open questions) — new item 9

Verbatim, appended after item 8:

> 9. **Agent-to-agent messaging (`SendMessage` / `ListAgents`) — scoped out of the contract, deliberately.** The Claude Agent SDK ships one tool with three uses: continuing a subagent this run spawned (**in scope** — specified as subagent re-entry, M06/A01), messaging agent-team teammates, and messaging cross-session peers including **inbound** turns this run did not initiate. The last two are **not** in the unified contract: no other adapter (codex, opencode, gemini) has an equivalent, so an `agentMessaging` capability flag would be a one-adapter flag with nothing to degrade to, and the SDK surfaces it would rest on — the user-message origins `{kind:'peer', from, fromMode, verifiedPeerPid}` and `{kind:'task-notification', subkind:…}`, plus `isolatePeerMachines` — are **typed but not probed**, which L7's *declared range == verified range* discipline forbids specifying. A01 therefore pins `crossSessionInbound: 'refuse'` and reports it on `adapter_ready` (<section_ref anchor="sw3cwrsm"/>). Open: (a) whether inbound peer turns should ever surface as a `UnifiedEvent` — most likely an `origin` discriminator on `user_message` rather than a new variant; (b) whether the pinned `'refuse'` should become a consumer-settable `claude_crossSessionInbound` ArchOption, which would make it an L3 key and a resume-immutable field (M07); (c) whether `delegation` becomes a fifth `ToolGroup` if that was declined in the M18 round. Probing the peer surfaces against a live second session is the precondition for any of the three.

*(Drop clause (c) from the above if (c2) is accepted.)*

<!-- anchor: yhxmr77b -->
### E4 — `modules/M06-subagents.md#70dpqgcb` (Purpose) — scope paragraph
`append` to the existing "**Scope — real subagents only.**" paragraph — note the bold span closes **after** the period, which the first draft transcribed without.

**Budget constraint, and it changes the entry.** The section holds **1102 of its 1200-character budget**: roughly 98 characters of room, against a first-draft sentence of ~230. The scope clause must therefore be one clause carrying no reason:

> Teammates and cross-session peers are not subagents (<index> OQ9).

Measure the final string before writing; if it still does not fit, drop the parenthetical and let E6 carry the boundary alone. The full statement — that such an agent emits no lifecycle here and is out of the unified contract entirely — moves to M06's edge cases (E6), where it is a situation→behaviour bullet rather than scope prose, and where there is room for the reason.
<!-- anchor: osesz7mq -->
### E5 — `modules/M06-subagents.md#0f6287ae` (Unified Contract, L1) — the identity guarantee

L1 schema field answered: *"any field it contributes, each stated with the guarantee that field carries"* (`layers/L1-unified-contract.md#yc5ftl18`).

`append` to the existing bullet list:

- **`taskId` identifies the agent; `toolUseId` identifies the invocation.** An SDK that lets the model re-enter a helper it already spawned (Claude Code's `SendMessage` against a backgrounded `Agent`) produces a **second** `subagent_started` carrying the **same `taskId`** and a **new `toolUseId`** — the id of the tool call that re-entered it — closed by its own `subagent_completed`. A `taskId` is therefore not a guarantee of a single open/close bracket, and a consumer must not treat a second start for a known `taskId` as a duplicate.
- **`subagent_started.resumed?: boolean`** — `true` on every start after the first for a given `taskId`, absent otherwise. It exists because the signal is **not derivable downstream**: the re-entered agent's deltas keep resolving `subagentTaskId` from the **original** spawn's tool-use id, so a consumer grouping by `taskId` (M09's `splitBySubagent`) would see a closed bucket reopen with nothing on the stream to explain it.
- **Ordering guarantee.** A `subagent_started { resumed: true }` never precedes the `subagent_completed` of the cycle it re-enters — re-entry follows settlement, so the pairs nest not at all and sequence cleanly.

<!-- anchor: zbn53yzl -->
### E6 — `modules/M06-subagents.md#4b8iv50p` (Edge cases)
One `textEdit` and three new bullets. **The re-key proposed in the previous version is withdrawn** (§3a): the code's guard is per-`taskId` by construction and per-run, so "at most once per `taskId`" is accurate. What the section needs is a scope clause, not a new key.

1. **Disambiguate the synthesis rule instead of re-keying it.** Find ``at most once per `taskId` `` → replace with ``at most once per `taskId` **per termination** — the synthesis fires once, at teardown, over the tasks still unpaired at that moment; across a whole run one `taskId` may legitimately carry more than one lifecycle pair (<section_ref anchor="0f6287ae"/>)``.

2. **Amend the rationale sentence that (a) invalidates.** The section justifies synthesis with: "a consumer grouping deltas by `subagentTaskId` has **no other signal that the bucket ever closed**…". Append after "ever closed": `, and — once a `taskId` may carry a second cycle — no signal that a closed bucket may legitimately reopen, other than the `resumed` marker on the new start (<section_ref anchor="0f6287ae"/>)`.

3. Three new bullets:

> - The model re-enters a backgrounded subagent mid-run (`SendMessage`) → a second `subagent_started { taskId, toolUseId: <the re-entering tool call>, resumed: true }`, its own `subagent_completed`, and the session held open until it reports (M17 — <section_ref anchor="01or0cpk"/>). A consumer that keyed a map on `taskId` alone and asserted single-entry sees the second start as a contract violation; it is not, which is why the marker is on the event rather than left to be inferred.
> - Termination fires between a subagent's settlement and its re-entry → nothing is synthesized: there is no unpaired start. The `taskId` simply never sees its second cycle.
> - An agent-team teammate or a peer agent in another session addresses this run → it is not a subagent: no `subagent_started`, no `subagent_completed`, nothing on the unified stream, and no capability flag advertises it (<index> open question 9). The engine-side discriminator is that an in-process subagent's message carries a sender task id while a cross-session peer's does not; `subagent_*` covers only agents **this run spawned**.

<!-- anchor: 1hz8ej1u -->
### E7 — `modules/M17-background-tasks.md#01or0cpk` (Unified Contract, L1)
`edit` the hold-obligation sentence. **The first draft's `find` string does not exist** — it bolded a fragment the source leaves unbolded. Verified source text:

> While the engine holds the session past a turn's `result` — for background work *or* for a subagent that outlives the turn — the adapter MUST keep its input/control channel to the engine open.

Find the literal `for background work *or* for a subagent that outlives the turn` (single asterisks around `or`, nothing else emphasised) and append after it: `, **including a subagent the model re-enters after it already settled** (M06 — <section_ref anchor="0f6287ae"/>): re-entry returns that `taskId` to the tracked set`.
<!-- anchor: c5nu1yu3 -->
### E8 — `modules/M17-background-tasks.md#q9u5sbot` (Edge cases)

`edit` the "Deciding whether to hold" bullet — after "the hold takes the union", append:

> A `taskId` that has already been marked *finished* and then sees a second `task_started` **re-enters** the set and **re-arms both bounds**, because the alternative is the failure this section exists to prevent: grace is armed the moment everything tracked has settled, which is exactly the window between a subagent settling and the model re-entering it, and grace expiry closes the control transport.

**Plus one new edge-case bullet**, from the sub-case verification found (§3b): re-entry is only safe once the previous cycle has fully **settled**. The engine reports finishing twice — a `task_updated` patch first, the `task_notification` after — and only the second clears the finished mark. So:

> - A second `task_started` arrives for a `taskId` that the engine has already patched as finished but has **not** yet notified → the id is in the tracked set *and* still carries the finished mark, so "everything tracked has settled" reads true while a live cycle is running. Re-entry must clear the finished mark as well as re-adding the id; otherwise grace arms inside the re-entered cycle.

This is the one behaviour in (b) that is **not** already implemented — the rest of the entry codifies what the registry does today.

<!-- anchor: tupqkdly -->
### E9 — `modules/M18-tool-gating.md#4j6f86yq` (Unified Contract, L1)
**(c1), required.** `append` to the "Contract semantics" list, directly after the residual-allow-list bullet. This is an append, so no literal matching is involved — but do **not** key an edit on the fail-closed sentence or on the `shell` definition quoted here: both are italicised in the source.

> - **Fail-closed applies to the unknown, not to the unclassified.** The invariant above is about a built-in the library has *never heard of*. A built-in the library **does** know, which carries no capability of any denied group, **is preserved** in the residual allow-list — a deny removes a class of capability, never an unrelated tool that merely shares a construction pass with it. Delegation and task-tracking tools are the standing instances: denying `file-write` must not cost the run its ability to plan, and denying any group must not cost it its ability to delegate or to continue a helper it already spawned.
> - **The rule runs on an inventory, and the inventory is part of the contract.** "Carries no capability of any denied group" is only decidable against a list of the built-ins the library knows, under every current alias, **including the deferred ones no published catalog advertises** (<section_ref anchor="49zu34oc"/>). A built-in absent from that list is, by the invariant above, *unknown* — and therefore blocked. An allow-list built from a hand-kept list therefore fails closed **on every tool the library was never asked to gate**, which is a different failure from the one the invariant intends, and it grows with every SDK release. Keeping the inventory current is a schema-drift obligation (L7), not an implementation detail.

**Write the second bullet with the measured number in it, not as a hypothetical.** At the current pin the adapter's inventory knows 24 names against a published catalog of 45, and the 29-name shortfall is what the reported `SendMessage` symptom is one instance of (§2/B). The entry is stronger, and far harder to quietly drop at review, when it says so.

**(c2), required.** Also edit the type line and add a fifth definition. The type line is verbatim in both `spec/modules/M18-tool-gating.md:42` and `src/tool-groups.ts:55`, so this `find` is safe:

- `type ToolGroup = 'shell' | 'file-read' | 'file-write' | 'web' | 'delegation'`
- **delegation** — spawning, listing or messaging a helper agent: the subagent-spawning tool under every alias (`Task`, `Agent`), and the tools that continue or enumerate one (`SendMessage`, `ListAgents`, and `ListAgents`' current alias `ListPeers`). Denying it is how a consumer closes the delegation escape surface outright rather than relying on deny-propagation into each definition — and it is what stops a spawned helper from laundering a read the parent just denied. Semver: widening a normative union type — **minor** for producers, but consumers exhaustively switching on `ToolGroup` break, so M12 classifies it.

<!-- anchor: vc7w89t9 -->
### E10 — `modules/M18-tool-gating.md#1yllld10` (Capability & Degradation, L2) — *only if (c2) accepted*
Add a `delegation` column to the support matrix. **No cell is unverified — the previous version's blocker is dissolved** (§3c); every strength below was read out of the installed SDKs on 2026-09-22.

| Adapter | `delegation` | Evidence |
| --- | --- | --- |
| A01 claude-code | `soft` | removed from the constructed catalog; a built-in subagent type the SDK spawns on its own is outside that reach |
| A02 codex | `none → throw` | `ThreadOptions` has no per-tool or per-bucket field; `ThreadItem` has no subagent variant. Consistent with its existing `shell`/`file-read` cells, and codex already refuses pre-dispatch |
| A03 opencode | `hard` | server-side `task` permission bucket, confirmed against the running server; today folded into `file-read` (`src/adapters/opencode.ts:118-124`) and moved to its own group by this entry |
| A04 gemini | `soft` | `excludeTools` is deny-only; the subagent tool names (`codebase_investigator`, `cli_help`, `generalist`, `confucius`) must be added to the group table — see E24 |

**A03 carries a rule, not just a cell — SETTLED, route (b).** Moving `task` out of `file-read` into `delegation` would, on its own, *weaken* opencode: today a `file-read` deny also closes delegation, deliberately, so that a spawned helper cannot read what the parent was denied. The decision is to **keep that guarantee as an adapter-local implication**: on opencode, denying `file-read` also denies `delegation`. Write it into the L2 section as a stated rule of this adapter, not as a footnote — and state the cost with it, because it is real: **on opencode the groups are not strictly orthogonal.** That is a fact about a server-side permission model whose buckets are coarser than our vocabulary, which is exactly what L2 exists to record; it is not a defect in the unified vocabulary and must not be repaired by making the implication universal (that would cost plan-mode runs their research subagents — criterion 20). A consumer reading the matrix must be able to learn this without running the adapter.

Also append to **Escape surfaces**, under the existing `A01 shell` bullet: propagation into subagent definitions closes the shell escape, but the delegation tools themselves are what create the subagent, so a consumer wanting no delegated execution at all denies `delegation` rather than relying on propagation.

<!-- anchor: a34svpay -->
### E11 — `modules/M18-tool-gating.md#c0b6eyl5` (Configuration & Extensibility, L3) — *only if (c2) accepted*

One sentence in the **Preset registry** bullet: `planMode` remains `['file-write', 'shell']` and deliberately does **not** include `delegation` — plan mode must still be able to delegate research.

<!-- anchor: goo71oyn -->
### E12 — `modules/M18-tool-gating.md#kztplcjf` (Edge cases)

**The previous version's bullet is WITHDRAWN and replaced by its opposite** (§3c). It proposed leaving `TaskOutput` / `TaskStop` unclassified. Source shows those are the **canonical names of tools the adapter already denies under `shell`** via their legacy spellings `BashOutput` / `KillBash` / `KillShell` (`src/adapters/claude-code.ts:167-168`, SDK alias map in §2). Exempting them would gate one tool under its old name and exempt it under its new one.

New bullet, recording the resolution the alias map forces:

> - A task inspector or stopper is one tool under several names: the SDK canonicalises `BashOutput` / `AgentOutput` / `BashOutputTool` / `AgentOutputTool` → `TaskOutput`, and `KillBash` / `KillShell` → `TaskStop`. It is classified as **`shell`**, consistent with `shell`'s definition naming background-process inspection — and an adapter naming only some of those spellings gates the tool under one name while leaving it reachable under another. The consequence a consumer must know: a run that denies `shell` cannot read its subagents' task output either, because the inspector is one tool serving both. A run that wants delegated work but no shell denies `shell` and accepts that; a run that wants neither denies `shell` and `delegation`.

<!-- anchor: bir2pep5 -->
### E13 — `adapters/A01-claude-code.md#mn3ytsj4` (Event mapping, L1)

`edit` both map sentences so each states its re-entry behaviour. **The second bullet is corrected — the previous version described the code backwards.**

- `Map<task_id, task_type>`: a second `task_started` for a known `task_id` **refreshes** the entry. This is what the adapter already does (`kindById.set(taskId, kind)` on every start, `claude-code.background-hold.ts:190`); a `task_type` that changed between cycles is a schema-drift signal, not a routing decision to smooth over.
- `parent_tool_use_id → task_id`: the adapter writes this map on **every** `task_started` that carries a `tool_use_id` (`if (toolUseId) subagentTaskIdByParentToolUseId.set(toolUseId, taskId)` — `claude-code.ts:2363`), so a re-entry **does** add a second key pointing at the same task. The previous version asserted the opposite and prescribed suppressing it; that would be a code change dressed as a description. The fact worth writing is why the extra key is harmless: the resumed agent's assistant messages keep carrying the **original** `Agent` tool_use id, so the original entry is what resolves `subagentTaskId` and the new key is never read. Attribution therefore survives re-entry without special handling — which is the guarantee M06's `resumed` marker leans on.

<!-- anchor: fbsy893s -->
### E14 — `adapters/A01-claude-code.md#sw3cwrsm` (Per-capability consumption)

Three additions. Every mechanic below is now marked **[source]** (re-verified against `node_modules` on 2026-09-22) or **[probe]** (a transcript this thread still could not confirm, because the SDK package ships no CLI — see §2).

**14a — under the Subagents (M06) bullet**, the re-entry mechanics:

> - *Re-entry (`SendMessage`).* The `Agent` tool result instructs the model to continue a backgrounded helper with `SendMessage`, and the SDK backgrounds `Agent` by default at this pin **[source: `AgentInput.run_in_background` — "Agents run in the background by default"; `AgentInput.name` — "Makes it addressable via `SendMessage({to: name})` while running"]**, so this is the ordinary path. The tool result is `{ success: true, message: 'Resuming agent …', resumedAgentId }` **[probe]**. The SDK then emits a **new** `system` `task_started` with the **same** `task_id`, `tool_use_id` = the `SendMessage` tool-use id, `is_backgrounded: true` **[source: `SDKTaskStartedMessage.is_backgrounded` — "A resumed subagent is always registered in the background"]**, and `prompt` = the new message. The resumed agent's assistant messages carry `parent_tool_use_id` = the **original** `Agent` tool-use id **[probe]**. A second `task_updated` (`completed`) and `task_notification` follow, and the session is held open until it reports (M17 — <section_ref anchor="01or0cpk"/>). `task_started` carries **no** `resumed` field, so the marker is adapter-derived from "this `task_id` has been seen before" **[source]**. The adapter maps this to a second lifecycle pair with `resumed: true` (M06 — <section_ref anchor="0f6287ae"/>).

**14b — under the Tool gating (M18) bullet.** This bullet **also corrects an existing understatement**: the section currently says the allow-list keeps "the task-tracking family plus the `ToolSearch` discovery gate… whenever writes are denied". The adapter in fact preserves nine names — `TodoWrite`, `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`, `ToolSearch`, `AskUserQuestion`, `Task`, `Agent` — **unconditionally under any deny** **[source: `CLAUDE_CODE_UNGATED_BUILTINS`, `claude-code.ts:198-204`, applied at `:230`; test "keeps task-tracking and delegation available under any deny"]**. Fix that sentence first, then add:

> - *The allow-list must carry the delegation family, and the inventory must be complete.* The adapter builds `options.tools` — the SDK's **base set of available built-in tools**, a replacement rather than a filter **[source]** — from a hand-kept inventory whenever any deny-group is set. At this pin that inventory names 24 built-ins against a published catalog of 45, so 29 catalogued tools are removed by a deny that has nothing to do with them, `TaskOutput` and `TaskStop` among them **[source]**. `SendMessage` and `ListAgents` (current alias `ListPeers`) are worse than merely missing: they appear in **no** published SDK list at all — the model reaches them through the discovery gate — so an inventory derived from what the SDK advertises would still omit them. The rule is M18's general one (<section_ref anchor="4j6f86yq"/>); the adapter-side obligation is that the inventory is maintained by hand, audited on every pin bump, and names every alias the SDK canonicalises.

**14c — new bullet, the peer-messaging boundary and its pinned default.** Corrected: the key is on `Settings`, not `Options`.

> - **Cross-session ingress (out of scope — pinned, not ignored).** The same `SendMessage` tool also addresses agent-team teammates and peer agents in other sessions (local, Remote Control, cloud). `crossSessionInbound` (`'accept' | 'hold' | 'refuse'`) governs turns arriving **inbound** and is a **`Settings`** key, not a query option **[source]**. Left unset it follows **mode parity** — *"a message auto-delivers only when the sending session's permission-mode class matches yours (bypass↔bypass or prompting↔prompting)"* **[source, verbatim]** — which means a `bypassPermissions` library run auto-accepts inbound turns from any other bypass session on the machine: unauthenticated ingress into a consumer's process through a default they never chose. The adapter therefore **pins `crossSessionInbound: 'refuse'` on every run, via `options.settings`** — merged into the object the soft path-scope branch already writes there, and set whether or not path-scope was requested. **Not** via `managedSettings`, which is filtered restrictive-only and would drop a non-allowlisted key silently **[source]**. The pinned value is reported in the `adapter_ready` `sdkConfig` (M14 — <section_ref anchor="0tycjmv6"/>); `isolatePeerMachines` is left at the SDK default. There is no config key to re-open it: a library embedded in someone else's process is not the layer that should be deciding to accept traffic from another. Outbound team/peer sends are neither blocked nor specified — they emit no `UnifiedEvent` and no capability flag advertises them (<index> open question 9).


---

**Probe status update — 2026-09-22.** The two mechanics marked **[probe]** above were run live against SDK 0.3.263 (model `claude-sonnet-5`, local OAuth, ~20–40 s per run; logs `plain.log` / `gated.log` / `dontask.log`). Both are **confirmed**, so 14a should be written as verified, not as a transcript awaiting confirmation:

- **The `SendMessage` tool result** is `{"success":true,"message":"Resuming agent <short>","resumedAgentId":"<task_id>","pin":{"id":"<task_id>","name":"<task_id>","ref":"<6-hex>"}}`. The `pin` object was not in any earlier draft — include it or omit the field entirely, but do not write a shape that is missing a key the SDK sends.
- **The second `task_started` carries the same `task_id` and the `SendMessage` tool-use id**, `is_backgrounded=true`, and `prompt` = the new message — exactly as 14a states.
- **The resumed agent's deltas keep `parent_tool_use_id` = the original `Agent` tool-use id**, which is what E13's second bullet and criterion 6 rest on. Confirmed.
- **The model reaches `SendMessage` through `ToolSearch`** (`{"query":"select:SendMessage"}` → `[{"type":"tool_reference","tool_name":"SendMessage"}]`), confirming the deferred-tool claim in E16.
- **The gated run reproduces the defect exactly, and corroborates the count.** With the explicit `options.tools` list the adapter builds, `system:init` reports `SendMessage: false, ListAgents: false, ToolSearch: true, n=24` — **the same 24 that the source sweep counted in the adapter's inventory** (§2/B) — `ToolSearch` answers *"No matching deferred tools found"*, and the run ends with *"There is no SendMessage tool available in this environment… it does not exist among the available or deferred tools."* The soft-path-scope run (`dontAsk`, no allow rule) keeps both tools and resumes normally.

**Vendor the probe.** The script should live in the repo beside the e2e suite as a diagnostic, so the L7 obligation in E16 is executable at the next pin bump rather than re-derived. It needs no API key (local OAuth).

**14d — new bullet, the outbound direction** (§3d2):

> - **Outbound peer messaging (gated, not merely unspecified).** A `query()` run registers as an **addressable peer session**: `ListAgents` returns this run's own peer name plus every other session of the same user, and `SendMessage({to})` can inject a prompt into any of them. An embedded library must not be able to drive its host's interactive sessions, and no SDK option turns off sending alone. Because the same tool also re-enters this run's own subagents, the gate cannot be the tool list — it is an input predicate on `canUseTool`: a `SendMessage` whose `to` resolves to a task this run started is allowed; any other `to` is denied with a message saying so. `ListAgents` is allowed but its listing is the consumer's session inventory, which the run has no business carrying (M14 — <section_ref anchor="0tycjmv6"/>).

<!-- anchor: 05v782ra -->
### E15 — `adapters/A01-claude-code.md#c4qvzzks` (Capability support & degradation, L2)

One sentence: agent-team and cross-session peer messaging are **not** declared capabilities in either direction; no `architectureCapabilities` flag covers them and no degradation applies, because no other adapter has an equivalent to degrade from.

<!-- anchor: j0ekgm6v -->
### E16 — `adapters/A01-claude-code.md#49zu34oc` (SDK compatibility & schema drift, L7)
**Append to the findings cell of the existing verified-pin row** — same pin (`package.json` dev-pin `^0.3.251`, `node_modules` resolves 0.3.263), so no new row. The row is identified by the cell text `` `^0.3.251` (resolved `0.3.263`) ``: **each version is wrapped in its own backticks**. The findings cell already numbers (1)–(5), so 6+ continue it.

**Every finding below is now source-verified**, except (9), which stays a probe transcript and is marked as such:

> (6) `Agent` is backgrounded by default at this pin (`AgentInput.run_in_background`), and a resumed subagent is always re-registered in the background (`SDKTaskStartedMessage.is_backgrounded`). (7) `task_started` carries no `resumed` discriminator, so a second cycle is recognised only by a `task_id` already seen; the two id maps diverge here (<section_ref anchor="mn3ytsj4"/>). (8) The SDK's published tool-input schema set names 45 built-ins; the adapter's inventory names 24, so 29 catalogued tools — `TaskOutput`, `TaskStop`, `Monitor`, `Workflow`, `Artifact`, `ReportFindings`, the MCP-resource family and others — fall out of `options.tools` under any deny. `SendMessage` / `ListAgents` appear in **no** published list; `ToolSearch`, which the adapter already whitelists, appears nowhere in the SDK package either, while being live in the CLI. (9) *[probe, not re-confirmed]* Under an explicit `options.tools` allow-list the model reports "no `SendMessage` tool"; under soft path-scope alone it survives.

**The SDK package ships no CLI.** `manifest.json` names a ~199 MB native `claude` binary (`2.1.263`, commit `37ae3f38`) fetched separately, so tool-result strings and live symptoms are **not** verifiable from `node_modules` at all. Record that in the L7 section: it bounds what a source sweep can ever confirm for this adapter, and it is why (9) cannot be promoted without a live run.

Also add to **Known schema-drift points**, three items:

- **The delegation family is deferred** — `SendMessage`, `ListAgents` and its alias `ListPeers` are reachable only through the discovery gate. A tool absent from the catalog is not a tool absent from the run, so allow-list construction must name deferred tools explicitly rather than derive the list from what any catalog advertises. Same obligation as (c1)'s inventory (<section_ref anchor="4j6f86yq"/>), seen from the drift side.
- **The SDK canonicalises tool names, and the map is the authority on "every current alias":** `Task`→`Agent`, `ListPeers`→`ListAgents`, `KillBash`/`KillShell`→`TaskStop`, `BashOutput`/`AgentOutput`/`BashOutputTool`/`AgentOutputTool`→`TaskOutput`, `ListMcpResources`/`ReadMcpResource`/`ReadMcpResourceDir`→ their `…Tool` spellings. The adapter's group tables currently name only the legacy side of the last two families (E25).
- **The inventory drift is measurable and should be measured at every bump:** the check is the set difference between the SDK's published tool-input schemas and the adapter's known-built-in list, plus the deferred names that appear in neither.


**Findings promoted from probe to verified, and two added — 2026-09-22 live run on 0.3.263:**

Finding (9) above is **no longer a probe transcript**; rewrite it as verified, and add:

> (10) `ListAgents` returns **prose, not a schema**: `tool_use_result` is `{ "listing": "<text>" }`, whose body names this session's own peer identity (`<name> [<6-hex>]`), then an optional `Subagents (N)` block of `agentId · subagent_type · status · started X ago`, then `Peer sessions (N)` of `name [id] · kind · state · started X ago`. The subagent block is absent when none is running. **Nothing here is parseable by contract** — there are no fields and no schema, so no adapter behaviour may depend on its contents; it is a drift point precisely because a wording change would be invisible to every test. (11) A programmatic `query()` run is itself registered as an addressable peer session and is shown the user's other sessions, which is the outbound exposure E26 gates.

Add to **Known schema-drift points**: `ListAgents`' result is human-readable text with no schema. If a future round ever wants the subagent roster programmatically, the source is the `task_*` channel the adapter already consumes — never this string.

<!-- anchor: wvqkgo8d -->
### E17 — `adapters/A01-claude-code.md#677rc2wh` (Edge cases)

Five bullets, in the flat style of the section:

> - The model re-enters a backgrounded subagent with `SendMessage` → a second `subagent_started` for the same `taskId` with `resumed: true`, and the run does not end at the intervening `result`: the session is held until the resumed agent reports. A consumer keyed on one lifecycle pair per `taskId` must be prepared for a second.
> - A deny-group is set and the model tries to continue its own subagent → it must still be able to. The `options.tools` allow-list the deny triggers carries `SendMessage` and `ListAgents` (with its alias `ListPeers`); without them the model reports "no `SendMessage` tool" and the delegation it already started is stranded — visible only as prose, never as an error.
> - A deny-group is set and the model reaches for any built-in the adapter's inventory does not name → it is blocked, whatever that tool does. `options.tools` replaces the SDK's base tool set rather than filtering it, so the inventory's completeness, not the deny's scope, decides what survives. This is the same failure as the bullet above, one level up from its first reported instance.
> - A `task_started` re-arrives for a `task_id` whose entry was already marked finished → the entry re-enters the in-flight set, both hold bounds re-arm, the finished mark is cleared, and the `task_type` map entry is refreshed rather than kept stale.
> - Another local session sends this run an inbound turn → it is refused, because `crossSessionInbound` is pinned to `'refuse'` through `options.settings`. Nothing reaches the model and nothing appears on the unified stream. Left unset the SDK would follow mode parity, and a `bypassPermissions` run would have accepted a turn from any other bypass session on the machine.


**Two further bullets, from the outbound probe (§3d2):**

> - The model calls `SendMessage` with a `to` that is not a task this run started → denied, with a message saying the run may only address its own subagents. The tool itself stays in the catalog, because the same tool is how the model re-enters a helper it spawned; the gate is on the argument, not on the name.
> - The model calls `ListAgents` → it succeeds and returns human-readable text naming this run's peer identity and the user's other sessions. Nothing in the adapter parses it, and no unified event is derived from it.

<!-- anchor: hzsdnywr -->
### E18 — `adapters/A01-claude-code.md#a01e2ecv` (e2e coverage, L5)
- **Edit** the `subagents` row's status to add the re-entry leg as **not implemented yet**, alongside the existing un-implemented soft path-scope leg. Verified current row: `` | `subagents` (+ consumer-defined subagent) | M06 | ⚠️ partial — lifecycle and the consumer-defined subagent are covered; the soft path-scope leg (a subagent asked to read outside the run's ceiling is refused) is not implemented yet | ``
- **No new row.** The first draft added one named `tool-gating (delegation survives a deny)`, which contradicts E19: every row name in this table is a scenario drawn from M12's canonical catalog (<section_ref anchor="xe2ecat1"/>), and E19 deliberately adds **no** new catalog scenario. Widen the existing `tool-gating` row's status instead — the delegation-under-deny leg is a leg of that scenario, marked `❌ not implemented`, proving the model can still continue its own subagent while a deny-group is active.
<!-- anchor: h5znrwe4 -->
### E19 — `modules/M12-conformance-release.md#xe2ecat1` (e2e scenario catalog, L5)

One `textEdit`, no new scenario — coverage is per-adapter, and the fact belongs to a scenario the catalog already names.

1. `subagents` row: append to "what it proves" — *and, where the SDK lets the model re-enter a backgrounded helper, a second lifecycle pair for the same `taskId` marked `resumed`, with the session held open until it reports (M06 — `0f6287ae`).*

2. **The `abort` row is left alone.** The previous version proposed re-keying its "at most once per `taskId`" to "per unpaired `subagent_started`". Withdrawn: the row describes the termination synthesis, whose guard is a `Set<taskId>` walked once per run (§3a), so the existing wording is exactly what the implementation guarantees. Changing it would make the catalog describe bookkeeping that does not exist.

<!-- anchor: 6aky5rr1 -->
### E20 — `modules/M14-audit-redaction.md#0tycjmv6` (Unified Contract, L1)

One clause on the `adapter_ready` bullet: where an adapter **pins** an SDK option the consumer cannot set — A01's `crossSessionInbound: 'refuse'` is the standing case — the pinned value appears in the redacted `sdkConfig`, so that a posture the consumer did not choose is at least one they can observe. This is the single M14 touch this change earns; message provenance and ingress policy are not M14's.

<!-- anchor: 0562kiau -->
### E21 — `modules/M09-stream-consumption.md#diq2em77` (Unified Contract, L1)

M09 was read after the first draft, and it should have been read before it: §3a justifies the `resumed` marker by what `splitBySubagent` would do, while §6 listed M09 as unread. Planning over an unread module is what the plan workflow forbids, and the module turns out to carry a real gap.

**What it says today.** `splitBySubagent` is M09's only subagent-keyed helper, described in one sentence — "`splitBySubagent(events)` partitions parent vs. per-subagent streams" — and the module's `## Dependencies` table delegates the identity semantics to M06 outright ("groups using `isSubagent` / `subagentTaskId`"). Its only related edge case (<section_ref anchor="mjon1di2"/>) covers a **missing** `subagentTaskId`, not a **repeated** one. Under (a), three readings of that one sentence become equally valid: append the second cycle to the existing bucket, open a second bucket under the same key, or treat the reopened bucket as M06's unpaired-start case. The schema slot already exists — L1 asks for each produced or read variant "stated with the guarantee that field carries" — so this is a content gap, not a structural one.

`append` to the `splitBySubagent` bullet:

> A `taskId` may carry more than one lifecycle pair (M06 — <section_ref anchor="0f6287ae"/>). `splitBySubagent` keys on `subagentTaskId`, never on the pair, so both cycles of a re-entered agent land in the **same** bucket, in stream order: the bucket is neither re-created nor split, and the resumed cycle's deltas are indistinguishable from the first cycle's by key alone. A consumer that needs the cycles apart reads the `resumed` marker on the starts inside the bucket.

<!-- anchor: qby1wt5z -->
### E22 — `modules/M09-stream-consumption.md#mjon1di2` (Edge cases)

New bullet, parallel to the existing `subagentTaskId: undefined` fallback:

> - `splitBySubagent` over a stream where one `taskId` closed and then re-opened (a `subagent_started { resumed: true }` after a `subagent_completed`) → one bucket carrying both cycles in arrival order. A consumer that treated the first `subagent_completed` as the bucket's terminator sees events arrive after it; the terminator is the **last** completed for that `taskId`, not the first.

**Checked and unaffected:** M08 folds per-event usage into a flat run total rather than per-`taskId` buckets, so a second cycle simply adds to the same total. **Unknown:** which modules depend *on* M09 — `module-dependency` is inactive, so the incoming half of its graph is unreachable and was derived only from M09's own table (M06, M08).
<!-- anchor: r3z0r8p3 -->
### E23 — Entity operations (`ac`)
`module-dependency` is inactive; only `ac` records are written. **Before creating anything:** run `list_tags` and confirm the tags below exist. Verified present on the records this entry updates: `m06`, `m06-edge`, `a01`, `m17`. **Unverified:** `m18`, `m18-edge`, `a01-edge`, `a04`, `m14`, `m09` — `tag_entity` creates a tag it does not find, so a typo becomes a silent second taxonomy rather than an error.

**Update 2 existing** — down from 4. **The two re-keyings proposed in the previous version are withdrawn** (§3a): `ac-no-subagent-started-is-ever-closed-by` and `ac-a-subagent-still-in-flight-when-abort` are **correct as they stand**, because the adapter's termination guard really is per-`taskId` and really does fire once per run. Leave both untouched.

| Slug | Current tags | Change |
| --- | --- | --- |
| `ac-the-claude-code-adapter-captures-task-ty` | `a01`, `m17` | add: a second `task_started` for a known `task_id` refreshes the map entry |
| `ac-subagent-attributed-events-carry-issubag` | `m06` | add: attribution survives re-entry, resolving from the original spawn's tool-use id |

Impact, checked: `ac-the-claude-code-adapter-captures-task-ty` renders in **two** places (`adapters/A01-claude-code.md#e3az4o5i` via `a01` and `modules/M17-background-tasks.md#02okhxqj` via `m17`), so its wording is read in both contexts. The other renders only at `modules/M06-subagents.md#o0e0wak5`.

**Create 21.** Criterion 14 of the previous version is **replaced by its opposite** (§3c); three are added from the source verification; the two "gated on (c2)" criteria are folded in, because (c2) is no longer optional.

| # | Title (draft) | tags | kind |
| --- | --- | --- | --- |
| 1 | A subagent re-entered mid-run emits a second `subagent_started` carrying the same `taskId` as its first. | `m06` | requirement |
| 2 | The second `subagent_started` carries the `toolUseId` of the tool call that re-entered the agent, not the original spawn's. | `m06` | requirement |
| 3 | Every `subagent_started` after the first for a given `taskId` carries `resumed: true`. | `m06` | requirement |
| 4 | The first `subagent_started` for a `taskId` carries no `resumed` marker. | `m06` | requirement |
| 5 | A `subagent_started { resumed: true }` never precedes the `subagent_completed` of the cycle it re-enters. | `m06` | requirement |
| 6 | A resumed subagent's deltas resolve `subagentTaskId` to the original spawn's `taskId`. | `m06` | requirement |
| 7 | A run terminated between a subagent's settlement and its re-entry synthesizes no closing event. | `m06-edge` | edge-case |
| 8 | An agent-team teammate or a cross-session peer emits no `subagent_*` event. | `m06-edge` | edge-case |
| 9 | A settled `taskId` that sees a second `task_started` returns to the in-flight set. | `m17` | requirement |
| 10 | A `taskId` re-entering the in-flight set re-arms both hold bounds. | `m17` | requirement |
| 10b | A `taskId` re-entering the in-flight set has its finished mark cleared, so a pending grace window does not arm inside the new cycle. | `m17` | requirement |
| 11 | A built-in carrying no capability of any denied group is present in the residual allow-list the adapter sends the SDK. | `m18` | requirement |
| 11b | Every built-in named in the pinned SDK's published tool-input schemas is present in the adapter's known-built-in inventory. | `a01` | requirement |
| 12 | The delegation tools are present in the `options.tools` allow-list the adapter builds whenever a deny-group is set. | `a01`, `m18` | requirement |
| 13 | With a deny-group active on claude-code, the model can continue a subagent it already spawned. | `a01`, `m18-edge` | edge-case |
| 14 | Denying `shell` denies the task inspector under both its canonical and its legacy spellings. | `m18-edge` | edge-case |
| 15 | The claude-code adapter pins `crossSessionInbound` to `'refuse'` on every run. | `a01` | requirement |
| 15b | The pinned `crossSessionInbound` survives alongside the path-scope permission settings the adapter also writes to `options.settings`. | `a01` | requirement |
| 16 | An inbound turn from another local session never reaches the model. | `a01-edge` | edge-case |
| 17 | An SDK option the adapter pins rather than the consumer setting it appears in the redacted `sdkConfig` on `adapter_ready`. | `m14` | requirement |
| 18 | `splitBySubagent` places both cycles of a re-entered subagent in a single bucket keyed on `subagentTaskId`. | `m09` | requirement |
| 19 | Denying the `delegation` group makes the subagent-spawning and agent-messaging tools unusable for the whole run under every current alias. | `m18` | requirement |
| 20 | `planMode: true` does not deny `delegation`, so a plan-mode run can still spawn a research subagent. | `m18` | requirement |
| 21 | Denying `delegation` on gemini excludes the subagent tool names, so a denied read cannot be laundered through a spawned agent. | `a04`, `m18` | requirement |

**Verification status of the criteria.** 1–11b, 14, 15, 19–21 rest on facts read out of source in this thread. 13 and 16 restate live runtime behaviour the SDK package cannot confirm (it ships no CLI — §2), so they are the two that must be earned by an e2e run rather than by a source sweep.

Run `analyze_ac_against_entities` after creation.

<!-- anchor: 1yyrtf2l -->
### E24 — `adapters/A04-gemini.md` — the ungated delegation primitive

**New entry, and it is a live defect rather than a design question.** `@google/gemini-cli-core@0.38.2` ships `SubagentTool`, `SubagentToolWrapper` and `AgentRegistry`, with real tool names `codebase_investigator`, `cli_help`, `generalist`, `confucius` — registered outside `ALL_BUILTIN_TOOL_NAMES`, the same pattern the adapter already calls out for the background-process tools. **None of them appears in `GEMINI_TOOL_GROUPS`** (`src/adapters/gemini.ts:210-226`), so a `file-read` deny on gemini leaves a read-capable subagent tool registered — precisely the laundering hole opencode closes by folding its `task` bucket into `file-read`. The adapter meanwhile already observes gemini subagents at runtime (`gemini.ts:764`, `:804-808`), so delegation demonstrably happens on this adapter today.

Three touches:

- **Tool gating (M18) section** — add the `delegation` cell (`soft`, per E10) and name the four subagent tool names as the group's gemini members, beside the existing group table.
- **Capability & degradation (L2)** — correct the warning text "gemini-cli-core has no subagent definition mechanism" (`gemini.ts:281-286`). `AgentRegistry` and `AgentDefinition` exist; what the adapter does not do is *define* one per call. The warning is a claim about the SDK, and at this pin it is false.
- **SDK compatibility & schema drift (L7)** — record that `excludeTools` is marked `@deprecated — Use Policy Engine instead` at this pin, and that `coreTools` / `mainAgentTools` / `allowedTools` and the Policy Engine (`PolicyDecision { ALLOW, DENY, ASK_USER }`) are the successor surfaces. This is also the only route by which gemini's `soft` strength could ever become `hard`, so it belongs in the verified-pin log rather than in a wish list.

<!-- anchor: qswxvkj9 -->
### E25 — `adapters/A01-claude-code.md#sw3cwrsm` — the `shell` group's alias drift

Small, and it falls straight out of the alias map (§2). The adapter's `shell` group names `Bash`, `BashOutput`, `KillBash`, `KillShell`. Three of those four are **legacy spellings** the SDK canonicalises to `TaskOutput` and `TaskStop`, and neither canonical name appears anywhere in `src/`. Under the *durability of the allow-list* discipline this section already states — *"it must track every current alias of a renamed or relocated built-in"* — that is a plain omission, and it is the same failure as the delegation one, sitting in a group the specification believes is fully covered.

Add to that bullet: the canonical spellings `TaskOutput` and `TaskStop` belong in the `shell` group beside the legacy ones, and the alias map the SDK ships is the authority for what "every current alias" currently means — an alias inventory kept from memory is how a gate silently stops firing.

<!-- anchor: NEWE26 -->
<!-- anchor: whby3kkk -->
### E26 — `adapters/A01-claude-code.md#sw3cwrsm` — the outbound gate on `canUseTool`

**New, and it is the second half of the security decision §3(d) only half-made.** `crossSessionInbound: 'refuse'` closes ingress. Egress — a library run injecting a prompt into the consumer's own interactive sessions — is closed by nothing today, and cannot be closed by the tool list without also breaking subagent re-entry (§3d2).

**The rule to write:**

> The adapter installs a `canUseTool` predicate on every run. A `SendMessage` whose `to` names a task this run started is allowed; any other `to` is **denied** with a message explaining that an embedded run may address only its own subagents. `ListAgents` is not denied — the model needs it to discover the helpers it spawned — but nothing in the adapter reads its result, and its listing is not projected onto the unified stream.

**Two implementation constraints the entry must carry, because both are already true in the code:**

1. **`canUseTool` is installed conditionally today** — only when a user-input handler is present (`src/adapters/claude-code.ts:1483`), and it currently allows everything but `AskUserQuestion`. The outbound gate makes it unconditional, so the entry changes *when* the hook exists, not just what it does. A run that previously sent the SDK no `canUseTool` will now send one; that is a behaviour change worth stating rather than discovering.
2. **The predicate's data already exists.** `TaskRegistry.kind(taskId)` is populated on every `task_started` and entries are never removed, so "a task this run started" is decidable without new bookkeeping (`claude-code.background-hold.ts:177-208`).

**Semver / M12.** This *narrows* what a run can do, so it is not additive: a consumer relying on outbound peer messaging — nobody today, since the specification never advertised it — would break. Classify it as a security default with the same reasoning as the `crossSessionInbound` pin, and report it on `adapter_ready` the same way (M14 — <section_ref anchor="0tycjmv6"/>), so a posture the consumer did not choose is at least one they can observe.

**Settled: `ListAgents` is not denied.** The model keeps it to discover the helpers it spawned. Its listing does carry the consumer's unrelated session names into the model's context, and that leak is **documented rather than closed** — write it as a known exposure in this bullet and in the edge cases (E17), not as a silent acceptance. The reasoning, worth keeping so the next round does not re-litigate it: listing is not reaching. The control that matters is on the reaching tool, and it is the `to` predicate above; denying the listing would have looked like a mitigation while changing nothing about what the run can actually do.

<!-- anchor: NEWE27 -->
<!-- anchor: ryq08oe5 -->
### E27 — `modules/M12-conformance-release.md#xe2ecat1` (e2e scenario catalog, L5) — a new scenario

**Why a new catalog row, when E19 deliberately added none.** E19's two facts belonged to scenarios the catalog already names. This one does not: it is a scenario about **what the engine exposes**, not about what the library does with it, and it has no home among the existing rows.

Add `sdk-surface-probe`:

| Scenario | What it proves |
| --- | --- |
| `sdk-surface-probe` | Against a live engine at the current dev-pin, the set of built-ins the run actually exposes — including the deferred ones reachable only through a discovery gate — is **covered by** the adapter's known-tool inventory. A name the engine exposes and the inventory does not know is a gate that will fail closed on it at the next deny. |

**And one convention this scenario introduces, which belongs in M12's how-mode prose because it is the implementor's rule, not A01's.** Every other scenario drives the adapter. This one drives the **peer SDK directly**, with no adapter in the path — because L7 asks what the *engine* does at a pin, and an observation taken through our own mapping layer cannot answer that: an adapter bug and an SDK change look identical from the outside. So:

> A scenario may bypass the adapter and call the peer SDK directly **when, and only when, what it records is evidence for that consumer's L7 verified-pin log**. Such a scenario asserts nothing about `UnifiedEvent`; it exists to make the engine's own surface measurable. It still lives in the e2e suite, under the same skip-without-credentials contract, so that *"the e2e suite is the verified-range evidence"* (<inline_mention type="ac" slug="ac-e2e-suite-is-the-verified-range-evidence"/>) stays literally true rather than acquiring a silent exception.

**Impact, checked:** that AC and its A01 sibling `ac-claude-code-e2e-verified-range-evidence` both say the e2e suite **is** the evidence. Keeping the probe inside the suite is what lets both stand unedited — which is the whole reason this entry rejects a loose `scripts/*.mjs`. A second, separately-invoked way to run live checks is how one of the two stops being run.

<!-- anchor: NEWE28 -->
<!-- anchor: 6qghnd9w -->
### E28 — `adapters/A01-claude-code.md` — the probe: where it lives, what it asserts, when it runs

The live transcripts quoted in E14/E16 came from a standalone script run by hand. **Vendor it, but as a scenario of the existing suite rather than as a loose script**, per E27's convention. Two touches.

**28a — `#a01e2ecv` (e2e coverage, L5).** New row, drawn from E27's catalog entry:

| `sdk-surface-probe` | A01 | ❌ not implemented — three legs: (1) unrestricted run, capture the `system:init` tool list and assert it is covered by the adapter's known-built-in inventory; (2) deferred-tool reach — the discovery gate resolves `SendMessage`, and a second `task_started` for a re-entered helper carries the same `task_id` with a new `tool_use_id`; (3) the gated run — under the allow-list the adapter builds, the same reach fails, which is the defect E14b fixes and the regression guard afterwards |

*Leg (1) is the one that matters most and is the cheapest.* At the current pin it would fail immediately with 29 names, which is exactly the value: the 29-tool gap was invisible for as long as nothing measured it.

**28b — `#49zu34oc` (SDK compatibility & schema drift, L7).** The `verified by` column of the verified-pin log already exists and already accepts "an e2e run, or documented live use". Name the probe in it, and add the obligation to the section's prose:

> The **inventory audit is a pin-bump obligation**: every dev-pin bump runs `sdk-surface-probe` before the log's new row is completed, and any name the engine exposes that the inventory does not know is a finding recorded in that row, not a detail deferred to the next round. This is the executable half of the inventory rule in M18 (<section_ref anchor="4j6f86yq"/>) — without it that rule is a sentence nobody can be held to, which is precisely how the current 29-name gap accumulated.

**Practical notes for whoever applies this, none of them spec content:** the suite already guards on credentials and skips rather than fails, already parameterises the model by `E2E_CLAUDE_MODEL`, and already has per-adapter npm scripts — so the probe needs no new runner, no new skip convention and no API key (claude-code authenticates through local OAuth). Its transcripts are what get quoted into the L7 findings cell; the assertions are what keep the gap from reopening.

<!-- anchor: 10okko5r -->
## 5. Open decisions this plan does not take for you
**All of the original six are now settled, and the one the outbound probe opened is settled too. Nothing in this plan is waiting on a decision.**

1. ~~**(c2) — `delegation` as a fifth `ToolGroup`?**~~ **Yes, required** (§3c).
2. ~~**E10's unverified cells — marker or blocker?**~~ **Dissolved** — every cell read out of the installed SDKs (§3c).
3. ~~**Is (c1) L1 or L2?**~~ **L1** (§3c).
4. ~~**`ListAgents` output shape.**~~ **Closed by the live probe** — prose, `{ listing: "<text>" }`, no schema (E16 finding 10). Nothing may depend on it, and that refusal is now a recorded fact.
5. ~~**`resumed` — boolean or re-entry count?**~~ **SETTLED: boolean.** `subagent_started.resumed?: boolean`, `true` on every start after the first for a `taskId`, absent otherwise. The counter is rejected for a concrete reason worth carrying into E5's prose rather than leaving implicit: the adapter derives the value from in-process state, so a run resumed through `resumeSessionId` (M07) would restart the count at zero and hand the same agent `resumed: 1` twice. A boolean is a bit the adapter can always honour; an ordinal is one it cannot. E5, E17 and criteria 3–4 are written as boolean; nothing else changes.
6. ~~**A03's migration cost.**~~ **SETTLED: route (b) — an adapter-local implication.** `delegation` becomes its own group, and **on opencode a `file-read` deny also denies `delegation`**. Consumers keep the guarantee they have today — a denied read cannot be laundered through a spawned helper — and no other adapter inherits the coupling. Rejected: (a) accepting the relaxation, which would silently remove a live guarantee at a minor bump; (c) making the implication universal, which would cost plan-mode runs their research subagents and contradict criterion 20. The cost this choice does carry, and E10 must state it plainly: **groups are no longer strictly orthogonal on every adapter.** That is a fact about opencode's permission model — its buckets are server-side and coarse — not a hole in the unified vocabulary, and L2 is the right place to say so, because "what this adapter can express" is exactly what that layer is for.
7. ~~**Should `ListAgents` be denied outright?**~~ **SETTLED: no, it stays allowed.** The model keeps it to discover the helpers it spawned. The leak it carries — the consumer's unrelated session names entering the model's context — is **documented rather than closed** (E14/14d, E17), and the outbound risk is handled where it actually lives: the `canUseTool` predicate on `SendMessage`'s `to` (E26). Listing is not reaching; denying the listing would have been a comfort, not a control.

<!-- anchor: 883rinev -->
## 6. Seen, not planned
- `adapters/A01-claude-code.md#sw3cwrsm` — "Known gaps (unused SDK controls)" already lists `Query.stopTask()` and `Query.backgroundTasks()` as unrealized. `SendMessage` is a third control in that family.
- **`claudeCodeKnownBuiltins()` is dead code.** `src/adapters/claude-code.ts:206-213`, documented *"Every built-in this library knows about"*, is referenced nowhere in `src/` and not exported from `src/index.ts`. (c1) gives it a job; whether it should also be part of the public API (so a consumer can audit the gate) is a separate L4 question.
- **opencode has an unused per-tool primitive.** `AgentConfig.tools` and `SessionPromptData.body.tools` are both `{ [name]: boolean }` in `@opencode-ai/sdk@1.15.11`; the adapter gates only by permission bucket. A route from bucket-granularity to name-granularity exists and is unplanned.
- **opencode's permission schema ends in a catch-all**, so an unknown or mistyped bucket is accepted and silently enforces nothing (`src/adapters/opencode.ts:104-107`). Adding a `delegation` bucket name inherits that failure mode; worth a conformance check rather than trust.
- **The installed opencode SDK is 1.15.11 against a dev-pin of `^1.4.6`.** Inside the declared range `>=1.4.0 <2.0.0`, but eleven minors past the pin the L7 log records as verified. Not this change's business; worth a pin-bump round.
- `<index>` `0aj92zki` OQ7 (self-scheduling loop, `M19`) — a library-owned loop and an inbound peer turn are the same problem seen from two sides. If OQ9 is ever promoted, plan the two together.
- **Outbound agent-addressed messaging is a real cross-adapter shape** (gemini `A2AClientManager.sendMessageStream`, opencode `session.prompt({ agent })`) and is *not* what OQ9 scopes out — OQ9 scopes out **inbound cross-session ingress**. A future round could specify outbound without touching ingress at all.
- `modules/M06-subagents.md#1zx424gy` — the L2 support matrix has no row for re-entry. Left alone deliberately: re-entry is model-initiated, so a support row would advertise something no one can ask for.
- **The incoming half of every dependency graph this plan touches is unreachable.** `module-dependency` is inactive, so "who leans on the one-pair-per-`taskId` assumption" could only be traced outward from each module's own prose table. M06, M09, M12 and M17 were checked that way; nothing else was.
- `modules/M08-token-usage.md` — checked and **not broken** by a second lifecycle pair: usage folds into a flat run total, not per-`taskId` buckets.
- **The SDK ships no CLI.** `manifest.json` points at a ~199 MB native binary fetched at install/first-run. Every A01 claim about tool-result text or live model-visible symptoms is unverifiable from `node_modules` by construction — a standing limit on what any source sweep can confirm for this adapter, worth stating once in L7 rather than rediscovering each round.
