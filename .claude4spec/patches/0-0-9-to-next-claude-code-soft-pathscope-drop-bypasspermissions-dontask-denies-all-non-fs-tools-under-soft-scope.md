---
type: patch
brief: 0-0-9-to-next-claude-code-soft-pathscope-drop-bypasspermissions.md
patch_kind: clarification
created_at: '2026-07-15T15:04:34.466Z'
created_by: unknown
status: awaiting
---
# Patch — dontAsk denies all non-FS tools under soft scope

## What I found
Implementing the soft path-scope fix, I chose `permissionMode: 'dontAsk'` (over `'default'`) for the default-deny gate. That decisively passes the acceptance test — it also blocks a `Bash cat`/`Grep` bypass of the disallowed file, which `'default'` would not reliably do in a headless run (unmatched tools fall through to an interactive prompt with undefined behaviour when no `canUseTool` is wired).

But `'dontAsk'` denies **every** tool not named in `permissions.allow`, not just out-of-ceiling filesystem access. My allow-confinement only lists `Read/Edit/Write(cwd ∪ allowedPaths/**)`. Net effect: under soft path-scope the agent also loses `Bash`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `Task`, etc. — even for legitimate in-ceiling work. That is strictly safer (Bash can escape any path rule, so denying it is arguably required for real soft confinement), but it is a broader behavioural change than "confine reads/writes," and the spec (A01 sw3cwrsm / M15 j4a1hr2q) frames confinement purely around reads/writes.

The live acceptance e2e (sonnet-4.6) passes green for both Read and Write blocking; the sibling adapter_ready / os-sandbox-degrade live tests also stay green.

## Suggestion
Make the spec explicit about the non-FS-tool posture under soft path-scope:
- **Option A (implemented):** default-deny everything; only `Read/Edit/Write` over `cwd ∪ allowedPaths` are allow-listed. Non-FS tools (Bash/Grep/Glob/WebFetch/WebSearch/Task) are denied within scope. Strongest confinement; closes the Bash/Grep read-bypass.
- **Option B:** additionally allow-list read-only builtins (and maybe curated MCP) so the agent stays functional within scope — but note Grep/Glob/Bash can each read file *contents* outside the ceiling, re-opening the leak, so this weakens the guarantee.

Recommend the spec state Option A explicitly (and that soft path-scope intentionally disables Bash and other content-reading tools), or introduce a separate knob for consumers who need in-ceiling Bash/read-only tools. Also worth a one-line spec note that `'dontAsk'` (not `'default'`) is the chosen default-deny mode, and why.

