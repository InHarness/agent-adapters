// Mixed MCP server types — stdio + in-process in a single execution
// Shows: combining external MCP servers with custom in-process tools
// Usage: npx tsx examples/advanced/mcp-mixed-servers.ts
// Auth: ANTHROPIC_API_KEY or Claude Code OAuth

import { z } from 'zod';
import { createAdapter, createMcpServer, mcpTool } from '../../src/index.js';
import type { McpStdioServerConfig, McpSdkServerConfig } from '../../src/index.js';

// In-process tool: project context that the agent can query
const projectInfo = mcpTool(
  'get_project_info',
  'Get information about the current project',
  { field: z.enum(['name', 'version', 'description', 'all']).describe('Which field to retrieve') },
  async (args) => {
    const info = {
      name: '@inharness-ai/agent-adapters',
      version: '0.1.0',
      description: 'Unified TypeScript interface for AI agent SDKs',
    };
    if (args.field === 'all') {
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    }
    return { content: [{ type: 'text', text: info[args.field as keyof typeof info] ?? 'unknown' }] };
  },
);

async function main() {
  // Create the in-process server
  const { config: projectServer } = createMcpServer({
    name: 'project-context',
    tools: [projectInfo],
  });

  // Stdio server — external filesystem access
  const filesystemServer: McpStdioServerConfig = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  };

  console.log('Mixed MCP servers: in-process + stdio\n');

  const adapter = createAdapter('claude-code');

  for await (const event of adapter.execute({
    prompt:
      'First, get the project info (all fields). ' +
      'Then use the filesystem server to read the package.json file. ' +
      'Compare what the project-context tool reports vs what package.json says.',
    systemPrompt: 'Be concise. Use both MCP servers.',
    model: 'sonnet-4.5',
    maxTurns: 10,
    mcpServers: {
      'project-context': projectServer,   // in-process (McpSdkServerConfig)
      'filesystem': filesystemServer,     // subprocess (McpStdioServerConfig)
    },
  })) {
    switch (event.type) {
      case 'tool_use':
        console.log(`\n[Tool] ${event.toolName}`);
        break;
      case 'tool_result':
        console.log(`[Result] ${event.summary.slice(0, 200)}${event.summary.length > 200 ? '...' : ''}`);
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
