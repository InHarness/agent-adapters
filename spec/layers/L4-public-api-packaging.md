<!-- anchor: qe5t11gr -->
# L4 — Public API & Packaging

> What the package exports and how it ships: tree-shakeable subpath entry points, the optional-peer-dependency model per adapter, dual ESM+CJS output, and the semver / deprecation policy.

<!-- anchor: azvxcm7l -->
## Role in the system

L4 is the boundary between the library and its consumers. It governs which symbols are public, how they are imported (subpath exports so unused adapters tree-shake away), how peer-deps stay optional per adapter, and how the contract evolves under versioning. It does NOT define behavior — only surface and distribution.

<!-- anchor: hwhgr8bv -->
## Module slice schema

- **Capability-module (consumer)** — a `## Public API & Packaging (L4)` section naming the symbols it exports, the subpath they ship under (the package root unless noted; `/testing` for the conformance toolkit; `./mcp` for the adapter-free MCP builders `createMcpServer` / `mcpTool` / `McpServerConfig`), and any peer-dependency it implies. A module declares a narrow subpath in this section when a consumer needs a subset of symbols whose root-barrel neighbors would drag heavy optional-peer assets into the **bundler's static import graph** — e.g. bundler static analysis of dynamic `import()` specifiers inside adapter chunks reachable from the root barrel pulls in `@google/gemini-cli-core` `.wasm` assets. This is **distinct** from the runtime eager-require hazard; it is a surface/distribution convention, not behavior.
- **Adapter (consumer)** — adapters surface no public symbols of their own beyond being registered, so an adapter's L4 concern is only *that* its wrapped SDK is an optional peer-dependency (packaging). The **supported version range, the runtime version gate, and schema-drift handling** are declared in the adapter's `## SDK compatibility & schema drift (L7)` section, not here — L4 owns how the peer-dep is *packaged* (optional, tree-shakeable), L7 owns which *version* is supported at runtime.
- **Implementor (external — tsup + `package.json`)** — the build and the `exports` map own the actual subpath wiring; `M12` owns the semver / deprecation *policy* in its own L4 section.

> **Implementor module:** `external — tsup + package.json` (build + `exports` map). No in-spec implementor module; M12 owns the semver/deprecation *policy* in its L4 section.
