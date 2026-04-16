// E2E tests for claude-code adapter — real queries against Claude API
// Requires: ANTHROPIC_API_KEY env var or Claude Code OAuth
// Run: npm run test:e2e:claude
// Run specific model: E2E_CLAUDE_MODEL=opus-4.7 npm run test:e2e:claude

import { describe, it, expect } from 'vitest';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { resolveModel } from '../../models.js';
import { assertSimpleText, assertToolUse, assertThinking } from '../contract.js';
import { AdapterError, AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import {
  requireEnv,
  assertSimpleTextStream,
  assertEventTypes,
  assertNormalizedMessage,
  createE2eMcpServer,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  TOOL_PROMPT,
  TOOL_SYSTEM_PROMPT,
  THINKING_PROMPT,
  THINKING_SYSTEM_PROMPT,
  SUBAGENT_PROMPT,
  SUBAGENT_SYSTEM_PROMPT,
} from './shared.js';

// Claude Code SDK manages auth internally (OAuth, cached credentials, or ANTHROPIC_API_KEY).
// We skip only if SKIP_CLAUDE_E2E is explicitly set — otherwise we let the SDK try its auth flow.
const SKIP = !!process.env.SKIP_CLAUDE_E2E;

// Model to test — override with E2E_CLAUDE_MODEL env var (alias or full ID)
const MODEL = process.env.E2E_CLAUDE_MODEL || 'sonnet-4.6';
const FULL_MODEL_ID = resolveModel('claude-code', MODEL);

describe.skipIf(SKIP)(`claude-code e2e [${MODEL}]`, () => {
  it('simple text response (model alias)', async () => {
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);

    // Also validate with contract assertion
    // Re-run with fresh adapter since stream is consumed
    const adapter2 = createAdapter('claude-code');
    const contractResult = await assertSimpleText(
      adapter2.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 1,
      }),
    );
    expect(contractResult.passed).toBe(true);
  });

  it('simple text response (full model ID)', async () => {
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: FULL_MODEL_ID,
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);
  });

  it('thinking events', async () => {
    const adapter = createAdapter('claude-code');
    // Use 'enabled' for all models — adapter auto-converts to 'adaptive' for models that need it
    const events = await collectEvents(
      adapter.execute({
        prompt: THINKING_PROMPT,
        systemPrompt: THINKING_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 1,
        architectureConfig: {
          claude_thinking: { type: 'enabled', budgetTokens: 5000 },
        },
      }),
    );

    assertEventTypes(events, ['text_delta', 'assistant_message', 'result']);

    // Thinking events may or may not appear (adaptive models decide autonomously)
    const thinkingEvents = events.filter((e) => e.type === 'thinking') as Extract<
      UnifiedEvent,
      { type: 'thinking' }
    >[];
    if (thinkingEvents.length > 0) {
      const firstThinking = events.findIndex((e) => e.type === 'thinking');
      const firstTextDelta = events.findIndex((e) => e.type === 'text_delta');
      expect(firstThinking).toBeLessThan(firstTextDelta);

      for (const te of thinkingEvents) {
        expect(typeof te.text).toBe('string');
        expect(te.isSubagent).toBe(false);
      }

      // assistant_message should contain thinking content block
      const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Extract<
        UnifiedEvent,
        { type: 'assistant_message' }
      >[];
      const hasThinkingBlock = assistantMsgs.some((am) => am.message.content.some((b) => b.type === 'thinking'));
      expect(hasThinkingBlock, 'No assistant_message with thinking content block').toBe(true);
    }
  });

  it('tool use (in-process MCP)', async () => {
    const { config } = createE2eMcpServer();
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: TOOL_PROMPT,
        systemPrompt: TOOL_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 3,
        mcpServers: { 'e2e-test': config },
      }),
    );

    assertEventTypes(events, ['tool_use', 'tool_result', 'text_delta', 'result']);

    // tool_use should have echo tool
    const toolUses = events.filter((e) => e.type === 'tool_use') as Extract<UnifiedEvent, { type: 'tool_use' }>[];
    expect(toolUses.length).toBeGreaterThanOrEqual(1);
    const echoUse = toolUses.find((tu) => tu.toolName.includes('echo'));
    expect(echoUse, 'No tool_use for echo tool found').toBeDefined();
    expect(echoUse!.toolUseId.length).toBeGreaterThan(0);

    // tool_result should contain echo response
    const toolResults = events.filter((e) => e.type === 'tool_result') as Extract<
      UnifiedEvent,
      { type: 'tool_result' }
    >[];
    expect(toolResults.length).toBeGreaterThanOrEqual(1);

    // tool_result should come after tool_use
    const tuIdx = events.indexOf(toolUses[0]);
    const trIdx = events.indexOf(toolResults[0]);
    expect(trIdx).toBeGreaterThan(tuIdx);

    // assistant_message should contain toolUse content block
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Extract<
      UnifiedEvent,
      { type: 'assistant_message' }
    >[];
    const assistantBlocks = assistantMsgs.flatMap((am) => am.message.content);
    expect(assistantBlocks.some((b) => b.type === 'toolUse'), 'No toolUse content block in assistant message').toBe(true);

    // toolResult appears in rawMessages (as user role — tool responses come from "user")
    const resultEvent = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
    const allRawBlocks = resultEvent.rawMessages.flatMap((m) => m.content);
    expect(allRawBlocks.some((b) => b.type === 'toolResult'), 'No toolResult content block in rawMessages').toBe(true);
  });

  it('subagent events', async () => {
    const { config } = createE2eMcpServer();
    const adapter = createAdapter('claude-code');
    const events = await collectEvents(
      adapter.execute({
        prompt: SUBAGENT_PROMPT,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        model: MODEL,
        maxTurns: 5,
        mcpServers: { 'e2e-test': config },
      }),
    );

    assertEventTypes(events, ['text_delta', 'assistant_message', 'result']);

    // Check for subagent lifecycle events
    const started = events.filter((e) => e.type === 'subagent_started') as Extract<
      UnifiedEvent,
      { type: 'subagent_started' }
    >[];
    const completed = events.filter((e) => e.type === 'subagent_completed') as Extract<
      UnifiedEvent,
      { type: 'subagent_completed' }
    >[];

    // Subagent spawning is non-deterministic — model decides whether to delegate.
    // We validate structure if subagents were spawned, but don't fail if they weren't.
    if (started.length > 0) {
      for (const s of started) {
        expect(s.taskId).toBeTruthy();
        expect(typeof s.description).toBe('string');
      }

      expect(completed.length).toBeGreaterThanOrEqual(1);
      for (const c of completed) {
        expect(c.taskId).toBeTruthy();
        expect(typeof c.status).toBe('string');
      }

      // At least some events should be marked as coming from subagent
      const hasSubagentEvents = events.some(
        (e) => ('isSubagent' in e && e.isSubagent) || e.type.startsWith('subagent_'),
      );
      expect(hasSubagentEvents).toBe(true);
    }
  });

  it('abort mid-stream', async () => {
    const adapter = createAdapter('claude-code');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: 'Write a long essay about the history of computing. Make it very detailed.',
      systemPrompt: 'Write at least 2000 words.',
      model: MODEL,
      maxTurns: 1,
    })) {
      events.push(event);
      if (event.type === 'text_delta' && !aborted) {
        aborted = true;
        adapter.abort();
      }
    }

    // Should have received at least one text_delta before abort
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);

    // Should end with an error event (AdapterAbortError)
    const errorEvents = events.filter((e) => e.type === 'error') as Extract<UnifiedEvent, { type: 'error' }>[];
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].error).toBeInstanceOf(AdapterAbortError);
  });

  it('unknown model alias throws', async () => {
    const adapter = createAdapter('claude-code');

    const events: UnifiedEvent[] = [];
    let threwError = false;

    try {
      for await (const event of adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'glm-5.1',
        maxTurns: 1,
      })) {
        events.push(event);
      }
    } catch (err) {
      threwError = true;
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as Error).message).toContain('Unknown model');
      expect((err as Error).message).toContain('glm-5.1');
    }

    expect(threwError, 'Expected AdapterError to be thrown for unknown model alias').toBe(true);
  });
});
