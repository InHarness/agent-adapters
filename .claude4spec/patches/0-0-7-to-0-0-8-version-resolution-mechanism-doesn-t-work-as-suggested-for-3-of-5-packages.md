---
type: patch
brief: 0-0-7-to-0-0-8.md
patch_kind: clarification
created_at: '2026-07-15T10:48:33.114Z'
created_by: unknown
status: awaiting
---
# Patch — version-resolution mechanism doesn't work as suggested for 3 of 5 packages

## What I found
The brief suggests resolving the installed peer-SDK version via `createRequire` / `require.resolve('<pkg>/package.json')`, with a manifest-walk fallback flagged as a caveat **only for claude-code** ("confirm the claude-agent-sdk package.json is reachable... before implementing the gate").

Testing this directly against the real installed packages in agent-adapters showed the problem is broader than one adapter:
- `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, and `@opencode-ai/sdk` **all** block the `./package.json` subpath in their `exports` map (not just claude-code).
- `@openai/codex-sdk` is ESM-only with only an `"import"` export condition — `createRequire(...).resolve('@openai/codex-sdk')` **throws** (`ERR_PACKAGE_PATH_NOT_EXPORTED`), so even the 'walk from the resolved main entry' fallback fails via CJS `require.resolve`.
- `@modelcontextprotocol/sdk/package.json` subpath resolves successfully but to a **decoy** nested manifest (`dist/cjs/package.json` = `{"type": "commonjs"}`, no `version` field at all) — silently wrong, not just unreachable.
- `import.meta.resolve()`, the natural ESM-native alternative, is invalid syntax outside real ESM. This package's build (tsup, `format: ['esm','cjs']`) produces a CJS bundle; building a scratch file with `import.meta.resolve()` through the real tsup config and `require()`-ing the `.cjs` output throws `SyntaxError: Cannot use 'import.meta' outside a module`.

## Suggestion
Implemented instead: walk the `node_modules` directory tree upward from the shared helper's own `import.meta.url`, checking `<dir>/node_modules/<pkgName>/package.json` at each ancestor level with plain `fs.existsSync`/`readFileSync` — the same directory-walk Node's own resolver uses internally, without going through `require`/`import` resolution or `exports` maps at all. Verified working for all 5 packages in both ESM and CJS tsup outputs. Suggest L7/A01's version-acquisition guidance be updated to describe this mechanism (or at least drop the 'claude-code-only' framing of the exports-map caveat, since it affects 3 of 5 consumers) so future adapters don't waste time on the require.resolve approach.

