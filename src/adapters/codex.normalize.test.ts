// Adapter-as-blackbox tests for codex normalization.
// Mocks @openai/codex-sdk and feeds fixtures of native events through the
// real CodexAdapter.execute() pipeline, asserting the resulting UnifiedEvent
// stream and the NormalizedMessages collected in `result.rawMessages`.
//
// Why blackbox: codex normalization is interleaved with stream/state handling
// (no isolated pure helpers to unit-test). Replaying captured event shapes is
// the cheapest way to lock in the native→unified mapping without an API key.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnifiedEvent } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';
import { assertNormalization } from '../testing/normalization.js';
import {
  SCENARIO_TEXT_ONLY,
  SCENARIO_TOOL_FLOW,
  SCENARIO_MCP_TOOL,
  SCENARIO_REASONING,
  SCENARIO_FAILED_COMMAND,
} from './__fixtures__/codex-events.js';

// Per-test container so `vi.mock` factory can read the active fixture.
// A thunk so individual tests can plug in generators that throw mid-stream
// (used to exercise the SDK's "subprocess exited" rethrow path).
let currentFixture: () => AsyncIterable<unknown> = async function* () {};

vi.mock('@openai/codex-sdk', () => {
  class FakeThread {
    async runStreamed(_prompt: string, _opts: unknown) {
      return { events: currentFixture() };
    }
  }
  class Codex {
    constructor(_opts: unknown) {}
    startThread(_opts: unknown) {
      return new FakeThread();
    }
    resumeThread(_id: string, _opts: unknown) {
      return new FakeThread();
    }
  }
  return { Codex };
});

beforeEach(() => {
  process.env.OPENAI_API_KEY ??= 'test-key';
});

async function runCodex(fixture: ReadonlyArray<unknown>): Promise<UnifiedEvent[]> {
  currentFixture = async function* () {
    for (const e of fixture) yield e;
  };
  const { CodexAdapter } = await import('./codex.js');
  const adapter = new CodexAdapter();
  return collectEvents(adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })));
}

describe('codex normalization (fixture replay)', () => {
  it('SCENARIO_TEXT_ONLY: agent_message → assistant NormalizedMessage with text block', async () => {
    const events = await runCodex(SCENARIO_TEXT_ONLY);
    assertNormalization(events, {
      role: 'assistant',
      hasNative: true,
      blocks: [{ type: 'text', text: 'Hello world' }],
    });
  });

  it('SCENARIO_TOOL_FLOW: command_execution emits tool_use + tool_result events; rawMessages hold only assistant text', async () => {
    const events = await runCodex(SCENARIO_TOOL_FLOW);

    const toolUses = events.filter((e) => e.type === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({ type: 'tool_use', toolName: 'shell', toolUseId: 'cmd_1' });

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({ type: 'tool_result', toolUseId: 'cmd_1', isError: false });

    // rawMessages should hold the two text-only assistant messages, not the tool blocks.
    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result?.rawMessages).toHaveLength(2);
    expect(result?.rawMessages.every((m) => m.role === 'assistant')).toBe(true);
    expect(
      result?.rawMessages.flatMap((m) => m.content).every((b) => b.type === 'text'),
      'codex should not put toolUse/toolResult into NormalizedMessage.content',
    ).toBe(true);

    assertNormalization(events, {
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Running shell…' },
        { type: 'text', text: 'Done.' },
      ],
    });
  });

  it('SCENARIO_MCP_TOOL: mcp_tool_call → tool_use with mcp__server__tool naming + tool_result', async () => {
    const events = await runCodex(SCENARIO_MCP_TOOL);

    const toolUse = events.find((e) => e.type === 'tool_use') as
      | Extract<UnifiedEvent, { type: 'tool_use' }>
      | undefined;
    expect(toolUse?.toolName).toBe('mcp__echo-srv__echo');
    expect(toolUse?.input).toEqual({ msg: 'hi' });

    assertNormalization(events, {
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Tool returned echoed.' }],
    });
  });

  it('SCENARIO_REASONING: reasoning → thinking event (NOT a NormalizedMessage block — codex only persists assistant text)', async () => {
    const events = await runCodex(SCENARIO_REASONING);

    const thinkings = events.filter((e) => e.type === 'thinking');
    expect(thinkings).toHaveLength(1);
    expect(thinkings[0]).toMatchObject({ type: 'thinking', text: 'thinking step 1' });

    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    const allBlocks = result?.rawMessages.flatMap((m) => m.content) ?? [];
    expect(allBlocks.every((b) => b.type === 'text')).toBe(true);
  });

  it('dedups subprocess-exit rethrow when SDK already emitted turn.failed', async () => {
    // The codex CLI exits non-zero after API rejection (e.g. unsupported
    // model on a ChatGPT-OAuth account) and the SDK rethrows
    // "Codex Exec exited with code N: <stderr>" — that's a duplicate of the
    // structured turn.failed already on the wire. The adapter must surface
    // exactly one error.
    currentFixture = async function* () {
      yield {
        type: 'turn.failed',
        error: {
          message:
            "The 'gpt-5.5-codex' model is not supported when using Codex with a ChatGPT account.",
        },
      };
      throw new Error('Codex Exec exited with code 1: Reading prompt from stdin...');
    };
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    const events = await collectEvents(
      adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })),
    );

    const errors = events.filter(
      (e) => e.type === 'error',
    ) as Extract<UnifiedEvent, { type: 'error' }>[];
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toContain('not supported when using Codex with a ChatGPT account');
    expect(errors[0].phase).toBe('runtime');
  });

  it('passes through non-dedup errors when no turn.failed was emitted', async () => {
    // If the SDK throws without first emitting a structured failure, the
    // adapter must still surface the error — the dedup heuristic only kicks
    // in when a turn.failed/error event was already yielded for this run.
    currentFixture = async function* () {
      yield { type: 'turn.started' };
      throw new Error('spawn ENOENT codex');
    };
    const { CodexAdapter } = await import('./codex.js');
    const adapter = new CodexAdapter();
    const events = await collectEvents(
      adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })),
    );

    const errors = events.filter(
      (e) => e.type === 'error',
    ) as Extract<UnifiedEvent, { type: 'error' }>[];
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('spawn ENOENT codex');
  });

  it('SCENARIO_FAILED_COMMAND: non-zero exit_code → tool_result.isError=true', async () => {
    const events = await runCodex(SCENARIO_FAILED_COMMAND);
    const toolResult = events.find((e) => e.type === 'tool_result') as
      | Extract<UnifiedEvent, { type: 'tool_result' }>
      | undefined;
    expect(toolResult?.isError).toBe(true);
  });

  it('result event aggregates usage from turn.completed', async () => {
    const events = await runCodex(SCENARIO_TEXT_ONLY);
    const result = events.find((e) => e.type === 'result') as
      | Extract<UnifiedEvent, { type: 'result' }>
      | undefined;
    expect(result?.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result?.output).toBe('Hello world');
  });

  it('missing OPENAI_API_KEY does not block init — adapter falls through to CLI for local OAuth', async () => {
    // The Codex CLI resolves auth from ~/.codex/auth.json (after `codex login`)
    // when no api key is provided. The adapter must not pre-empt that path.
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      currentFixture = async function* () {
        for (const e of SCENARIO_TEXT_ONLY) yield e;
      };
      const { CodexAdapter } = await import('./codex.js');
      const adapter = new CodexAdapter();
      const events = await collectEvents(adapter.execute(createTestParams({ model: 'gpt-5.5-codex' })));

      // No init error.
      const initErrors = events.filter(
        (e) => e.type === 'error' && (e as Extract<UnifiedEvent, { type: 'error' }>).phase === 'init',
      );
      expect(initErrors).toHaveLength(0);

      // adapter_ready was emitted, and codexOptions has no apiKey field.
      const ready = events.find((e) => e.type === 'adapter_ready') as
        | Extract<UnifiedEvent, { type: 'adapter_ready' }>
        | undefined;
      expect(ready).toBeDefined();
      const sdkConfig = ready!.sdkConfig as { codexOptions: Record<string, unknown> };
      expect(sdkConfig.codexOptions).not.toHaveProperty('apiKey');

      // Run continued through the mocked SDK and produced a result.
      expect(events.some((e) => e.type === 'result')).toBe(true);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});
