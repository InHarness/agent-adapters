---
type: plan
title: M06 Subagents — realignment with SDK architecture capabilities
created_at: '2026-08-26T08:05:55.279Z'
created_by: agent
applied: false
---
# M06 Subagents — realignment, and the question of an own delegation runtime

Research-backed. Findings come from four SDK documentation/type studies (claude-agent-sdk 0.3.220, @opencode-ai/sdk 1.15.11, @openai/codex-sdk 0.120.0, @google/gemini-cli-core 0.38.2) plus a full sweep of the current spec. **Nothing is executed yet.**

Two tracks. **Track A is needed whatever we decide** — the spec currently states things the SDK docs contradict. **Track B is an open architectural decision** and is deliberately left undecided here.

<!-- anchor: dff21gg7 -->
## Problem statement

The M06 matrix conflates *what the architecture can do* with *what our adapters consume*, and in two rows states something false:

- `codex` — recorded as "no subagent concept". Codex has a documented multi-agent surface (`~/.codex/agents/*.toml`, `[agents]` in `config.toml`, `agents.default_subagent_model`, `max_concurrent_threads_per_session`). What is absent is *SDK exposure*, not the concept.
- `gemini` — recorded as "Gemini has no native subagent objects". `@google/gemini-cli-core` ships a first-class `AgentDefinition` (zod-strict), `LocalAgentExecutor`, `AgentRegistry`, `SubagentActivityEvent`. Our `threadId` synthesis is a *choice*, not a forced degradation.

Underneath that, the subagent tool rule exists in the spec only as a side effect of M18 tool-gating, never as its own contract: `SubagentDefinition` has no field list anywhere, and neither M15 path-scope nor M04 MCP say whether they propagate into a subagent.

<!-- anchor-free: new tracks inserted before Track A -->

# Track 0 — the business premise (verify first, it underwrites everything)

The library exists so that inference is billed against a **subscription** rather than per token. Research on 2026-08-26 says that premise holds, and holds more firmly than when the spec was written — but two load-bearing facts need human verification because the sources 403 automated fetches.

<!-- anchor: tk5dnicq -->
## T0.1 What is actually true about "Sign in with ChatGPT"

Two different things share the name and only one is relevant:

- **Identity SSO** — shipped in beta ~2026-08-02, six named partners. OpenAI Help Center: the partner receives *"only your name, email address, and profile picture"*, and explicitly **not** *"your files or tokens"* or billing data. **Conveys no quota.** No self-serve OAuth client registration exists.
- **Codex app-server `chatgptAuthTokens`** — officially documented, *"experimental and intended for host apps that already own the user's ChatGPT auth lifecycle"*, gated behind `capabilities.experimentalApi`. This is the real hook, and OpenAI has published no eligibility statement for it.

OpenAI ToS neither permits nor forbids third-party subscription use. The closest blessing is a Sam Altman tweet about OpenClaw (an OpenAI-affiliated project). OpenAI has been asked directly at least three times in public and never answered.

<!-- anchor: 7iwwugud -->
## T0.2 The binary is the licence boundary, not the transport

| vendor | subscription without the vendor binary? | evidence |
| --- | --- | --- |
| Anthropic | **no, in writing** | *"does not permit third-party developers to… route requests through Free, Pro, or Max plan credentials"*; raw HTTP returns 400 *"This credential is only authorized for use with Claude Code"* |
| OpenAI | officially no; app-server is the binary-as-protocol | originator gating (`originator: pi` → model not found); subscription traffic goes to undocumented `chatgpt.com/backend-api/codex/responses` |
| Google | premise expired | consumer OAuth withdrawn 2026-06-18 |
| OpenCode | not a Claude broker | *"Anthropic explicitly prohibits this"*; plugin unbundled in 1.3.0 |

Conclusion: **"raw API + own agent loop" means per-token billing for every frontier model.** The only clean counter-example is OpenCode Go ($10/mo delivered as an API key) and it covers open-weight models only.

Anthropic's policy also explicitly protects our exact shape: *"Nor does it prevent an end user from signing in to the **unmodified Claude Code binary** with their own Claude subscription"*, provided the binary is unmodified and the integrator does not collect or intermediate credentials. Two invariants follow and should be recorded as spec-level constraints: **the adapter never reads or parses `~/.codex/auth.json` or `~/.claude/.credentials.json`**, and **`CODEX_INTERNAL_ORIGINATOR_OVERRIDE` is never overridden**.

<!-- anchor: e0b81phy -->
## T0.3 Verify by hand before anything rests on it

Automated fetches of `openai.com`, `help.openai.com` and `web.archive.org` were blocked (403 / CAPTCHA). Open in a browser and confirm: (a) the Google consumer-OAuth withdrawal of 2026-06-18, (b) the current wording of Anthropic's legal-and-compliance page.

<!-- anchor: ykuhq7ty -->
## T0.4 Stale rationale in the spec

`google-adapters-strategy.md` and index open question #4 (anchor `w5e9vcbj`) justify the gemini-cli-core dependency by a free-tier OAuth that Google withdrew. The code already requires `GOOGLE_API_KEY`, so this is pure spec drift — open question #4 now answers itself.

# Track C — does `codex app-server` unlock A02? (investigate before Track B settles)

A02 is recorded as the degraded adapter: no dynamic MCP, no subagents, no ask-user, no mid-turn. **That profile may be an artefact of our surface choice, not of Codex.**

We drive `codex exec --experimental-json` — the thinnest surface the binary exposes. `codex app-server` is the *same binary* speaking JSON-RPC 2.0, documented as *"the first-class integration method we maintain moving forward"* and offering *"authentication, conversation history, approvals, and streamed agent events"*, plus `account/rateLimits/read` and `account/updated{planType}`. OpenAI's own **Python** SDK already drives app-server; the TypeScript SDK still shells `exec`.

What to establish, in order:

1. Does app-server expose a spawned-agent lifecycle (the `[agents]` surface from A2)? If yes, A02's `❌` in M06 becomes `✅ native` and Track B's "codex cannot do model-driven delegation" collapses.
2. Does it accept dynamic MCP server registration? If yes, M04's A02 row changes and the MCP substrate for a model-driven runtime becomes 4/4.
3. Does it carry approvals / elicitation? If yes, M11's ask-user gap on A02 closes.
4. Cost: app-server is JSON-RPC, not the SDK we depend on today — this is an adapter rewrite, routed through a brief.

**This gates Track B.** Deciding the delegation runtime while A02's true capability is unknown would design around a constraint that may not exist.

# Track A — corrections (do these regardless)

<!-- anchor: sxi05dd3 -->
## A1. Split the M06 matrix into two axes

In `## Capability & Degradation (L2)` (anchor `1zx424gy`) replace the 2-row matrix with two stacked matrices: **architecture capability** (definition channel, per-agent tool control, nesting, concurrency cap, native lifecycle events) and **adapter consumption** (define / observe / synthesize, `subagentTaskId` source).

L2's slice schema (anchor `au14qdu4`) asks a capability-module to own the matrix; it does not forbid an architecture axis. Keeping the two apart is the mechanism that stops "we didn't wire it" from being recorded as "the SDK can't" — which is exactly how the two false rows survived.

<!-- anchor: 7gnutd3m -->
## A2. Correct the codex row

Architecture: subagents exist (TOML role files, config-level defaults, concurrency cap). Consumption: **not reachable from `@openai/codex-sdk` 0.120.0** — no `agents` in `ThreadOptions`, no spawned-agent `ThreadItem`, no lifecycle event in the union. Name `CodexOptions.config` (`--config` passthrough) as an unverified escape hatch.
Touches `adapters/A02-codex.md` anchors `t2v9clpy`, `dmy7oxr7`.

<!-- anchor: j5p7272s -->
## A3. Correct the gemini row

Record the native surface (`.gemini/agents/*.md`, `tools:` allowlist with wildcards, per-agent `mcp_servers`, `max_turns`/`timeout_mins`, no nesting by design, `SubagentActivityEvent`) and state that A04 currently observes via `threadId` synthesis instead. Add two source-only traps as edge cases: project agents need folder trust + acknowledgement (silently unregistered otherwise), and `excludeTools` does not suppress a subagent-as-tool.
Touches `adapters/A04-gemini.md` anchors `mlo3qpng`, `s7prl2pn`, `oirynpg7`.

<!-- anchor: cvz1mb49 -->
## A4. Promote the tool-derivation rule to a named contract

M06 L1 (anchor `0f6287ae`) states "derived, not independent" as prose. Make it three clauses — the SDKs agree on the shape:

1. **Built-in tools are subtractive.** Omitting the tool list inherits the parent pool (claude-code, gemini both documented); naming tools narrows it; naming a tool the parent lacks never adds it. **Exception: opencode**, where the merge is agent-over-*global*, not agent-over-parent — a restricted primary delegating to `general` genuinely widens capability. The experimental `primary_tools` key exists precisely because role does not gate tools there.
2. **MCP is the additive channel.** claude-code `AgentDefinition.mcpServers` and gemini per-agent `mcp_servers` both grant a subagent servers the parent lacks. The one documented way a subagent exceeds its parent — currently unaddressed in M04.
3. **The resolved set is not the declared set.** claude-code applies two post-hoc filters (a fixed removal list; a much smaller built-in set for *background* subagents, which is the default since 2.1.198). The same definition resolves differently in foreground and background, so "we denied X" must be asserted against the resolved set.

<!-- anchor: 8x61661j -->
## A5. Two gaps to close — product decisions, not editorial

- **M15 path-scope × subagents.** M18 deny-groups propagate; path-scope is silent. Pick: propagate like M18 / does not apply / adapter-specific. The asymmetry is real on gemini, where `workspaceDirectories` *extends* the parent's workspace.
- **M04 MCP × subagents.** Whether a subagent gets the parent's servers, its own, or both — and whether we expose per-subagent MCP at all. Follows directly from A4.2.

# Track B — own delegation runtime (OPEN, undecided)

Idea: a subagent becomes a child `adapter.execute()` with a derived policy, its stream merged into the parent's with `isSubagent` + `subagentTaskId`. The plumbing already exists (M09 `splitBySubagent`, M08 usage aggregation, L1 lifecycle).

<!-- anchor: 00vvk3sh -->
## B1. The finding that constrains everything: who triggers the child

Two different products, never separated in the spec so far:

- **Consumer-driven** — the developer composes runs; we supply semantics (derived tool policy, derived path-scope, merged stream, shared `subagentTaskId`, aggregated usage). Works **4/4 adapters, no SDK dependency, no exceptions**.
- **Model-driven** — the model decides to delegate, so it needs a tool in its toolbox. The only portable injection channel is MCP, and MCP support is not portable:

| adapter | dynamic MCP | in-process `sdk` server | model-driven feasible? |
| --- | --- | --- | --- |
| A01 | full | yes, by instance | trivially |
| A03 | stdio only | dropped | needs a stdio subprocess bridging back to the host |
| A04 | stdio / SSE / HTTP | skipped | same bridge |
| A02 | **`mcpServers` ignored entirely** | no | **no** — only the unverified `--config` hack |

<!-- anchor: vh2lf5lv -->
## B2. The payoff, if we go for it

Every question in Track A4/A5 stops being four different answers from four SDKs and becomes one contract we author. M18 stops being patched: today A01 `shell` is `soft` precisely because a native subagent does not inherit the parent's denies (anchors `1yllld10`, `677rc2wh`) — under our own runtime propagation is by construction. Codex gets subagents for the first time, in consumer-driven mode.

<!-- anchor: 2kosnx5d -->
## B3. The cost, stated honestly

- **Prompt cache and money.** A fresh `execute()` means a cold cache. claude-code's `fork` — a subagent inheriting the whole conversation *and reusing the parent's cache* — is not reproducible by us at all.
- **Delegation quality.** The native `Agent` tool is tuned; an MCP tool of ours will be invoked worse because the model does not know it.
- **Double surface on A01.** The native `Agent` still exists unless we deny it via M18 — otherwise two delegation paths run side by side.
- **The stdio bridge is real engineering**, not a config line.

<!-- anchor: ocn1rjb9 -->
## B4. Structural consequence for the spec

M06 stops being an observation module (medium, L1+L2+L4) and becomes the **implementor of a delegation runtime**: it starts touching L3 (child-run configuration), owns the tool/path/MCP inheritance contract, and will almost certainly pass the ~250-line budget → split into `modules/M06-subagents/` per the skill's file-organization rule.

<!-- anchor: zu9t91du -->
## B5. Open decisions — not taken

1. Scope: own runtime as the only definition contract / hybrid (native on A01, ours elsewhere) / stay native and only fix the spec.
2. Invocation: consumer-driven first, model-driven later / both at once / model-driven only.

Both are left open on purpose. Track A does not depend on either.

<!-- anchor: p2bvye3d -->
## Out of scope

No code changes. Per `CLAUDE.md`, anything requiring `src/` goes through the brief → implementer pipeline.
