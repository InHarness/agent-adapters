// Claude Code MCP tools using SDK's native createSdkMcpServer
// Shows: using claude-agent-sdk's tool() helper with full type safety
// Usage: npx tsx examples/claude-code/mcp-sdk-tools.ts
// Auth: ANTHROPIC_API_KEY or Claude Code OAuth

import { z } from 'zod';
import { ClaudeCodeAdapter, createSdkMcpServer, tool } from '../../src/adapters/claude-code.js';

// Use the SDK's `tool()` helper — gives full Zod type inference for args
const noteStore: string[] = [];

const server = createSdkMcpServer({
  name: 'notes',
  tools: [
    tool('add_note', 'Add a note', { text: z.string() }, async (args) => {
      noteStore.push(args.text);
      return { content: [{ type: 'text', text: `Note #${noteStore.length} added.` }] };
    }),

    tool('list_notes', 'List all notes', {}, async () => {
      if (noteStore.length === 0) {
        return { content: [{ type: 'text', text: 'No notes yet.' }] };
      }
      const list = noteStore.map((n, i) => `${i + 1}. ${n}`).join('\n');
      return { content: [{ type: 'text', text: list }] };
    }),

    tool('search_notes', 'Search notes by keyword', { keyword: z.string() }, async (args) => {
      const matches = noteStore.filter((n) => n.toLowerCase().includes(args.keyword.toLowerCase()));
      return {
        content: [{
          type: 'text',
          text: matches.length ? matches.join('\n') : `No notes matching "${args.keyword}"`,
        }],
      };
    }),
  ],
});

async function main() {
  console.log('Claude Code with SDK MCP tools\n');

  const adapter = new ClaudeCodeAdapter();

  for await (const event of adapter.execute({
    prompt:
      'Add these notes: "Buy groceries", "Review PR #42", "Call dentist". ' +
      'Then search for notes about "PR". List all notes at the end.',
    systemPrompt: 'Use the notes tools. Be concise.',
    model: 'sonnet-4.5',
    maxTurns: 10,
    mcpServers: {
      notes: server, // McpSdkServerConfigWithInstance from SDK
    },
  })) {
    switch (event.type) {
      case 'tool_use':
        console.log(`[Tool] ${event.toolName}(${JSON.stringify(event.input)})`);
        break;
      case 'tool_result':
        console.log(`[Result] ${event.summary}`);
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
