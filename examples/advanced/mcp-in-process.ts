// In-process MCP server with createMcpServer
// Shows: creating custom MCP tools in the same process, no external subprocess needed
// Usage: npx tsx examples/advanced/mcp-in-process.ts
// Auth: ANTHROPIC_API_KEY or Claude Code OAuth

import { z } from 'zod';
import { createAdapter, createMcpServer, mcpTool } from '../../src/index.js';

// Define custom MCP tools — these run in the same process as the adapter.
// Tool handlers can access your application state, databases, APIs, etc.

const taskStore = new Map<string, { title: string; done: boolean }>();

const tools = [
  mcpTool(
    'add_task',
    'Add a task to the task list',
    { title: z.string().describe('Task title') },
    async (args) => {
      const id = `task_${taskStore.size + 1}`;
      taskStore.set(id, { title: args.title as string, done: false });
      return { content: [{ type: 'text', text: `Created task ${id}: ${args.title}` }] };
    },
  ),

  mcpTool(
    'list_tasks',
    'List all tasks',
    {},
    async () => {
      if (taskStore.size === 0) {
        return { content: [{ type: 'text', text: 'No tasks yet.' }] };
      }
      const list = [...taskStore.entries()]
        .map(([id, t]) => `${id}: [${t.done ? 'x' : ' '}] ${t.title}`)
        .join('\n');
      return { content: [{ type: 'text', text: list }] };
    },
  ),

  mcpTool(
    'complete_task',
    'Mark a task as completed',
    { taskId: z.string().describe('Task ID to complete') },
    async (args) => {
      const task = taskStore.get(args.taskId as string);
      if (!task) {
        return { content: [{ type: 'text', text: `Task ${args.taskId} not found` }], isError: true };
      }
      task.done = true;
      return { content: [{ type: 'text', text: `Completed: ${task.title}` }] };
    },
  ),
];

async function main() {
  // Create an in-process MCP server — returns a config for RuntimeExecuteParams
  const { config } = createMcpServer({ name: 'task-manager', tools });

  console.log('In-process MCP server with custom tools\n');

  const adapter = createAdapter('claude-code');

  for await (const event of adapter.execute({
    prompt:
      'Add three tasks: "Write tests", "Update docs", "Deploy". ' +
      'Then list all tasks. Then complete "Write tests" and list again.',
    systemPrompt: 'Use the task manager tools. Be concise.',
    model: 'claude-sonnet-4-20250514',
    maxTurns: 10,
    mcpServers: {
      'task-manager': config, // McpSdkServerConfig — in-process, no subprocess
    },
  })) {
    switch (event.type) {
      case 'tool_use':
        console.log(`\n[Tool] ${event.toolName}(${JSON.stringify(event.input)})`);
        break;
      case 'tool_result':
        console.log(`[Result] ${event.summary}`);
        break;
      case 'text_delta':
        process.stdout.write(event.text);
        break;
      case 'result':
        console.log(`\n\nTokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`);
        console.log(`\nFinal task store: ${JSON.stringify([...taskStore.entries()], null, 2)}`);
        break;
      case 'error':
        console.error('\nError:', event.error.message);
        break;
    }
  }
}

main().catch(console.error);
