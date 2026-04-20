// Captured-shape fixtures for @openai/codex-sdk event streams.
// Built against @openai/codex-sdk ^0.120.0. If the SDK event shape changes,
// update these fixtures (and the comment above) — they intentionally mirror
// only the fields the codex adapter actually reads.

export const SCENARIO_TEXT_ONLY = [
  {
    type: 'item.completed',
    item: { type: 'agent_message', id: 'msg_1', text: 'Hello world' },
  },
  {
    type: 'turn.completed',
    usage: { input_tokens: 10, output_tokens: 5 },
  },
] as const;

export const SCENARIO_TOOL_FLOW = [
  {
    type: 'item.completed',
    item: { type: 'agent_message', id: 'msg_1', text: 'Running shell…' },
  },
  {
    type: 'item.completed',
    item: {
      type: 'command_execution',
      id: 'cmd_1',
      command: 'echo hi',
      aggregated_output: 'hi\n',
      exit_code: 0,
      status: 'completed',
    },
  },
  {
    type: 'item.completed',
    item: { type: 'agent_message', id: 'msg_2', text: 'Done.' },
  },
  {
    type: 'turn.completed',
    usage: { input_tokens: 12, output_tokens: 8 },
  },
] as const;

export const SCENARIO_MCP_TOOL = [
  {
    type: 'item.completed',
    item: {
      type: 'mcp_tool_call',
      id: 'mcp_1',
      server: 'echo-srv',
      tool: 'echo',
      arguments: { msg: 'hi' },
      result: { content: 'echoed' },
      status: 'completed',
    },
  },
  {
    type: 'item.completed',
    item: { type: 'agent_message', id: 'msg_1', text: 'Tool returned echoed.' },
  },
  {
    type: 'turn.completed',
    usage: { input_tokens: 9, output_tokens: 4 },
  },
] as const;

export const SCENARIO_REASONING = [
  {
    type: 'item.completed',
    item: { type: 'reasoning', text: 'thinking step 1' },
  },
  {
    type: 'item.completed',
    item: { type: 'agent_message', id: 'msg_1', text: 'OK' },
  },
  {
    type: 'turn.completed',
    usage: { input_tokens: 5, output_tokens: 2 },
  },
] as const;

export const SCENARIO_FAILED_COMMAND = [
  {
    type: 'item.completed',
    item: {
      type: 'command_execution',
      id: 'cmd_x',
      command: 'false',
      aggregated_output: '',
      exit_code: 1,
      status: 'failed',
    },
  },
  {
    type: 'item.completed',
    item: { type: 'agent_message', id: 'msg_err', text: 'Command failed.' },
  },
  {
    type: 'turn.completed',
    usage: { input_tokens: 4, output_tokens: 3 },
  },
] as const;
