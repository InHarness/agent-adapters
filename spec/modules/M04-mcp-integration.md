<!-- anchor: qc2hah4x -->
# M04 — MCP integration

> One way to declare MCP servers and tools, normalized across adapters whose native MCP support ranges from "all transports" to "stdio only" to "must pre-configure out of band".

<!-- anchor: e6ebvy2b -->
## Purpose

Developers can describe MCP servers and in-process tools once (`createMcpServer`, `mcpTool`) and pass them through `RuntimeExecuteParams.mcpServers`, letting each adapter wire them to its SDK — or degrade clearly when it can't. M04 owns the builders, the `McpServerConfig` shape, and — per the one-home rule — **the per-adapter MCP transport support matrix**. MCP tool calls surface through the unified `tool_use`/`tool_result` events; MCP elicitation surfaces as `user_input_request`.

<!-- anchor: l9tuggo7 -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | MCP tool calls → `tool_use`/`tool_result`; elicitation → `user_input_request` (`source:'mcp-elicitation'`). |
| L2 | Owns the MCP transport support matrix + degradation per adapter. |
| L4 | Exports `createMcpServer`, `mcpTool`, `McpServerConfig` from the package root and the `./mcp` subpath. |
| L7 | Declares the `@modelcontextprotocol/sdk` peer-SDK range + hard version gate (no adapter owns this peer). |
| M01 | `mcpServers` is a `RuntimeExecuteParams` field; adapters read it. |

<!-- anchor: bswjwsmn -->
## Unified Contract (L1)

- An MCP tool invocation normalizes to `tool_use { toolName, toolUseId, input }` and its outcome to `tool_result { toolUseId, summary, isError? }`.
- MCP **elicitation** (server asking the user) normalizes to `user_input_request { source:'mcp-elicitation' }`, routed to `onUserInput`. The legacy `elicitation_request`/`onElicitation` path is bridged for back-compat.

<!-- anchor: fv7bhx0s -->
## Capability & Degradation (L2)

**MCP transport support matrix** (the canonical home — adapters link here):

| Transport / behavior | claude-code | codex | gemini | opencode |
| --- | :---: | :---: | :---: | :---: |
| Dynamic config from `mcpServers` | ✅ stdio / SSE / HTTP / SDK | ❌ must pre-register via `codex mcp add` | ✅ stdio / SSE / HTTP / TCP | ⚠️ **stdio only** |

Degradation rules:
- **codex** — cannot accept servers dynamically through `mcpServers`; they must be pre-configured out of band. Passing `mcpServers` to codex → **warn** (one-shot) and skip.
- **opencode** — non-stdio transports (SSE/HTTP) are unsupported → **warn** and skip the unsupported entries; stdio entries pass through.
- **claude-code / gemini** — full pass-through across their listed transports.

<!-- anchor: somkcqph -->
## Public API & Packaging (L4)

Exports `createMcpServer`, `mcpTool`, and the `McpServerConfig` type from **both** the package root (backward-compat) and the narrow `./mcp` subpath. `./mcp` carries **no adapter class** in its static import graph — `src/mcp.ts` has zero adapter/SDK imports — so a consumer importing only the MCP builders avoids pulling `GeminiAdapter` + `@google/gemini-cli-core` `.wasm` assets in via the root barrel. The root export stays for compatibility.

<!-- anchor: 9e2jmq7n -->
## SDK compatibility & schema drift (L7)

M04 is the home of the `@modelcontextprotocol/sdk` peer-dependency, which no adapter owns — so M04 (a capability-module, not an adapter) fills the L7 slice for it.

- **Supported peer-SDK range** — `@modelcontextprotocol/sdk` `>=1.0.0 <2.0.0` (dev-pinned `^1.29.0`; MCP has held a stable, additive 1.x line, so the range is a full major rather than a single minor). Confirmed as the verified range in the release brief (M12), narrowing the current `>=1.0.0` only if a lower bound proves necessary.
- **Version gate (HARD)** — where the MCP SDK is loaded, read its version and `satisfies(range)`; a mismatch **emits** `error` `phase:'init'` (`AdapterInitError`), non-suppressible.
- **Version-acquisition mechanism** — resolve `@modelcontextprotocol/sdk` `package.json` `version`; fall back to the nearest resolvable manifest if the `exports` map hides it.
- **Availability probe** — the MCP SDK is loaded lazily only when in-process `sdk` servers / the `createMcpServer` / `mcpTool` builders are used; absence surfaces as `AdapterInitError`.
- **Known schema-drift points** — none identified in-range yet (MCP 1.x has been additive); the `McpServerConfig` transport shapes are the exposed surface.
- **Defensive-read / in-range degradation** — transports are mapped per-adapter and unsupported transports already degrade via the <section_ref anchor="fv7bhx0s"/> matrix, so a new or reshaped transport degrades to a warn/skip, never a crash.

<!-- anchor: wxyessab -->
## Edge cases

- opencode with an SSE/HTTP MCP server → that server is skipped with a warning; the run continues with the stdio servers.
- codex with any `mcpServers` entry → one warning, entries ignored (pre-registration is the supported path).
- An MCP server emits an elicitation but no `onUserInput` handler is provided → surfaced per M11/L1 user-input semantics (no silent drop of the request).
- **The engine's MCP *client* can refuse the elicitation before the adapter ever sees it.** Elicitation is a client capability and may be advertised only in part: measured on claude-code (`@anthropic-ai/claude-agent-sdk` 0.3.153, 2026-07-27), an in-process SDK-MCP server calling `elicitInput({ message, requestedSchema })` — which resolves to **form** mode — is rejected inside the MCP layer with `Client does not support form elicitation`. No `elicitation/create` is forwarded, so no `user_input_request` is owed and the adapter bridge is never reached. The server sees the throw and reports it as its own tool error; the model then typically recovers by asking through whatever ask-user tool it has, which arrives as `source: 'model-tool'`. Two consequences: a correct adapter-side bridge does **not** imply the path is live end-to-end, and any live test for it must key on `source: 'mcp-elicitation'` specifically — keying on "a user-input request happened" reads the model's fallback as success. Whether the same client accepts **url**-mode elicitation is untested.

<!-- anchor: de94pzsi -->
## Acceptance criteria

These verify uniform declaration and that every unsupported transport degrades with a warning, never a crash.

<tagged_list type="ac" tags="m04"/>
