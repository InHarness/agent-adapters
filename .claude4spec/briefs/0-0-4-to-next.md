---
type: brief
source: analysis
from_release: 0.0.4
to_release: null
generated_at: '2026-07-08T09:39:38.938Z'
generator_version: brief-author@0.1
implemented: false
---
# Analysis brief: 0.0.4 → (next)

This brief records a **spec ↔ code drift**, not a shipped release diff. The specification now canonizes a new package subpath — `@inharness-ai/agent-adapters/mcp` — that exposes the in-process MCP server API (`createMcpServer`, `mcpTool`, and the `McpServerConfig` type) with **zero adapter classes and zero optional peer SDKs anywhere in its static import graph**. The package code does not yet ship this subpath. The point of the change is tree-shaking: a consumer who only builds in-process MCP tools (and bundles with esbuild/webpack) can import from `/mcp` and never drag in an adapter class — nor its optional peer SDK, e.g. `@google/gemini-cli-core` and its tree-sitter `.wasm` assets — through the module graph.

The change is **purely additive and backward-compatible**: `createMcpServer`, `mcpTool`, and `McpServerConfig` stay exported from the package root (`.`) exactly as before. The new `/mcp` subpath is a second, lighter door to the same symbols.

<!-- anchor: whatchanged -->
## What the system does differently

Before: the only public entry points were the package root `.` plus the adapter subpaths and `./testing`. Importing the MCP helpers meant importing from the root, whose static graph can transitively reach adapter classes and their peer SDKs.

After: a dedicated `./mcp` subpath resolves to a build artifact (`dist/mcp.js` / `dist/mcp.cjs` / types) produced from `src/mcp.ts`. That source file already has **zero adapter or SDK imports** (confirmed — no source change needed in `src/mcp.ts` itself). The subpath is wired so its emitted bundle's static import graph never reaches `src/adapters/*.ts` or any of the four peer SDKs. This is guarded by a permanent regression test, so the isolation cannot silently rot.

The root export and `src/index.ts` are unchanged — this does not move or remove any symbol.

<!-- anchor: forimpl -->
## For implementers

Ordered by dependency. All changes are in the package repo (`@inharness-ai/agent-adapters`); `src/mcp.ts` needs no edit — it already has zero adapter/SDK imports.

1. **`tsup.config.ts`** — add a build entry `mcp: 'src/mcp.ts'` alongside the existing `index` / `adapters` / `testing` entries, so the bundler emits `dist/mcp.{js,cjs,d.ts,d.cts}`.

2. **`package.json` → `exports` map** — add a `"./mcp"` entry that mirrors the shape of the existing `"./testing"` entry: both `import` and `require` conditions, each with `types` + `default`, pointing at the new `dist/mcp.*` artifacts. For example:

   ```jsonc
   "./mcp": {
     "import": { "types": "./dist/mcp.d.ts",  "default": "./dist/mcp.js"  },
     "require": { "types": "./dist/mcp.d.cts", "default": "./dist/mcp.cjs" }
   }
   ```
   (Match the exact condition ordering/shape of the sibling `"./testing"` entry.)

3. **Keep `src/index.ts` and the root `"."` export unchanged.** `createMcpServer`, `mcpTool`, and `McpServerConfig` MUST remain exported from the package root for backward compatibility. This step is a deliberate no-op guard — do not remove the root re-exports.

4. **`README.md` — two sections:**
   - *Tree-shakeable imports* (~line 540): list `@inharness-ai/agent-adapters/mcp` alongside the four adapter subpaths.
   - *In-process MCP servers* (~line 312): show importing `createMcpServer` / `mcpTool` from `@inharness-ai/agent-adapters/mcp` as the **recommended** pattern for consumers who bundle with esbuild/webpack and want to keep adapter classes (and their optional peer SDKs, e.g. `@google/gemini-cli-core`'s tree-sitter `.wasm` assets) out of their static import graph.

5. **Regression guard — `src/no-eager-sdk.test.ts`** (extend the existing pattern, or add a sibling test): assert that the static import graph of `dist/mcp.js` — computed by BFS over import specifiers — never reaches `src/adapters/*.ts` nor any of the four peer SDKs. This is the exact regression the whole change exists to prevent, so it needs a permanent automated guard, not a one-off manual check.
