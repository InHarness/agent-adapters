// E2E test helpers — shared across all adapter e2e tests

import { expect } from 'vitest';
import { z } from 'zod';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type {
  UnifiedEvent,
  UsageStats,
  RuntimeAdapter,
  RuntimeExecuteParams,
  UserInputHandler,
  UserInputResponse,
} from '../../types.js';
import { createMcpServer, mcpTool } from '../../mcp.js';
import { sumUsage } from '../../usage.js';

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

/**
 * Assert that usage on two consecutive resume turns is per-call delta (each
 * turn has its own positive usage), and that summing them via the public
 * `sumUsage` helper produces a sensible cumulative total. Returns the sum so
 * callers can spot-check it.
 *
 * The library-wide contract is that `result.usage` carries per-`execute()`
 * delta only — see JSDoc on `UnifiedEvent`'s `result` variant in
 * `src/types.ts`.
 *
 * The tight assertion is on `result2.usage.inputTokens`: a regression that
 * leaks cumulative-as-delta (the codex bug fixed alongside this helper —
 * see openai/codex#17539) makes turn 2 report `t1_cumulative + t2_true_delta`,
 * which is ≥ 2× turn 1 in any non-trivial conversation. We bound turn 2 at
 * `max(1.3 × turn1, turn1 + 5000)`: the multiplicative term catches
 * non-trivial conversations (real-call ratios across all four adapters sit at
 * 1.0–1.01, so 1.3× has ~30% headroom for natural variance / replay growth);
 * the additive floor handles cache-heavy adapters (claude-code/opencode)
 * where `inputTokens` is single-digit and a 30% bound would be flaky.
 */
export function assertResumeUsageIndependence(
  result1: Extract<UnifiedEvent, { type: 'result' }>,
  result2: Extract<UnifiedEvent, { type: 'result' }>,
): UsageStats {
  assertUsageStats(result1.usage);
  assertUsageStats(result2.usage);
  const total = sumUsage(result1.usage, result2.usage);
  // Bug catcher: cumulative-as-delta would push t2.inputTokens to ≈ t1 + t2_true.
  // Bound t2 at max(1.3× t1, t1 + 5000): tight enough to catch a linear leak
  // (12k→25k→38k…), loose enough to absorb the additive floor that protects
  // cache-heavy adapters with tiny inputTokens.
  const inputBound = Math.max(result1.usage.inputTokens * 1.3, result1.usage.inputTokens + 5000);
  expect(
    result2.usage.inputTokens,
    `turn 2 inputTokens=${result2.usage.inputTokens} exceeds cumulative-leak bound ${inputBound} (turn 1 inputTokens=${result1.usage.inputTokens}); per-execute() usage must be delta, not cumulative`,
  ).toBeLessThan(inputBound);
  return total;
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

// --- Todo list scenario ---

export const TODO_PROMPT =
  'Before doing anything else, break the following job into exactly 3 clear sequential todo items using your native task-planning / TodoWrite tool, then do not execute them — just list them. The job is: "Refactor the user settings page: (1) extract the avatar upload, (2) add form validation, (3) write tests". Mark the first item as in_progress and the other two as pending.';
export const TODO_SYSTEM_PROMPT =
  'You have a native TodoWrite / task-planning tool available. When the user gives you a multi-step job, you MUST call it exactly once with all steps before doing anything else. Do not execute the steps — just plan them.';

// --- Session resume scenario ---

// Phrasing avoids "remember"/"memorize" — Gemini interprets those as a directive to
// call its built-in save_memory tool, which (a) produces no text on turn 1 and (b)
// persists across sessions, making the recall on turn 2 ambiguous.
export const RESUME_TURN1_PROMPT =
  'Reply with exactly this sentence and nothing else: My code is 92517.';
export const RESUME_TURN1_SYSTEM_PROMPT =
  'You echo back exactly what you are asked to say. Do not save anything to memory or call any tools.';
export const RESUME_TURN2_PROMPT =
  'Repeat the number from your previous reply in this conversation. Answer with only the digits, nothing else.';
export const RESUME_TURN2_SYSTEM_PROMPT =
  'Recall what you said in the previous turn of this conversation.';
export const RESUME_EXPECTED_NUMBER = '92517';

/**
 * Run the memorize-and-recall resume scenario. Caller passes a factory so each
 * call gets a fresh adapter instance (the adapter is single-use — execute()
 * sets up an AbortController and adapters like opencode spawn per-call servers).
 *
 * Returns the captured sessionId from turn 1 and both turns' events so tests
 * can make their own assertions on the recall.
 */
export async function runResumeScenario(
  factory: () => RuntimeAdapter,
  baseParams: Omit<RuntimeExecuteParams, 'prompt' | 'systemPrompt' | 'resumeSessionId'>,
): Promise<{
  turn1Events: UnifiedEvent[];
  turn2Events: UnifiedEvent[];
  sessionId: string;
  result1: Extract<UnifiedEvent, { type: 'result' }>;
  result2: Extract<UnifiedEvent, { type: 'result' }>;
}> {
  const turn1Events: UnifiedEvent[] = [];
  for await (const e of factory().execute({
    ...baseParams,
    prompt: RESUME_TURN1_PROMPT,
    systemPrompt: RESUME_TURN1_SYSTEM_PROMPT,
  })) {
    turn1Events.push(e);
  }
  const result1 = turn1Events.find(
    (e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result',
  );
  if (!result1?.sessionId) {
    throw new Error('turn 1 did not yield a sessionId on the result event');
  }

  const turn2Events: UnifiedEvent[] = [];
  for await (const e of factory().execute({
    ...baseParams,
    prompt: RESUME_TURN2_PROMPT,
    systemPrompt: RESUME_TURN2_SYSTEM_PROMPT,
    resumeSessionId: result1.sessionId,
  })) {
    turn2Events.push(e);
  }
  const result2 = turn2Events.find(
    (e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result',
  );
  if (!result2) {
    throw new Error('turn 2 did not yield a result event');
  }

  return { turn1Events, turn2Events, sessionId: result1.sessionId, result1, result2 };
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

// --- Todo list assertions ---

/**
 * Assert the event stream contains at least one `todo_list_updated`, optionally
 * filtered by source. Validates that every item has a non-empty `id` and
 * `content`. Returns the last matching event for further inspection.
 */
export function assertTodoListUpdated(
  events: UnifiedEvent[],
  opts: { minCount?: number; expectedSource?: 'model-tool' | 'session-state' } = {},
): Extract<UnifiedEvent, { type: 'todo_list_updated' }> {
  const { minCount = 1, expectedSource } = opts;
  const all = events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'todo_list_updated' }> => e.type === 'todo_list_updated',
  );
  const filtered = expectedSource ? all.filter((e) => e.source === expectedSource) : all;
  expect(
    filtered.length,
    `expected at least ${minCount} todo_list_updated${expectedSource ? ` with source=${expectedSource}` : ''}, got ${filtered.length}`,
  ).toBeGreaterThanOrEqual(minCount);
  const last = filtered[filtered.length - 1];
  expect(Array.isArray(last.items)).toBe(true);
  for (const item of last.items) {
    expect(typeof item.id).toBe('string');
    expect(item.id.length).toBeGreaterThan(0);
    expect(typeof item.content).toBe('string');
    expect(item.content.length).toBeGreaterThan(0);
    expect(typeof item.status).toBe('string');
  }
  return last;
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

// --- Subagent taskId consistency ---

/** Types of delta-like events that may carry `subagentTaskId`. */
type DeltaLikeEvent = Extract<UnifiedEvent, { type: 'text_delta' | 'thinking' | 'tool_use' | 'tool_result' }>;

/**
 * Validate that every delta-like event marked `isSubagent: true` either
 * (a) carries a `subagentTaskId` matching one of the observed
 * `subagent_started` taskIds, or (b) leaves it `undefined` (the documented
 * graceful-degradation case for adapters that can't resolve it — e.g.
 * claude-code race, opencode before a task starts).
 *
 * No-op when no `subagent_started` events were observed (subagent spawning
 * is non-deterministic — the model may not delegate on a given run).
 */
export function assertSubagentTaskIdConsistency(events: UnifiedEvent[]): void {
  const started = events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'subagent_started' }> => e.type === 'subagent_started',
  );
  if (started.length === 0) return;

  const liveIds = new Set(started.map((s) => s.taskId));
  const deltaLikeTypes = new Set(['text_delta', 'thinking', 'tool_use', 'tool_result']);
  for (const e of events) {
    if (!deltaLikeTypes.has(e.type)) continue;
    const d = e as DeltaLikeEvent;
    if (!d.isSubagent) continue;
    if (d.subagentTaskId === undefined) continue; // tolerated
    expect(
      liveIds.has(d.subagentTaskId),
      `delta (${d.type}) carries subagentTaskId=${d.subagentTaskId} but no matching subagent_started was observed (live: ${[...liveIds].join(', ')})`,
    ).toBe(true);
  }
}

/**
 * Assert at least one delta-like event with `isSubagent: true` carries a
 * populated `subagentTaskId`. Adapters that claim full support
 * (claude-code, gemini) must emit at least one. Used in addition to
 * `assertSubagentTaskIdConsistency` for strict verification.
 */
export function assertAtLeastOneSubagentTaskIdPopulated(events: UnifiedEvent[]): void {
  const deltaLikeTypes = new Set(['text_delta', 'thinking', 'tool_use', 'tool_result']);
  const found = events.some((e) => {
    if (!deltaLikeTypes.has(e.type)) return false;
    const d = e as DeltaLikeEvent;
    return d.isSubagent && typeof d.subagentTaskId === 'string' && d.subagentTaskId.length > 0;
  });
  expect(found, 'expected at least one subagent delta event with a populated subagentTaskId').toBe(true);
}

// --- Image scenario (base64 / url / file → described) ---

/** CRC-32 (PNG/zlib polynomial). Small self-contained impl so we don't depend on
 * `zlib.crc32`, which only landed in Node 20.15 (engines allows any >=20). */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Generate a solid-color truecolor PNG entirely in-process — no image fixtures on
 * disk, no network. Big enough (64×64 by default) that a vision model describes a
 * "color" rather than a single pixel. Returned as a Buffer; callers pick base64 /
 * file delivery.
 */
export function makeSolidColorPng(rgb: [number, number, number], size = 64): Buffer {
  const [r, g, b] = rgb;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type 2 = truecolor RGB
  // bytes 10-12 (compression / filter / interlace) already zero
  const rowLen = size * 3;
  const raw = Buffer.alloc((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    const off = y * (rowLen + 1); // raw[off] is the per-row filter byte (0 = none)
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distinct, unambiguous red the model should name. */
export const IMAGE_RGB: [number, number, number] = [222, 28, 28];
export const IMAGE_EXPECTED_COLOR = 'red';
export const IMAGE_PROMPT =
  'Look at the attached image. It is a single solid color. What color is it? Answer with just the one color word.';
export const IMAGE_SYSTEM_PROMPT = 'You can see images. Answer concisely with a single color word.';

/** Assert the model's final output names the expected dominant color. */
export function assertImageDescribed(
  result: Extract<UnifiedEvent, { type: 'result' }>,
  expectedColor: string,
): void {
  const out = result.output.toLowerCase();
  expect(
    out.includes(expectedColor.toLowerCase()),
    `expected the model to describe the image as "${expectedColor}", got: ${result.output}`,
  ).toBe(true);
}

// --- Usage scenario (billing tokens vs contextSize + cache buckets) ---

/**
 * Assert the billing/context-window split on a `result` event is legible and
 * internally consistent with the library contract (see `UsageStats` +
 * `result.contextSize` JSDoc in `src/types.ts`):
 *   - billing `usage` has positive input/output token counts;
 *   - `contextSize` (context-window occupancy) equals `inputTokens + outputTokens`;
 *   - each cache bucket, when present, is a non-negative SUBSET of `inputTokens`.
 */
export function assertUsageLegible(result: Extract<UnifiedEvent, { type: 'result' }>): void {
  assertUsageStats(result.usage);
  expect(typeof result.contextSize, 'result.contextSize must be a number').toBe('number');
  expect(result.contextSize).toBe(result.usage.inputTokens + result.usage.outputTokens);

  if (result.usage.cacheReadInputTokens !== undefined) {
    expect(result.usage.cacheReadInputTokens).toBeGreaterThanOrEqual(0);
    expect(
      result.usage.cacheReadInputTokens,
      'cacheReadInputTokens must be a subset of inputTokens',
    ).toBeLessThanOrEqual(result.usage.inputTokens);
  }
  if (result.usage.cacheCreationInputTokens !== undefined) {
    expect(result.usage.cacheCreationInputTokens).toBeGreaterThanOrEqual(0);
    expect(
      result.usage.cacheCreationInputTokens,
      'cacheCreationInputTokens must be a subset of inputTokens',
    ).toBeLessThanOrEqual(result.usage.inputTokens);
  }
}

// --- Path-scope scenario (allowedPaths / disallowedPaths) ---

/**
 * Build a path-scope sandbox layout under a fresh temp dir:
 *   - `cwd`        — the run's working directory (implicitly in-scope).
 *   - `extraDir`   — an additional allowed root OUTSIDE cwd (→ allowedPaths).
 *   - `secretDir`  — a disallowed root, seeded with `secret.txt` (→ disallowedPaths).
 * Returns the paths plus a cleanup that removes the whole tree.
 */
export function createPathScopeDirs(): {
  cwd: string;
  extraDir: string;
  secretDir: string;
  secretFile: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'agent-adapters-pathscope-'));
  const cwd = join(root, 'work');
  const extraDir = join(root, 'extra');
  const secretDir = join(root, 'secret');
  for (const d of [cwd, extraDir, secretDir]) mkdirSync(d, { recursive: true });
  const secretFile = join(secretDir, 'secret.txt');
  writeFileSync(secretFile, 'TOP-SECRET-1729\n');
  writeFileSync(join(cwd, 'README.md'), '# work seed\n');
  return { cwd, extraDir, secretDir, secretFile, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// --- MCP elicitation scenario (elicitation_request / onElicitation bridge) ---

export const ELICIT_PROMPT =
  'Call the schedule_meeting tool with topic "sync". The tool will ask you (via the user) for a time — wait for it, then confirm what was booked.';
export const ELICIT_SYSTEM_PROMPT =
  'You have a schedule_meeting MCP tool. Always use it when asked to schedule. It may ask a follow-up question through the user.';
export const ELICIT_ANSWER_TIME = '3pm';

/**
 * MCP server whose single tool triggers an elicitation (`elicitation/create`)
 * mid-execution — the server-side side-channel that claude-code bridges to
 * `user_input_request` (`source: 'mcp-elicitation'`) and, when the consumer
 * supplies `onElicitation`, back to the SDK callback. The tool reports the
 * elicited answer in its result so the model can echo it.
 */
export function createElicitingMcpServer(): ReturnType<typeof createMcpServer> {
  const holder: { server?: ReturnType<typeof createMcpServer>['server'] } = {};
  const instance = createMcpServer({
    name: 'e2e-elicit',
    tools: [
      mcpTool(
        'schedule_meeting',
        'Schedule a meeting. Elicits the preferred time from the user before booking.',
        { topic: z.string().describe('Meeting topic') },
        async (args) => {
          const server = holder.server;
          if (!server) return { content: [{ type: 'text', text: 'server not ready' }], isError: true };
          try {
            const res = await (
              server.server as unknown as {
                elicitInput: (p: {
                  message: string;
                  requestedSchema: Record<string, unknown>;
                }) => Promise<{ action: string; content?: Record<string, unknown> }>;
              }
            ).elicitInput({
              message: 'What time should the meeting be?',
              requestedSchema: {
                type: 'object',
                properties: { time: { type: 'string', description: 'Preferred time, e.g. 3pm' } },
                required: ['time'],
              },
            });
            const time =
              res.action === 'accept' && res.content ? JSON.stringify(res.content) : `(${res.action})`;
            return {
              content: [
                { type: 'text', text: `Booked "${(args as { topic: string }).topic}" for ${time}` },
              ],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `elicitation unavailable: ${(err as Error).message}` }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
  holder.server = instance.server;
  return instance;
}

// --- Timeout scenario (timeoutMs → AdapterTimeoutError) ---

export const TIMEOUT_PROMPT =
  'Write an extremely detailed 3000-word essay on the complete history of computing, from the abacus to modern GPUs. Do not stop early.';
export const TIMEOUT_SYSTEM_PROMPT = 'Write long, thorough prose. Aim for at least 3000 words.';
