// E2E test helpers — shared across all adapter e2e tests

import { expect } from 'vitest';
import { z } from 'zod';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  UnifiedEvent,
  UsageStats,
  RuntimeAdapter,
  RuntimeExecuteParams,
  UserInputHandler,
  UserInputResponse,
} from '../../types.js';
import { createMcpServer, mcpTool } from '../../mcp.js';

// Re-exported so existing imports `from './shared.js'` keep working.
import { assertNormalizedMessage, assertContentBlock } from '../normalization.js';
export { assertNormalizedMessage, assertContentBlock };

// --- Skip guard ---

/**
 * Check that required env vars are set.
 * Returns true if all are present, false if any are missing.
 * Use with `describe.skipIf(!requireEnv(...))`.
 */
export function requireEnv(...vars: string[]): boolean {
  return vars.every((v) => !!process.env[v]);
}

// --- Event assertions ---

/** Assert that a collected event array contains all expected event types. */
export function assertEventTypes(events: UnifiedEvent[], expectedTypes: UnifiedEvent['type'][]): void {
  const presentTypes = new Set(events.map((e) => e.type));
  for (const t of expectedTypes) {
    expect(presentTypes.has(t), `Expected event type "${t}" not found. Present: ${[...presentTypes].join(', ')}`).toBe(
      true,
    );
  }
}

/** Assert that all text_delta events have non-empty text and isSubagent field. */
export function assertTextDeltas(events: UnifiedEvent[]): void {
  const deltas = events.filter((e) => e.type === 'text_delta') as Extract<UnifiedEvent, { type: 'text_delta' }>[];
  expect(deltas.length).toBeGreaterThanOrEqual(1);
  for (const d of deltas) {
    expect(typeof d.text).toBe('string');
    expect(typeof d.isSubagent).toBe('boolean');
  }
}

// --- UsageStats assertions ---

/** Assert usage stats have positive token counts. */
export function assertUsageStats(usage: UsageStats): void {
  expect(typeof usage.inputTokens).toBe('number');
  expect(typeof usage.outputTokens).toBe('number');
  expect(usage.inputTokens).toBeGreaterThan(0);
  expect(usage.outputTokens).toBeGreaterThan(0);
}

// --- Result event assertions ---

/** Assert the result event has correct structure. */
export function assertResultEvent(event: Extract<UnifiedEvent, { type: 'result' }>): void {
  expect(typeof event.output).toBe('string');
  expect(event.output.length).toBeGreaterThan(0);
  expect(Array.isArray(event.rawMessages)).toBe(true);
  expect(event.rawMessages.length).toBeGreaterThanOrEqual(1);
  expect(event.rawMessages.some((m) => m.role === 'assistant')).toBe(true);
  assertUsageStats(event.usage);

  // Validate each raw message structure
  for (const msg of event.rawMessages) {
    assertNormalizedMessage(msg);
  }
}

// --- Full stream validation ---

/**
 * Run all standard assertions on a collected event stream.
 * Returns the result event for further inspection.
 */
export function assertSimpleTextStream(events: UnifiedEvent[]): Extract<UnifiedEvent, { type: 'result' }> {
  assertEventTypes(events, ['text_delta', 'assistant_message', 'result']);
  assertTextDeltas(events);

  // Result should be the last non-flush event
  const nonFlush = events.filter((e) => e.type !== 'flush');
  expect(nonFlush[nonFlush.length - 1].type).toBe('result');

  const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
  assertResultEvent(result);

  // Validate assistant_message events
  const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Extract<
    UnifiedEvent,
    { type: 'assistant_message' }
  >[];
  for (const am of assistantMsgs) {
    assertNormalizedMessage(am.message);
  }

  // At least one assistant_message should have a text content block
  const hasTextBlock = assistantMsgs.some((am) => am.message.content.some((b) => b.type === 'text'));
  expect(hasTextBlock, 'No assistant_message with text content block found').toBe(true);

  return result;
}

// --- MCP server for tool use tests ---

/** Create a simple echo MCP server for e2e tool use testing. */
export function createE2eMcpServer() {
  return createMcpServer({
    name: 'e2e-test',
    tools: [
      mcpTool(
        'echo',
        'Echo the input message back. Always use this tool when asked to echo something.',
        { message: z.string().describe('The message to echo back') },
        async (args) => ({
          content: [{ type: 'text', text: `echo: ${(args as { message: string }).message}` }],
        }),
      ),
    ],
  });
}

// --- Common test params ---

export const SIMPLE_PROMPT = 'What is 2+2? Answer with just the number.';
export const SIMPLE_SYSTEM_PROMPT = 'Be concise. Answer in one word or number when possible.';
export const TOOL_PROMPT = 'Use the echo tool with the message "hello world". Then tell me what it returned.';
export const TOOL_SYSTEM_PROMPT = 'You have access to an echo tool. Use it when asked.';
export const THINKING_PROMPT = 'A traveler headed south. After walking 1 km he turned east and after 1 km he saw a bear ahead, so he turned north. After walking another 1 km he was back at the starting point. What color was the bear? Explain your reasoning.';
export const THINKING_SYSTEM_PROMPT = 'Think through your reasoning step by step before answering. This is a classic lateral thinking puzzle.';
export const SUBAGENT_PROMPT = 'Do these two tasks in parallel using subagents: (1) Use the echo tool with "task-a", (2) Use the echo tool with "task-b". Delegate each to a separate subagent.';
export const SUBAGENT_SYSTEM_PROMPT = 'You must delegate independent tasks to subagents. Use the Task tool to spawn subagents for parallel work.';

// --- Plan mode test helpers ---

/** Create a unique temp cwd with a seed file for plan-mode tests. */
export function createPlanModeTmpDir(): { dir: string; cleanup: () => void; seedFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-adapters-plan-'));
  const seedFile = join(dir, 'README.md');
  writeFileSync(seedFile, '# test seed\nSome content to read.\n');
  return {
    dir,
    seedFile,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const PLAN_WRITE_PROMPT =
  'Create a new file in the current directory named `notes.txt` with the content `hello world`. Use the Write tool directly without asking.';
export const PLAN_WRITE_SYSTEM_PROMPT =
  'You have filesystem tools available. When asked to create a file, use the Write tool directly.';

export const PLAN_READ_PROMPT =
  'Read the file README.md in the current directory and tell me its first line verbatim.';
export const PLAN_READ_SYSTEM_PROMPT =
  'You have filesystem tools available. When asked to read a file, use the Read tool.';

/**
 * Best-effort detector of tool names that imply filesystem mutation or shell writes.
 * Different adapters use different naming: Claude (Write/Edit/MultiEdit), Codex (shell),
 * Gemini (replace/write_file). Adapters may also call them via MCP with prefixes.
 */
export function findWriteToolUses(events: UnifiedEvent[]): Array<Extract<UnifiedEvent, { type: 'tool_use' }>> {
  return events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'tool_use' }> =>
      e.type === 'tool_use' && /(^|_|\.)(Write|Edit|MultiEdit|str_replace|write_file|replace|shell)$/i.test(e.toolName),
  );
}

/** Assert plan mode prevented filesystem mutation inside `cwd`. */
export function assertNoFileCreated(cwd: string, expected: string): void {
  expect(existsSync(join(cwd, expected)), `planMode leaked: ${expected} exists in ${cwd}`).toBe(false);
}

/** Assert the file was actually created (baseline sanity for non-plan-mode). */
export function assertFileCreated(cwd: string, expected: string): void {
  expect(existsSync(join(cwd, expected)), `expected file ${expected} was not created in ${cwd}`).toBe(true);
}

// --- User-input (ask-user tool) scenario ---

export const USER_QUESTION_PROMPT =
  'You MUST use your ask-user question tool to ask the user to pick exactly one fruit from this list: apple, banana, cherry. Do not guess. After the user answers, reply with exactly one word — the chosen fruit.';
export const USER_QUESTION_SYSTEM_PROMPT =
  'When you need a decision from the user and you have a native ask-user / AskUserQuestion / question tool available, you MUST use it instead of guessing. Always prefer the ask-user tool over Bash or other tools for user input.';

/**
 * Run a user-question scenario and collect events + the handler invocations.
 * The test helper builds the handler, tallies invocations, and returns everything
 * so individual adapter tests can make their own assertions.
 */
export async function runUserQuestionScenario(
  adapter: RuntimeAdapter,
  params: Omit<RuntimeExecuteParams, 'onUserInput'> & {
    mockAnswer: 'banana' | 'cancel';
  },
): Promise<{
  events: UnifiedEvent[];
  handlerCalls: number;
  lastAnswer: UserInputResponse | null;
}> {
  let handlerCalls = 0;
  let lastAnswer: UserInputResponse | null = null;
  const handler: UserInputHandler = async () => {
    handlerCalls += 1;
    const resp: UserInputResponse =
      params.mockAnswer === 'banana'
        ? { action: 'accept', answers: [['banana']] }
        : { action: 'cancel' };
    lastAnswer = resp;
    return resp;
  };
  const events: UnifiedEvent[] = [];
  const { mockAnswer: _ignored, ...rest } = params;
  void _ignored;
  for await (const e of adapter.execute({ ...rest, onUserInput: handler })) {
    events.push(e);
  }
  return { events, handlerCalls, lastAnswer };
}

/** Assert the event stream contains exactly one user_input_request with the expected source. */
export function assertUserInputRequest(
  events: UnifiedEvent[],
  expectedSource: 'model-tool' | 'mcp-elicitation' = 'model-tool',
): Extract<UnifiedEvent, { type: 'user_input_request' }> {
  const reqs = events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'user_input_request' }> => e.type === 'user_input_request',
  );
  expect(reqs.length, `expected at least one user_input_request, got ${reqs.length}`).toBeGreaterThanOrEqual(1);
  expect(reqs[0].request.source).toBe(expectedSource);
  expect(Array.isArray(reqs[0].request.questions)).toBe(true);
  expect(reqs[0].request.questions.length).toBeGreaterThanOrEqual(1);
  return reqs[0];
}
