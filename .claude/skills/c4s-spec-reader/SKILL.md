---
name: c4s-spec-reader
description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Use when working in a repository whose pages/ contain these tags or whose .claude4spec/ directory exists. Resolves entity slugs to full data via the c4s CLI.
---

# c4s-spec-reader

This skill is bound to one claude4spec specification project — every `c4s`
command below carries its identity (`--project 'agent-adapters' --workspace 'default'`), so it works from any cwd,
including a foreign code repo whose pages reference this spec's entities. Do
NOT `cd` into the spec repo; the identity is baked in, not derived from cwd.

**CLI-only — no filesystem fallback.** Every command below goes through
`c4s`. If `c4s` isn't installed, STOP and ask the user to install it —
never read the spec repo's pages or entity files directly.

## Resolving a tag

Install `claude4spec` (Node 20+) and use the `c4s` CLI. Subcommand names match
XML tag names 1:1 — append `--project 'agent-adapters' --workspace 'default'` to every command below.

| XML tag | CLI equivalent |
|---------|----------------|
| `<inline_mention type="endpoint" slug="X"/>` | `c4s inline_mention --type endpoint --slug X --project 'agent-adapters' --workspace 'default'` |
| `<single_element type="dto" slug="X"/>` | `c4s single_element --type dto --slug X --project 'agent-adapters' --workspace 'default'` |
| `<element_list type="endpoint" slugs="a,b,c"/>` | `c4s element_list --type endpoint --slugs a,b,c --project 'agent-adapters' --workspace 'default'` |
| `<tagged_list type="dto" tags="auth" filter="and"/>` | `c4s tagged_list --type dto --tags auth --filter and --project 'agent-adapters' --workspace 'default'` |
| `<tagged_list_mixed tags="public"/>` | `c4s tagged_list_mixed --tags public --project 'agent-adapters' --workspace 'default'` |

## Expanding a whole page

```sh
c4s resolve some-page.md --project 'agent-adapters' --workspace 'default'                # writes markdown with tags expanded inline
c4s resolve some-page.md --format json --project 'agent-adapters' --workspace 'default'   # writes { content, resolved: [...] }
```

## Discovery

- `c4s catalog --project 'agent-adapters' --workspace 'default'` — active entity types with counts + version + description + roleNoun + mcpToolsLine per type (smoke test).
- `c4s describe --type <t> [--view <v>] --project 'agent-adapters' --workspace 'default'` — JSON Schema per view for one type (on-demand).
- `c4s list-tags --project 'agent-adapters' --workspace 'default'` — all tags with per-type counts.
- `c4s list-slugs --type endpoint --project 'agent-adapters' --workspace 'default'` — all slugs for a given type.

All output is JSON (pretty) by default. Use `--compact` for pipelines and
`--format text` for terminal-friendly output. Errors go to stderr as JSON with
an exit code > 0.

The database is opened **read-only** — `c4s` never mutates the project.

## Asking the spec agent

When a question goes beyond resolving entities or pages, `c4s ask` runs a
synchronous agent turn against the specification:

```sh
c4s ask "<question>" --ct chat --project 'agent-adapters' --workspace 'default'
```

Unlike the read-only commands above, `c4s ask` requires a running
`npx @inharness-ai/claude4spec` server (it delegates the turn to the server's agent).

## Errors

If `c4s` reports `PROJECT_SLUG_NOT_FOUND` or `AMBIGUOUS_WORKSPACE` /
`AMBIGUOUS_PROJECT`, this skill's baked-in `--project 'agent-adapters' --workspace 'default'` identity no longer
resolves — regenerate the skill from the spec repo and re-copy it, or pass the
correct `--workspace <name>`. If `c4s ask` reports the server isn't recognized
as a claude4spec server, or that the project failed to build
(`PROJECT_BUILD_FAILED`), that's a problem on the spec repo/server side —
report it to the user; don't try to fix the spec repo from here.
