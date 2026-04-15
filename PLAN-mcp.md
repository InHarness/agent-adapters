# Plan: MCP Server Support in agent-adapters

## Context

`RuntimeExecuteParams` ma `builtinMCPServers` i `allowedMCPTools` — pola ze specyfikacji InHarness, **żaden adapter ich nie czyta**. Brakuje logiki tworzenia i podłączania MCP serwerów. Analiza SDK każdej architektury pokazuje:

| Adapter | MCP w SDK | Stan obecny |
|---------|-----------|-------------|
| **claude-code** | `createSdkMcpServer()` + `options.mcpServers` — pełne in-process MCP | Przekazuje `mcpServers` do SDK, ale tylko stdio config |
| **gemini** | `MCPServerConfig` + `McpClientManager` + `discoverMcpTools()` — pełne MCP (stdio/SSE/HTTP, OAuth, tool filtering) | Oznaczony EXPERIMENTAL, **zero** MCP wiring |
| **opencode** | stdio MCP w config | Działa, ale tylko stdio |
| **codex** | CLI ma `codex mcp add/list/remove`, ale **SDK nie eksponuje tego** — zero MCP w `ThreadOptions` | Obsługuje incoming `mcp_tool_call` events, nie konfiguruje serwerów |

## Kluczowe odkrycia

### `createSdkMcpServer` (claude-agent-sdk) — to cienki wrapper

```javascript
function createSdkMcpServer(options) {
  const server = new McpServer({ name, version });  // @modelcontextprotocol/sdk
  options.tools.forEach(t => server.registerTool(t.name, {...}, t.handler));
  return { type: 'sdk', name, instance: server };
}
```

To **5 linii kodu** nad `@modelcontextprotocol/sdk`. Identyczną logikę możemy mieć w naszej bibliotece jako generyczny helper.

### Gemini ma pełne MCP — trzeba to podłączyć

`@google/gemini-cli-core` eksportuje:
- `MCPServerConfig` (z `includeTools`/`excludeTools`, OAuth, wielu transportów)
- `McpClientManager` — zarządza wieloma serwerami
- `discoverMcpTools()` — discovery + rejestracja w ToolRegistry
- `connectToMcpServer()`, `createTransport()` — factory dla stdio/SSE/HTTP

Obecny gemini adapter **ignoruje** te capabilities — tworzy `LegacyAgentSession` bez przekazywania MCP config.

### Codex — SDK nie da się naprawić, ale CLI tak

Codex SDK (`@openai/codex-sdk`) spawnuje `codex exec`. MCP servery są w `~/.codex/config.toml`. Opcje:
1. **Pre-configure**: pisać do `config.toml` przed execution (hacky ale działa)
2. **Wrap CLI directly**: zamiast SDK, bezpośrednio spawnować `codex exec` z odpowiednimi flagami
3. **Czekać na SDK update** (least control)

## Decyzja architektoniczna

### Warstwa 1: Generyczny `createMcpServer` w bibliotece

Nowy plik `src/mcp.ts` — wrapper nad `@modelcontextprotocol/sdk`:

```typescript
export function createMcpServer(options: CreateMcpServerOptions): McpServerInstance
export function mcpTool<T>(name, description, inputSchema, handler): McpToolDefinition
```

Peer dependency na `@modelcontextprotocol/sdk` (optional — potrzebne tylko gdy consumer tworzy in-process serwery).

### Warstwa 2: Per-adapter MCP wiring

**claude-code:**
- Obsługa `McpSdkServerConfig` (type: 'sdk') — wrap naszego `McpServer` w format SDK
- Re-export `createSdkMcpServer` + `tool` z SDK (backward compat)
- Re-export nasz `createMcpServer` + `mcpTool`

**gemini:**
- Podłączyć `params.mcpServers` do gemini `MCPServerConfig` 
- Przekazać do `LegacyAgentSession` lub `McpClientManager`
- Obsłużyć `includeTools`/`excludeTools` (mapowanie z `allowedMCPTools`)

**opencode:**
- Dodać type guard — procesować tylko stdio configs
- Dla SDK server configs: startować na stdio transport i generować command config

**codex:**
- Na razie: dodać TODO/komentarz z wyjaśnieniem ograniczeń SDK
- Przyszłość: rozważyć pre-configure `config.toml` lub direct CLI wrapping

### Warstwa 3: Typ `McpServerConfig` — widen do union

```typescript
export type McpServerConfig =
  | McpStdioServerConfig    // command + args + env
  | McpSseServerConfig      // url + headers
  | McpHttpServerConfig     // url + headers  
  | McpSdkServerConfig;     // type: 'sdk', name, instance (in-process)
```

### `builtinMCPServers` / `allowedMCPTools`

**Zostawiamy** na `RuntimeExecuteParams` z komentarzami wyjaśniającymi:
- Consumer (InHarness CLI) przetwarza je na concrete `mcpServers` entries
- Adaptery nie czytają ich bezpośrednio — czytają `mcpServers`
- Gemini adapter może użyć `allowedMCPTools` do `includeTools` filtering

## Zmiany — szczegółowo

### 1. Nowy: `src/mcp.ts` — Generyczny MCP server builder

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpToolDefinition { name, description, inputSchema, handler, annotations? }
export interface CreateMcpServerOptions { name, version?, tools? }
export interface McpServerInstance { server: McpServer; config: McpSdkServerConfig }

export function createMcpServer(options): McpServerInstance
export function mcpTool(name, description, schema, handler): McpToolDefinition
```

### 2. `src/types.ts`

- Widen `McpServerConfig` do 4-wariantowej unii
- Export `McpStdioServerConfig`, `McpSseServerConfig`, `McpHttpServerConfig`, `McpSdkServerConfig`
- Dodać JSDoc do `builtinMCPServers` i `allowedMCPTools`
- Backward compat: `McpStdioServerConfig` ma `type?: 'stdio'` (optional, jak w SDK)

### 3. `src/adapters/claude-code.ts`

- Re-export SDK's `createSdkMcpServer`, `tool` (backward compat ze specyfikacją)
- Re-export nasz `createMcpServer`, `mcpTool` z `../mcp.js`
- W `execute()`: mapować `McpSdkServerConfig` na format SDK (`McpSdkServerConfigWithInstance`)
- Obsłużyć wszystkie typy McpServerConfig (stdio, SSE, HTTP — SDK akceptuje je natywnie)

### 4. `src/adapters/gemini.ts`

- Import `MCPServerConfig` z `@google/gemini-cli-core`
- Mapować `params.mcpServers` na gemini `MCPServerConfig` format
- Przekazać do session config (zbadać czy `LegacyAgentSession` akceptuje `mcpServers` w deps, lub użyć `McpClientManager` bezpośrednio)
- Usunąć "EXPERIMENTAL" label dla MCP — to jest production-ready w gemini SDK

### 5. `src/adapters/opencode.ts`

- Type guard: filtrować do `McpStdioServerConfig` (pominąć SDK/SSE/HTTP z warning)

### 6. `src/adapters/codex.ts`

- Dodać komentarz: "Codex SDK does not support dynamic MCP server configuration. MCP servers must be pre-configured via `codex mcp add` CLI command or ~/.codex/config.toml."
- Logować warning jeśli `params.mcpServers` jest niepuste

### 7. `src/index.ts`

- Export `createMcpServer`, `mcpTool`, typy z `mcp.ts`
- Export nowe McpServerConfig warianty

### 8. `package.json`

- Dodać `@modelcontextprotocol/sdk` jako optional peer dependency

## Pliki do modyfikacji

| Plik | Akcja |
|------|-------|
| `src/mcp.ts` | **Nowy** — createMcpServer, mcpTool |
| `src/types.ts` | Widen McpServerConfig, JSDoc |
| `src/adapters/claude-code.ts` | Re-exporty, McpSdkServerConfig handling |
| `src/adapters/gemini.ts` | MCP wiring do gemini-cli-core |
| `src/adapters/opencode.ts` | Type guard dla non-stdio |
| `src/adapters/codex.ts` | Warning + komentarz |
| `src/index.ts` | Nowe eksporty |
| `package.json` | @modelcontextprotocol/sdk peer dep |

## Consumer usage (InHarness CLI)

```typescript
import { createMcpServer, mcpTool } from '@inharness/agent-adapters';

// CLI tworzy MCP servery z RunPackage
const servers: Record<string, McpServerConfig> = {};
for (const serverName of runPackage.builtinMCPServers) {
  const tools = registry[serverName]
    .filter(t => runPackage.allowedMCPTools.includes(t.name))
    .map(t => mcpTool(t.name, t.desc, t.schema, 
      async (args) => apiClient.callMcpTool(serverName, t.name, args)
    ));
  const { config } = createMcpServer({ name: serverName, tools });
  servers[serverName] = config;
}

// Adapter obsługuje resztę — claude-code przekazuje do SDK, gemini do McpClientManager
adapter.execute({ ...params, mcpServers: servers });
```

## Weryfikacja

1. `npm run build` — zero type errors
2. `npm test` — istniejące testy pass
3. Test: `createMcpServer` tworzy McpServer z registered tools
4. Test: claude-code adapter mapuje McpSdkServerConfig poprawnie
5. Test: gemini adapter przekazuje mcpServers do session
6. Test: opencode adapter filtruje non-stdio configs
7. Test: codex adapter loguje warning dla mcpServers
