// MCP server configuration across adapters
// Shows: stdio MCP servers via mcpServers param, tool_use/tool_result events
// Usage: npx tsx examples/advanced/mcp-servers.ts [claude-code|codex|opencode]
// Auth: depends on chosen architecture

import { createAdapter } from '../../src/index.js';
import type { Architecture } from '../../src/index.js';

const architecture = (process.argv[2] ?? 'claude-code') as Architecture;

const models: Record<string, string> = {
  'claude-code': 'sonnet-4.5',
  'codex': 'gpt-4.1',
  'opencode': 'openrouter/anthropic/sonnet-4.5',
};

async function main() {
  console.log(`MCP filesystem server with ${architecture} adapter\n`);

  const adapter = createAdapter(architecture);

  // Stdio MCP server — works with claude-code and opencode.
  // Codex will warn that MCP servers are not supported via SDK.
  for await (const event of adapter.execute({
    prompt: 'Use the filesystem MCP server to list files in /tmp. Summarize what you find.',
    systemPrompt: 'Be concise.',
    model: models[architecture] ?? 'sonnet-4.5',
    maxTurns: 5,
    mcpServers: {
      filesystem: {
        // McpStdioServerConfig — spawns a subprocess
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    },
  })) {
    switch (event.type) {
      case 'tool_use':
        console.log(`[MCP Tool] ${event.toolName} (${event.toolUseId})`);
        break;
      case 'tool_result':
        console.log(`[Result] ${event.summary.slice(0, 150)}${event.summary.length > 150 ? '...' : ''}`);
        break;
      case 'text_delta':
        process.stdout.write(event.text);
        break;
      case 'result':
        console.log(`\n\nTokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`);
        break;
      case 'error':
        console.error('\nError:', event.error.message);
        break;
    }
  }
}

main().catch(console.error);
