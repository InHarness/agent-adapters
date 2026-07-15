---
name: c4s-brief-implementer
description: Implement features described in claude4spec briefs. Briefs are self-contained markdown files (entity snapshots, section diffs, narrative) that live in the companion specification repository, reached from your code repo via the c4s CLI (c4s list-briefs / read-brief, with --project and --workspace baked in). After implementation, if you discover drift between the brief and reality (missing details, incorrect assumptions, edge cases not covered), file a patch via c4s file-patch as feedback for the specification author. Use when implementing a claude4spec brief in a code repository.
---

# c4s-brief-implementer

This skill describes how to implement a release brief in **your code repository** (not the spec repo). A brief is a self-contained markdown file that captures everything you need to ship the change: entity snapshots, section diffs, narrative, acceptance criteria. Briefs live in the **spec** repository, a different repo from the one you are working in — you never touch it directly; the `c4s` CLI reaches everything for you.

**Reaching the briefs.** This skill is **CLI-only**: it reaches the briefs and writes patches solely through the `c4s` CLI, with the spec project's identity baked into this skill (`--project 'agent-adapters' --workspace 'default'`) — `c4s list-briefs` / `c4s read-brief` / `c4s file-patch` work from any directory, without a running server (they are filesystem-scoped). If `c4s` is not installed, **stop** and ask the user to install it — do not read or write the spec repo's files by hand.

**The brief is self-contained.** You do not need to read the main specification or query the entity database — everything is in the brief body. If the brief references something you cannot find in its body, treat that as drift and file a patch (step 4 below).

## Workflow

### 1. Discover

List the briefs through `c4s` (paginated — briefs accumulate over time, so filter and page rather than dumping everything):

```sh
c4s list-briefs --status pending --limit 10 --project 'agent-adapters' --workspace 'default'
```

`--status pending` hides briefs already marked `implemented: true`; drop it to see all. Use `--offset` to page. Output lists each brief's `path` (which you pass to `read-brief`) and whether it is already implemented.

**Which brief do I implement?** If the user named a brief, use it. If not — and `list-briefs` returns more than one pending brief — **ask the user which one**; do NOT guess. Picking the wrong brief wastes an implementation pass. Only proceed automatically when there is exactly one obvious candidate (a single pending brief, or the user pointed at one).

### 2. Read the brief as self-contained input

Read the full brief by the `path` printed by `list-briefs`:

```sh
c4s read-brief <brief-path> --project 'agent-adapters' --workspace 'default'
```

The body contains everything you need — entity snapshots, section diffs, the narrative of what changes, and acceptance criteria. Read it and implement it; you do not need to understand how the brief was produced. **Do not read the main specification.**

If the brief is unclear — a missing detail, an ambiguous wording, a decision you'd otherwise have to guess — you have two paths.

**Synchronous (preferred when available).** Ask the specification agent in the same terminal and continue once you have an answer. Two distinct commands, by what context you need.

Preferred — context of THIS brief plus its release diff (the agent sees only the change window of the brief you are implementing):

```bash
c4s agent "Brief nie precyzuje X — czy chodzi o A czy B?" --ct brief --brief <brief-path> --project 'agent-adapters' --workspace 'default'
```

Alternative — read-only peer-consult of the CURRENT spec state (may be ahead of the brief you are implementing); no brief context, no `--ct`/`--brief`:

```bash
c4s ask "Jak dziala Y w aktualnej specce?" --project 'agent-adapters' --workspace 'default'
```

Continue the brief thread with `c4s agent "..." --thread <threadId> --project 'agent-adapters' --workspace 'default'` (the `threadId` is printed with the answer). This path requires `c4s` installed *and* a running `npx @inharness-ai/claude4spec` server. When either is unavailable, skip it.

**Asynchronous (always available).** If you cannot ask synchronously, proceed with your best judgement and file a patch afterwards (step 4) so the spec-author can fold the clarification into the next brief.

### 3. Implement

Standard code flow in your target repository: read existing code, plan, edit, test. Stay focused on what the brief specifies.

### 4. Feedback loop (patches)

When you discover that the brief diverges from reality — a missing detail, an incorrect assumption, an edge case not covered, or anything else the spec-author should know — file a patch. Use `c4s file-patch`, which records the patch on the spec side for you:

```sh
printf '%s\n' "$PATCH_BODY" | c4s file-patch \
  --brief <brief-path> --desc "<short-desc>" --kind drift \
  --project 'agent-adapters' --workspace 'default'
```

The body (from stdin, or `--body-file <f>`) goes below an auto-generated `# Patch — <short-desc>` heading. Structure the body as two sections: a `## What I found` section (the drift / missing detail / incorrect assumption) and a `## Suggestion` section (what the spec-author should consider in a follow-up brief or entity edits). `c4s file-patch` records all the metadata for you (which brief it relates to, the kind from `--kind`, defaulting to `drift`) — you only write the markdown body.

`--kind` values:

- `drift` — the brief described behavior X, but the codebase already does Y.
- `missing` — the brief is silent on a detail you had to decide yourself.
- `incorrect` — the brief is factually wrong about existing code.
- `clarification` — the brief is ambiguous; you guessed but it should be made explicit for next time.

### 5. Mark brief as implemented

When the implementation is genuinely finished — code committed, tests green, merged to main / accepted by the user — mark the brief as implemented (`implemented: true`):

```sh
c4s mark-brief-implemented <brief-path> --project 'agent-adapters' --workspace 'default'
```

Unlike the filesystem-scoped `c4s list-briefs` / `read-brief` / `file-patch`, this command **requires a running `npx @inharness-ai/claude4spec` server** — if it isn't up, ask the user to start it. There is no by-hand file edit: this skill is CLI-only.

`implemented: true` is a **declaration**, not a computed fact derived from git. A revert on main does NOT roll the flag back. Set it ONLY when implementation is realistically done — never proactively or "just in case".

### 6. Hand-off

The spec-author picks up your patches on the spec side and folds each deviation back into the specification. That lifecycle lives entirely in the spec repo; you only write the raw markdown patch body via `c4s file-patch`.