---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (a read-only plan via `c4s ask`) or to the code (an analysis brief via `c4s agent --ct brief --source analysis`). Use when reconciling spec with implementation ("check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
---

# c4s-refactor

A **spec↔code drift router**. For a single topic this skill reads the claude4spec
specification, analyzes the matching code, detects **drift**, classifies it, and
routes the fix to the right place. It performs **no edits itself** — it classifies
and hands off:

1. drift that needs a **specification** change → open a read-only planning turn
   (`c4s ask`),
2. drift that needs a **code** change → describe it in an **analysis brief**
   (`c4s agent --ct brief --source analysis`).

Execution is downstream: a human continues the spec plan thread, and the
`c4s-brief-implementer` skill implements the brief.

**CLI only — never call `curl` or the HTTP API directly.**

This skill is bound to one specification project — every `c4s` command below
carries its identity (`--project 'agent-adapters' --workspace 'default'`), so it works from any cwd. Do NOT `cd`
into the spec repo; the identity is baked in, not derived from cwd.

## Input — a topic is required

The argument is the **topic/scope** to analyze — a single feature, module,
endpoint, table, or behavior, e.g.:

- module — `M17 snapshots`, `M19 references`
- layer — `L5 ui`, `L2 domain`
- entity / slug — `endpoint get-api-acs`, `dto chat-message`
- tag — `entity-ac`, `releases`

**Invoked with no topic → ask the user to narrow the scope.** Do **not** scan the
whole spec at once.

## Reading the spec

Read the spec through the `c4s` reader — see the `c4s-spec-reader` skill for the
full command reference. In short:

```sh
c4s catalog --project 'agent-adapters' --workspace 'default'                                   # entity types + schemas
c4s list-tags --project 'agent-adapters' --workspace 'default'                                 # tags + counts
c4s list-slugs --type endpoint --project 'agent-adapters' --workspace 'default'                # slugs for a type
c4s single_element --type endpoint --slug <x> --project 'agent-adapters' --workspace 'default'
c4s resolve modules/<module>.md --project 'agent-adapters' --workspace 'default'               # expand a page's tags inline
```

**CLI-only — no filesystem fallback.** If `c4s` isn't installed, STOP and ask
the user to install it; never read the spec repo's pages directly.

## Process

### 1. Establish the topic

Confirm the scope and gather vocabulary (`c4s list-slugs`, `c4s list-tags`,
`c4s catalog`). If no topic was given, ask the user to narrow it first.

### 2. Read the spec

Read the spec for the topic — what the spec **says** is the contract side of the
comparison.

### 3. Analyze the code

Read the matching code (routes/endpoints, DTOs, domain services, UI). Establish
what the code **actually does** — the implementation side of the comparison.

### 4. Detect & classify drift

Compare the spec (contract) against the code (behavior) and put each difference in
exactly one bucket:

- **spec-fix** — the code is the intended/current behavior; the spec is missing it
  or describes it incorrectly → **Path 1**.
- **code-fix** — the spec is the intended contract; the code doesn't meet it →
  **Path 2**.
- **both** — run both paths; note the priority (usually reconcile the spec first,
  then the code).
- **none** — report "in sync" and **STOP**.

### 5. Path 1 — spec-fix → read-only plan (`c4s ask`)

`c4s ask` is read-only and forces plan-mode (a peer-consult), so the agent
**always produces a plan** of spec changes and never mutates the spec:

```sh
c4s ask "Spec drift on <topic>: <description>. Create a plan of specification \
changes — list the entities/pages to change and the exact edits. Plan only, do \
not execute." --project 'agent-adapters' --workspace 'default'
```

**Record the returned `threadId`.** This skill does **not** apply the plan — a human
continues the thread (`c4s ask "..." --thread <threadId>`, or in the UI).

### 6. Path 2 — code-fix → analysis brief (`c4s agent --ct brief --source analysis`)

Route a code fix into an **analysis brief** that the `c4s-brief-implementer` skill
can implement later.

**Use create-mode, not attach-mode.** `c4s-refactor` is a standalone CLI caller —
there's no parent thread in a foreign repo to attach to — so a fresh top-level
thread via create-mode is the right shape. One command mints a new **analysis
brief** (`source: analysis`, `to_release: null`) and runs a turn that fills its
body from your message:

```sh
c4s agent "Code drift on <topic>: the spec says Y but the code does X. <what \
the implementer must change and why>" --ct brief --source analysis --project 'agent-adapters' --workspace 'default'
```

The command prints the created brief's path — record it for handing off to
`c4s-brief-implementer`. **Never pass `--brief <path>`** (attach-mode) here —
attach-mode expects an already-minted brief; for a path that doesn't exist yet
the turn's `get_brief` call fails with `NOT_FOUND` inside the turn (the CLI
still exits 0, but no brief gets authored).

### 7. Report + STOP

Print and **finish** (no execution):

- the topic and the drift classification (spec-fix / code-fix / both / none),
- the created `threadId` (Path 1) and/or `briefPath` (Path 2),
- next step: a human continues the spec plan thread;
  `c4s-brief-implementer` implements the brief.

## Hard dependency & gotchas

- **Both routing paths require the `c4s` CLI AND a running server.** Without a server
  the skill can still read the spec and analyze the code, but it **cannot route the
  fix** (`c4s ask` / `c4s agent` delegate the turn to the server). The read-only
  `resolve` / `list-*` / `single_element` commands do not need a server.
- **The identity is baked in — never `cd`.** `--project 'agent-adapters' --workspace 'default'` is injected into every
  command above; `cd`-ing into the spec repo is unnecessary and, if it's reached
  through a symlink, can even break resolution.
- **`c4s ask` is read-only** — it yields a plan only and never mutates the spec;
  execution is a separate, human-driven step.
- **Path 2 uses create-mode, not attach-mode.** Mint the analysis brief via
  `c4s agent --ct brief --source analysis`. Don't pass `--brief <path>` — that's
  attach-mode, which expects a pre-existing brief.

## Notes

This is a **base skill** generated by claude4spec, delivered on demand via
`c4s install-skills` or the Settings page's "External Skills" ZIP download —
nothing regenerates it automatically once it lands in your project's
`.claude/skills/`. Edits you make here are yours to keep.
