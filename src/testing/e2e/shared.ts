// E2E test helpers — shared across all adapter e2e tests

import { expect } from 'vitest';
import { z } from 'zod';
import type { UnifiedEvent, NormalizedMessage, ContentBlock, UsageStats } from '../../types.js';
import { createMcpServer, mcpTool } from '../../mcp.js';

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

// --- NormalizedMessage assertions ---

/** Assert a NormalizedMessage has correct structure. */
export function assertNormalizedMessage(msg: NormalizedMessage): void {
  expect(msg.role).toMatch(/^(user|assistant)$/);
  expect(Array.isArray(msg.content)).toBe(true);
  expect(msg.content.length).toBeGreaterThanOrEqual(1);
  expect(typeof msg.timestamp).toBe('string');
  expect(msg.timestamp.length).toBeGreaterThan(0);

  for (const block of msg.content) {
    assertContentBlock(block);
  }
}

/** Assert a ContentBlock has correct structure for its type. */
export function assertContentBlock(block: ContentBlock): void {
  switch (block.type) {
    case 'text':
      expect(typeof block.text).toBe('string');
      break;
    case 'thinking':
      expect(typeof block.text).toBe('string');
      break;
    case 'toolUse':
      expect(typeof block.toolUseId).toBe('string');
      expect(block.toolUseId.length).toBeGreaterThan(0);
      expect(typeof block.toolName).toBe('string');
      expect(block.toolName.length).toBeGreaterThan(0);
      expect(typeof block.input).toBe('object');
      break;
    case 'toolResult':
      expect(typeof block.toolUseId).toBe('string');
      expect(block.toolUseId.length).toBeGreaterThan(0);
      expect(typeof block.content).toBe('string');
      break;
    case 'image':
      expect(block.source).toBeDefined();
      break;
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
export const THINKING_PROMPT = 'What is the square root of 144? Think step by step.';
export const THINKING_SYSTEM_PROMPT = 'Think through your reasoning step by step before answering.';
