---
type: plan
title: Soft path-scope must not withhold consumer MCP tools (claude-code)
created_at: '2026-10-20T14:57:54.214Z'
created_by: agent
applied: true
---
# Soft path-scope must not withhold consumer MCP tools (claude-code)

<!-- anchor: 2fkgro79 -->
## Intent

A consumer (claude4spec, `c4s ask/agent` in a Linux container without `bwrap`) declares path-scope and passes its own MCP servers in `mcpServers`. On claude-code every path-scoped run without an OS sandbox is **soft** — the default unless `claude_sandbox.enabled` is set and the host has one — and the soft run uses the default-deny `dontAsk` mode with allow rules for `Read/Edit/Write` under the ceiling only, so every consumer MCP tool is refused. Under hard (`bypassPermissions`) the same turn works. The consumer needs the MCP servers it supplied to work whatever strength the host yields, without per-server workarounds.

<!-- anchor: 4bwdven3 -->
## Classification

Inconsistency report — **spec-internal tension, code follows the losing side.** Not a pure code defect:

- M04 — <section_ref anchor="fv7bhx0s"/>: "a run with every group denied can still call every MCP tool it was given"; the consumer's control is "do not pass the server". Stated for M18 only.
- M15 — <section_ref anchor="8pg5iti3"/> (composition bullet): "a default-deny permission mode whose allow-rules name the file built-ins only"; edge in <section_ref anchor="x2258xmh"/>: "the default-deny permission mode pre-approves only the file built-ins". Read literally, M15 withholds MCP under soft — which is what the code does.
- M06 — <section_ref anchor="4b8iv50p"/> repeats "pre-approves the file built-ins only".
- A01 — <section_ref anchor="sw3cwrsm"/> *Soft default*: silent on MCP.

**Decision:** M04's promise ("every MCP tool it was given") extends to M15. M15 is the home of *what soft path-scope pre-approves* (rule 2), so the policy change happens in M15; M04 carries the invariant, A01 the mechanism. The existing workaround (`autoApproveTools: ['mcp__<server>']`, M01) works today but is not the answer: the consumer already supplied the server, and M04 says that is the whole of its control.

**Reserved server key `workspace` (user decision).** The CLI owns a built-in MCP server named `workspace` whose `bash` and `web_fetch` tools are shell and web — the latter is M18's A01 `web` escape surface (<section_ref anchor="1yllld10"/>). A consumer server keyed `workspace` would receive a rule that also re-admits those built-ins under soft scope. claude-code therefore **refuses to register a consumer server keyed `workspace`**: the server is skipped with a one-shot `warning`, the run continues with the remaining servers (same shape as the existing opencode SSE/HTTP edge in M04 <section_ref anchor="wxyessab"/>). Applies to every claude-code run, not only path-scoped ones — the name is reserved by the CLI regardless of permission mode, and a rule that depended on scope would make the same `mcpServers` behave differently by host.

<!-- anchor: rfs9zznl -->
## Changes (execution order)

Order: M04 (invariant owner) → M15 (policy home) → M06 (dependent prose) → A01 (adapter mechanism, points at M15) → AC entities → code.

<!-- anchor: 0hjudvp0 -->
### 1. M04 — MCP integration

**1a. `Capability & Degradation (L2)` — <section_ref anchor="fv7bhx0s"/>.** Extend the paragraph "MCP tools are outside M18's tool gating" by one sentence, invariant only: *the same holds for path-scope (M15 — <section_ref anchor="8pg5iti3"/>) — no strength, soft or hard, withholds a server the consumer passed.* No mechanism, no file-reach statement here (that fact is M15's, <section_ref anchor="x2258xmh"/>).

**1b. `Edge cases` — <section_ref anchor="wxyessab"/>.** Two new bullets (situation → behaviour):
- *claude-code with a consumer server keyed `workspace` → that server is skipped with a warning; the run continues with the other servers. The name is reserved by the claude-code CLI for a built-in server (A01).*
- *A filesystem MCP server under soft path-scope → not confined to `cwd ∪ allowedPaths`; path-scope bounds the built-ins, not MCP servers (M15 — <section_ref anchor="x2258xmh"/>). To keep files out of reach, do not pass the server.* — parallel to the existing M18 `file-read`+`file-write` bullet.

<!-- anchor: nod8w0qx -->
### 2. M15 — Path scoping

**2a. `Capability & Degradation (L2)` — <section_ref anchor="8pg5iti3"/>, composition bullet.** This is the policy change, not wording. "a default-deny permission mode whose allow-rules name the file built-ins only" → "…whose allow-rules name the file built-ins and the servers the consumer passed in `mcpServers`, so enabling path-scope withholds shell and web but no consumer MCP tool (M04 — <section_ref anchor="fv7bhx0s"/>)". Rest of the bullet unchanged ("never re-widened by an M15-generated allow rule" still holds: the MCP rules name no built-in, see 4a).

**2b. `Edge cases` — <section_ref anchor="x2258xmh"/>.**
- Edge "Path-scope on claude-code with no M18 deny declared" — **rewrite**, not append: "→ shell and web are nonetheless withheld, because the default-deny permission mode pre-approves only the file built-ins and the consumer's MCP servers. Consumer MCP tools stay callable (M04 — <section_ref anchor="fv7bhx0s"/>). This is a real capability reduction…" (tail kept).
- Edge "MCP file tools" — tighten "may fall outside the soft gate" → "fall outside the soft gate: the consumer's MCP servers are pre-approved, and their file reach is not bounded by path-scope — a documented boundary the consumer must account for".

<!-- anchor: 62zwsyao -->
### 3. M06 — Subagents, `Edge cases` — <section_ref anchor="4b8iv50p"/>

Bullet "Definition supplies a `tools` allow-list naming `Bash` on a run under soft path-scope": replace "M15's default-deny posture pre-approves the file built-ins only (<section_ref anchor="x2258xmh"/>), so shell and web are withheld" with "M15's default-deny posture withholds shell and web (<section_ref anchor="x2258xmh"/>)" — a pointer, so the pre-approval list lives only in M15.

<!-- anchor: z9xcp3jn -->
### 4. A01 — claude-code

**4a. `Per-capability consumption` — <section_ref anchor="sw3cwrsm"/>, Path-scope → *Soft default*.** Add: the default-deny allow set also carries **one rule per consumer server**, so the M04/M15 promise holds under `dontAsk`. Constraints, stated in the bullet:
- the rule names the server by the identifier the CLI gives its tools — the key with every character outside `[A-Za-z0-9_-]` replaced by `_` — in the per-server form `mcp__<name>__*`; the CLI compares a rule's server name unnormalized and splits on `__`, so the raw key or a bare `mcp__<name>` misses keys like `my.server` or `my__srv`;
- never a server-less wildcard (`mcp__*`) — the CLI skips a wildcard allow rule that does not name its server;
- only servers the consumer passed in `mcpServers` get a rule; servers reached through the `project` settings tier (`.mcp.json`), plugins or connectors do not, and stay refused under soft scope;
- the rules name no built-in, so an M18 deny is still never re-widened (<section_ref anchor="1yllld10"/>); deny rules keep precedence in the CLI's evaluation order.

Hard path unchanged (`bypassPermissions`).

**4b. `Per-capability consumption` — <section_ref anchor="sw3cwrsm"/>, MCP (M04) bullet.** Append: the server key `workspace` is reserved by the CLI for a built-in server (its tools include shell and web-fetch); a consumer server under that key is not passed to the SDK and the run emits one `warning` naming it.

**4c. `Edge cases` — <section_ref anchor="677rc2wh"/>.** Next to "path-scope requested → the soft run drops `bypassPermissions`…", one line: *soft path-scope with `mcpServers` → every tool of every supplied server is callable with no `autoApproveTools` set.* (No restatement of the invariant.)

**4d. e2e coverage — <section_ref anchor="a01e2ecv"/>** and M12 catalog <section_ref anchor="xe2ecat1"/>: `path-scope` scenario description gains "…and a consumer in-process MCP tool stays callable".

<!-- anchor: 6e7rcryl -->
### 5. AC — entities

Create (all `verifies` empty — behaviour in prose):
- `ac-soft-path-scope-keeps-consumer-mcp-tools`, tags `a01`, `m15` (the A01 page embeds `a01`; nearest neighbours `ac-when-path-scope-or-claude-sandbox-enabl`, `ac-in-plan-mode-the-claude-code-adapter-hid` carry `a01`). Title: *"On claude-code under soft path-scope with no autoApproveTools set, a tool of a consumer-supplied MCP server is callable."*
- `ac-claude-code-workspace-mcp-server-not-registered`, tags `a01`, `m04`. Title: *"On claude-code, a consumer MCP server keyed `workspace` is not registered with the SDK."*
- `ac-claude-code-workspace-mcp-server-warns`, tags `a01`, `m04`. Title: *"On claude-code, a run whose `mcpServers` contains the key `workspace` emits one warning naming that server."*

Update: `ac-claude-code-e2e-path-scope-scenario` — title extended with the MCP leg, `verifies` adds the new soft-MCP AC.

The optional "no wildcard MCP rule" AC from v1 is dropped: it pins the allow set's shape, not observable behaviour, and the CLI already refuses that form.

<!-- anchor: crqf85jd -->
### 6. Code and test (out of spec; for the implementer)

- `src/adapters/claude-code.ts`:
  - MCP wiring (~l.1417–1430): skip key `workspace` with a one-shot `warning`, before building `options.mcpServers`.
  - soft branch (l.1467–1490): `allow = [...ceiling.flatMap(fsRules), ...registeredKeys.map(k => \`mcp__${k.replace(/[^a-zA-Z0-9_-]/g, '_')}__*\`)]`, where `registeredKeys` excludes `workspace`.
  - comment at l.1297–1299: cover both `plan` and soft `dontAsk`.
- Unit tests, `src/adapters/claude-code.path-scope.test.ts`: (a) soft + `mcpServers {a, 'my.server', 'x__y'}` → allow contains `mcp__a__*`, `mcp__my_server__*`, `mcp__x__y__*`; (b) no element equals `mcp__*`; (c) no path-scope → `settings` stays `{ crossSessionInbound: 'refuse' }` (hard cannot be forced in a unit test — depends on `detectOsSandbox()`); (d) soft + `file-read` denied + `mcpServers` → MCP rules present, no `Read(…)` rule; (e) `mcpServers {workspace, a}` → `options.mcpServers` has only `a`, one `warning`, no `mcp__workspace__*` rule. Widen `claude-code.subagents.test.ts:207` (`^(Read|Edit|Write)\(`) deliberately.
- e2e (`claude-code.e2e.test.ts`, `describe('path scope …')` ~l.1617): reuse `createE2eMcpServer()` (`shared.ts:176`) under soft scope; assert the `tool_result` contains `echo: …` and is not an error — a refused call still emits `tool_use`. Avoid MCP tool names ending in `_bash`/`_web_fetch` etc. (`GROUP_TOOL_PATTERNS`, `shared.ts:288`).
- Covers `claude-code-ollama` / `claude-code-minimax` (same code path). gemini, codex, opencode are not affected.
- Version: **minor, 0.9.14 → 0.10.0**, per M12 <section_ref anchor="agvf1tok"/> (behaviour change consumers rely on → minor + behavioural CHANGELOG note). Notes: "soft path-scope no longer refuses consumer MCP tools (they are pre-approved; their file reach is not path-bounded)"; "claude-code refuses a consumer MCP server keyed `workspace` (warning)". The release also carries the unreleased #40 (`ffc9a23`), which has no CHANGELOG entry yet. Check whether 0.9.14 was tagged/published (no local `v0.9.14` tag).

<!-- anchor: sxn7397d -->
## `settingSources = ['project','local']` in soft

Stays. A01 *Config-discovery containment* (AC `ac-when-path-scope-or-the-sandbox-is-reques`; also <inline_mention type="ac" slug="ac-under-a-bounded-sandboxed-run-global-ho"/>) narrows setting sources whenever path-scope is requested. Not the cause: `params.mcpServers` arrive through `options.mcpServers`, not through setting sources.

<!-- anchor: f7ml4z14 -->
## Seen, not planned

- `project`/`local` settings tiers stay loaded under soft scope; a project `.claude/settings.json` with its own `permissions.allow` could widen the soft confinement. Not covered by M15's containment axis — candidate for `<index>` Open questions, item 5 (<section_ref anchor="0aj92zki"/>).
- `autoApproveTools` under soft scope feeds whole-tool allow rules (`Read`, `Bash`) that likely re-widen the M15 ceiling or re-admit shell; M15/M18 only forbid re-widening an M18 deny — same Open-questions item.
- AskUserQuestion under soft `dontAsk` is probably refused before `canUseTool` is reached (ask → deny) — unverified, separate defect.
- M15 `Cel` (<section_ref anchor="ot3zqa0a"/>) promises the adapter knows "how an `mcp__` tool maps to a file"; contradicts "MCP file reach is not path-bounded".
- M06/A01 say a subagent's `disallowedTools` is sent only under an M18 policy, so an `mcp__server__*` entry (M04's "only per-subagent MCP control") has no effect on a path-scope-only run — M04 <section_ref anchor="fv7bhx0s"/> vs M06 <section_ref anchor="4b8iv50p"/>.
- No `module-dependency` records exist in the project; M15↔M04 relation is in neither `## Dependencies` table — pre-existing rule-3a deviation.
- M15 <section_ref anchor="8pg5iti3"/>, "⚠️ Verification pending on the soft path" — unrelated, still open.
