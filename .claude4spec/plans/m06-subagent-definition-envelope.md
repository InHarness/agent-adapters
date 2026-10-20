---
type: plan
title: M06 — subagent definition envelope
created_at: '2026-08-26T09:45:51.122Z'
created_by: agent
applied: true
---
> Scope: **specification only**. No `src/` edit and this plan does not produce a brief. Everything below documents behaviour that already ships in 0.10.x; the deliberately-not-exposed SDK surface is recorded as a decision, not as a backlog item. Step 8 hands one *test* to the implementer pipeline — that brief is written separately, after this plan lands.

<!-- anchor: t9vf54yi -->
## Problem

M06 owns subagents and names `SubagentDefinition` in its L4 exports, but never states a single field of it, and never states the rules by which a subagent's context is derived from its parent. A reader — human or code-gen agent — cannot answer from the spec: does the subagent get the parent's system prompt? its tools? its MCP servers? its model? The answers exist only in `src/types.ts` JSDoc and in the peer SDK's `AgentDefinition` declaration, which per CLAUDE.md is the wrong home for contract semantics.

Five concrete rules are invisible to the spec today:

1. `prompt` is the subagent's **own** system prompt; the parent run's `systemPrompt` is not inherited.
2. `tools` omitted → inherits the parent's tools; supplied → allow-list. M06 states the *ceiling* ("derived, not independent … may never widen past the parent run's effective policy") and the M18 intersection, but never the base rule those two narrow, and never what "omitted" resolves to.
3. `model` omitted → inherits the main model; supplied → passed to the SDK **verbatim, bypassing M02 resolution**. M06 and M02 have no declared relation.
4. MCP is not a field of the envelope at all — a subagent inherits the run's servers, filtered by its toolset. M04 does not mention subagents; M06 does not mention M04.
5. **Filesystem scope is undefined for a subagent.** M15 confines the run; nothing in the spec says whether that confinement survives delegation. This is the most consequential gap of the five, because the neighbouring surface has the *opposite* answer: on claude-code a subagent does **not** natively inherit the parent's tool denies — the fact lives in A01's edge cases (<section_ref anchor="677rc2wh"/>), cited from M06's L1, and is exactly why M18 had to propagate them explicitly. A reader who generalises from that precedent concludes path-scope leaks too, and cannot tell from the spec whether it does.

The L2 matrix compounds this: it has rows for lifecycle events and `subagentTaskId`, but no row for *definition acceptance* — the one behaviour the `subagentDefinition` capability flag actually gates.

<!-- anchor: dwbl5nah -->
## Decisions taken

- **Envelope stays as-is.** The unified `SubagentDefinition` remains the 9-field adapter-agnostic subset (`src/types.ts` — `name`, `description`, `prompt`, `tools`, `disallowedTools`, `model`, `skills`, `maxTurns`, `effort`). The SDK fields it does not carry are documented as deliberate omissions with a stated reason, not as gaps to close.
- **One home honoured.** The envelope and its inheritance rules are unified contract → M06. The concrete `Options.agents` mapping is adapter detail → A01. The `permissionMode` *mechanism* is stated **once**, in M06's L1 inheritance table; M15, A01 and M06's L4 cross-link it rather than restating it.
- **Path-scope is inherited, and inheritance is not negotiable.** A subagent may hold a *different toolset* than its parent — specialisation is the point of delegating — but it may never reach a path the run cannot reach. The two surfaces are deliberately asymmetric: the toolset moves in both directions inside the run's ceiling; the filesystem scope only ever equals it. The reasoning is M06's own, applied one surface over: a confinement that ends where delegation begins is not a confinement.
- **The guarantee is conditional on a declared scope, and the spec must say so.** Without `allowedPaths`/`disallowedPaths` the claude-code session runs `permissionMode: 'bypassPermissions'` — there is no ceiling to inherit. The invariant reads "a subagent's reach equals the run's", not "a subagent is confined".
- **Asserted now, measured by step 8.** Reading the adapter, both enforcement paths hold it by construction — the hard path is `options.sandbox`, OS-syscall enforcement over the whole process, which a subagent cannot be outside of; the soft path is `permissionMode: 'dontAsk'` plus `options.settings.permissions`, which the SDK declares as *session*-scoped, and `AgentDefinition.permissionMode` — the only per-agent override the SDK offers — is a field this library never sets (the only `permissionMode` assignment in `src/` is the session-level one). That is confirmed in the adapter source but **not** at runtime, and this spec's own standard for the neighbouring `task_*` behaviour is "measured, both pins". Until step 8's e2e leg is green, M15's statement carries an explicit *verification pending* marker; landing the leg removes it.

<!-- anchor: 0qxdd3hs -->
## Changes

<!-- anchor: qlytkem1 -->
### 1. M06 — L1 section (`0f6287ae`): the envelope

Add a `###` subsection *Subagent definition envelope* under the existing L1 section. It is the first H3 on M06 (the page is flat today, 67 lines) and that is deliberate: three other pages — M15, M04, A01 — need a stable anchor to link at, which bold lead-in prose cannot give them. The page lands around 110 lines, well inside the budget; no split.

It holds three things.

**A field table** — field, required, what omission means, the guarantee it carries:

| Field | Req | Omitted → | Guarantee |
|---|---|---|---|
| `name` | ✅ | — | the agent type the model invokes; unique within a call |
| `description` | ✅ | — | *when* to delegate here; the model reads it to route |
| `prompt` | ✅ | — | the subagent's own system prompt |
| `tools` | | inherits the parent's tools; **under an M18 policy, the run's residual allow-list** | allow-list, then intersected with M18 |
| `disallowedTools` | | **under an M18 policy**, the run's denies; with no policy, nothing — a subagent does not natively inherit parent denies | unioned with the run's denied built-ins |
| `model` | | inherits the main model | verbatim to the SDK; **not** re-resolved through M02 |
| `skills` | | none preloaded | names, not bodies — delivery is M05's |
| `maxTurns` | | SDK default | bound on agentic round-trips |
| `effort` | | SDK default | named levels only; the SDK's integer form is not exposed |

Two precision notes the earlier draft got wrong, both load-bearing:

- The `disallowedTools` and `tools` defaults are **conditional on an M18 deny-group being in play**. Without one the adapter passes neither field, and the SDK's own inheritance applies — which for denies means *no* inheritance (<section_ref anchor="677rc2wh"/>). Stating the row unconditionally would make the table contradict tier 3 below.
- `effort` and `maxTurns` map identically (field absent → SDK default). Do not write "inherits" for one and "SDK default" for the other; the spec has no evidence the SDK inherits effort, and inventing one is exactly the kind of claim M06 currently gets blamed for not having.

**An explicit inheritance statement in three tiers**, since this is what the spec cannot currently answer. The tiers say not just *what* is inherited but *whether the definition gets a vote*.

| Tier | What | The definition's vote |
|---|---|---|
| Fresh per subagent | system prompt, conversation, turn budget | total — `prompt` replaces, never extends |
| Inherited unless narrowed | toolset, MCP servers, model | may narrow, never widen |
| Inherited unconditionally | M15 filesystem path-scope, M18 deny-groups | none — no field expresses either |

**Fold, do not duplicate.** L1 already carries *"A subagent's tool set is derived, not independent. `SubagentDefinition` may narrow the tools its subagent gets, but it may never widen past the parent run's effective policy."* That sentence **is** tier 2 — absorb it into the table row and delete it from the surrounding prose rather than leaving both on the same page.

Tier 3 carries the load, and the two entries reach it by *different mechanisms* — say so, because a reader who assumes symmetry will hunt for propagation code that does not exist:

- **M18 deny-groups** — by explicit propagation (the rule already in this section), because the SDK would otherwise let a subagent out.
- **M15 path-scope** — because the envelope has **no field that could express a scope**, and the one SDK field that could re-open it (`AgentDefinition.permissionMode`) is never set by this library, deliberately. This is the single home of that mechanism; step 3 and step 7 link here.

State the conditionality once, here: the invariant is *"a subagent's reach equals the run's"*. On a run with no declared path-scope there is no ceiling, and tier 3 is vacuous rather than violated.

**The validation contract** — `validateSubagents` requires non-empty `name` / `description` / `prompt`, requires names unique within the call, and throws **before** the run rather than mid-stream. Currently only the failure timing is in the spec (an edge case at <section_ref anchor="4b8iv50p"/>); the rules themselves are not.

<!-- anchor: 5hv91uq2 -->
### 2. M06 — L2 matrix (`1zx424gy`): the missing row

Prepend a **Definition accepted (`subagentDefinition`)** row to the support matrix, keeping its existing `Behavior | claude-code | codex | gemini | opencode` columns — ✅ claude-code, ⚠️ warn-and-ignore for codex / gemini / opencode. This is where the capability flag belongs; the matrix is its canonical home and today it is asserted only in the adapter files and in `architectureCapabilities`.

Note in the row (or a following sentence) that the `claude-code` column covers the `claude-code-*` variants — `claude-code-ollama` and `claude-code-minimax` also report the flag true, and the matrix's four columns would otherwise read as an exhaustive list.

<!-- anchor: 5lcwm0tn -->
### 3. M06 — L4 section (`gz6lltyi`): what we deliberately do not expose

L4 is *Public API & Packaging*, so what belongs here is the **export decision**, not the security argument. Extend the one-line export list with a short list of the SDK capabilities the unified envelope withholds, one clause of reason each:

- `permissionMode` — withheld because it is the SDK's only per-agent override of the session permission posture, and exposing it would let a definition set itself back to `bypassPermissions`. **The mechanism is not restated here** — one clause plus `<section_ref>` to step 1's tier-3 paragraph, which is its home.
- `background` — a fire-and-forget agent is the exact shape M06's scope rule separates from itself (<section_ref anchor="70dpqgcb"/>); it would land a subagent in M17's lifecycle.
- `mcpServers` — per-subagent MCP would be a second, adapter-specific MCP surface next to M04's unified one; inheritance-plus-toolset-filtering covers the observed need.
- `memory`, `initialPrompt`, `observer` / `observerMessage`, `criticalSystemReminder_EXPERIMENTAL` — claude-code-only constructs with no analogue on the other three adapters; carrying them would make the envelope untranslatable and put a `_EXPERIMENTAL` field under our semver promise.

<!-- anchor: 1wvdc0f8 -->
### 4. M06 — Dependencies (`7tmzge8v`): the undeclared relations

Add four rows to the existing `Module / Layer | Relation` table (M18's row is already there and stays):

| M02 | a definition's `model` is passed through verbatim — subagent models are **not** resolved against the catalog. |
| M04 | a subagent has no MCP config of its own; it inherits the run's servers, filtered by its toolset. |
| M05 | `skills` names skills; delivery and discovery stay M05's. |
| M15 | a subagent's reach equals the run's path-scope — the envelope has no field that could narrow or widen it. |

<!-- anchor: 81fi8fcd -->
### 5. M06 — Edge cases (`4b8iv50p`)

Five additions to the existing list, each observable:

- Definition omits `tools` on a run with M18 denies → inherits the run's *residual* allow-list, not the SDK's full default.
- Definition sets `model` to a unified alias the catalog knows but the SDK does not → passed through unchanged and fails SDK-side, because M02 resolution is bypassed by design.
- Definition names a `skill` that M05 did not deliver for this adapter → the subagent starts; the skill simply is not there.
- Two definitions share a `name` → `validateSubagents` throws before the run; neither is registered.
- **Definition supplies a `tools` allow-list naming `Bash` on a run under soft path-scope** → the subagent does not get it. M15's default-deny posture pre-approves only the file built-ins (<section_ref anchor="x2258xmh"/>), so shell and web are withheld from parent and subagent alike, and an allow-list cannot hand back what the run never held. This is the sharpest illustration of "narrow, never widen" — sharper than a `Read`/`Write` list, which the parent holds anyway.

<!-- anchor: gxluvnns -->
### 6. A01 — Per-capability consumption (`sw3cwrsm`)

Replace the single bullet *"maps `subagents` to `Options.agents`; both defines and observes lifecycle"* with the concrete mapping the adapter performs, keeping the semantics in M06 and only the wiring here:

- `name` becomes the **key** of `Options.agents`; the SDK's `AgentDefinition` has no name field of its own.
- `tools` / `disallowedTools` pass through `subagentToolPolicy` — the M18 intersection, per M06's propagation rule. Worth stating exactly: when a tool policy is in play the subagent's `tools` is **always pinned** (to the filtered list, or to the run's full residual allow-list when the definition omitted it); when there is no policy, neither field is sent and SDK defaults apply.
- `model`, `skills`, `maxTurns`, `effort` map 1:1 and are omitted from the SDK object entirely when unset, so SDK defaults apply rather than an explicit null.
- Cross-link to M06's envelope subsection rather than restating the field table.

<!-- anchor: 0xt4059b -->
### 7. M15 — path-scope survives delegation

M15 is where a consumer looks to learn what confinement it bought, so the invariant has to be answerable there and not only in M06. Split by altitude, so the adapter-specific machinery does not leak into a unified module's Purpose:

- **Purpose (`ot3zqa0a`)** — two adapter-agnostic sentences: the declared scope binds every agent in the run, spawned helpers included; a subagent may hold a different toolset but never a wider reach. `<section_ref>` to M06's envelope subsection for the why. **No SDK field names here.**
- **L2 (`8pg5iti3`)** — the per-adapter mechanism, which is where M15 already keeps claude-code specifics: process-wide OS enforcement on the hard path; session-scoped permission rules plus the never-set `AgentDefinition.permissionMode` on the soft path. Different machinery, same guarantee, and the reader should know which one they are relying on. Carry the **verification-pending marker** here — the soft path is asserted from the adapter's construction and is measured by step 8's e2e leg; the marker comes off when that leg is green.
- **Dependencies (`xtryst7i`)** — an M06 row mirroring step 4's M15 row, so the relation is declared from both ends.
- **Edge cases (`x2258xmh`)** — a run under soft path-scope delegates to a subagent whose definition names `Read` → the read is evaluated against the same allow/deny rules as the parent's, so an out-of-ceiling path is refused for the subagent exactly as it is for the parent.

No change to the strength taxonomy: a subagent under a soft scope inherits a *soft* scope, with all the caveats `soft` already carries in <section_ref anchor="8pg5iti3"/>. Inheritance transfers the boundary, not its enforcement strength.

<!-- anchor: pk0txtl5 -->
### 8. e2e — turn the invariant into a probe

The hard path needs no probe: OS-syscall confinement over the process is not something a subagent can be outside of. The soft path does, for two reasons — it is the path most consumers actually get (the OS sandbox is opt-in and host-dependent), and this repository has already been wrong once in precisely this shape, when a soft deny was found not to be enforced against a live read.

Three edits, all spec-side; writing the test is the implementer's, downstream of a separate brief:

- **M12 scenario catalog (`xe2ecat1`)** — the catalog already carries a `subagents` row in its two-column `Scenario | What it proves (real-model)` table. **Extend that row's second cell** with the soft-path-scope leg (a confined run delegates to a subagent asked to read outside the ceiling; the read is refused). Do not add a second `subagents` row.
- **A01 e2e coverage (`a01e2ecv`)** — the three-column table currently reads `subagents (+ consumer-defined subagent) | M06 | ✅ covered`. The new leg is not implemented, so ✅ would be false: move the row to `⚠️ partial` with the missing leg named, and restore ✅ when the test lands.
- **`ac` entities** — see step 10; the probe needs the invariant criterion *and* an e2e-scenario criterion that `verifies` it, per this project's established pattern.

**If that probe comes back red, the invariant is a defect report, not a documentation gap** — the spec would then be describing a guarantee the adapter does not deliver, and the fix flows through the brief → implementer pipeline.

<!-- anchor: pyq81e56 -->
### 9. M04 — a subagent's MCP inheritance

Two sentences plus a Dependencies row: a subagent does not carry its own MCP configuration, so it sees the run's servers narrowed by its own toolset — an `mcp__server__*` entry in `disallowedTools` is therefore the only per-subagent MCP control. Points at M06 rather than duplicating it. Note the boundary M04 already declares against M18 (tool gating covers built-ins only) is untouched by this.

<!-- anchor: 20ms5tll -->
### 10. `ac` entities — tagged `m06` / `m06-edge`

M06's AC list is embedded by tag (`<tagged_list type="ac" tags="m06"/>`), so the section does not grow with the prose unless entities are created. New criteria:

**Requirements** (tag `m06`, `kind: requirement`):
- a definition omitting `tools` inherits the run's residual allow-list
- a definition's `model` reaches the SDK unresolved
- a subagent's `prompt` replaces, not extends, the parent's system prompt
- **a subagent's filesystem reach equals the run's declared path-scope** — tagged `m15` as well as `m06`, since it is the one criterion both modules own a side of

**Edge case** (tags `m06` **and** `m06-edge`, `kind: edge-case`) — edge criteria in this project carry both tags, not the sibling alone:
- a `tools` allow-list naming a tool the run's path-scope posture withholds does not restore it

**The e2e criterion** (tags `m06`, `m15`) — following the existing pattern (`ac-claude-code-e2e-path-scope-scenario`, `ac-claude-code-e2e-os-sandbox-degrade`), the probe from step 8 is its own criterion whose `verifies` points at the path-scope-reach criterion above.

Two conventions the earlier draft stated wrongly, both worth getting right because this step is executed with tools:

- **`verifies` takes `ac` slugs only.** `ac` is the only active entity type in this project, so "links to the entities each one checks" has no other referent. Ordinary requirement and edge-case criteria leave `verifies` empty — every existing `m06` criterion does — and only e2e-scenario criteria populate it.
- **No criterion for "`subagentDefinition: false` warns once."** It is already covered twice: <inline_mention type="ac" slug="ac-an-observe-only-adapter-that-cannot-defi"/> carries the degradation, and the codex-tagged criterion carries the once-only warning. Adding a third would be a duplicate, not a gap closed.

Finally, **update the AC section's intro prose** (`o0e0wak5`). It currently reads *"These verify lifecycle observability and that the optional `subagentTaskId` is always safe to read"* — true of the old six criteria, false once the envelope and path-scope criteria join them.

<!-- anchor: 2h9pf0cp -->
### 11. Index — drift check

- **Key relations (`vancl72m`)** — the section is a fenced ASCII diagram of `──>` edge lines, not a table. Add the M06→M02 / M06→M04 / M06→M05 / M06→M15 edges introduced in steps 4 and 7 in that existing arrow form.
- **Open questions (`0aj92zki`)** — **no-op, verified.** The eight entries were checked: item 5 parks M15's deferred design decisions (read/write split, gemini `targetDir`, deny-expressible signal) and item 6 the M18 resolution, but **none** parks subagent path-scope inheritance. There is no stale entry to remove; do not open a new one either, since the question is now decided in M06 and M15.

<!-- anchor: ubiblu0d -->
### 12. M18 — name the asymmetry from the other side

M18 explains that the `shell` deny-group reports `soft` *because* a spawned subagent does not inherit the parent's denies (<section_ref anchor="677rc2wh"/>). Once M06 and M15 assert that path-scope *does* survive delegation, that reads as a contradiction to anyone entering from M18.

One sentence in M18's escape-surfaces section: the two surfaces are asymmetric by construction — denies must be propagated because the SDK does not carry them, while path-scope needs no propagation because no envelope field can express a scope and the one SDK field that could is never set. `<section_ref>` to M06's tier-3 paragraph; no restatement of the mechanism.

<!-- anchor: o4bye0pm -->
## Out of scope

- Any `src/` edit. Steps 1–12 describe shipped behaviour; nothing here needs code to follow. Step 8's test is written from a separate brief, after this plan lands.
- Exposing `mcpServers` or any other withheld SDK field — that would be a contract change, needing its own brief.
- **M07 resume interaction.** M15's path fields are immutable across a resumed session; whether `subagents` may change on resume is a separate question about `getSessionResumeConstraints`, not about the envelope. The invariant holds either way — a redefined subagent still inherits the frozen ceiling — so this plan names the question and leaves it.
- M17's `task_*` routing and M18's propagation mechanics, both already specified; step 12 only cross-links the latter.
