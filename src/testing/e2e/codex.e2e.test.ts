// E2E tests for codex adapter — real queries against OpenAI API
// Requires: OPENAI_API_KEY env var
// Run: npm run test:e2e:codex

import { describe, it, expect, vi } from 'vitest';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import {
  requireEnv,
  assertSimpleTextStream,
  createPlanModeTmpDir,
  assertNoFileCreated,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  PLAN_WRITE_PROMPT,
  PLAN_WRITE_SYSTEM_PROMPT,
  runResumeScenario,
  RESUME_EXPECTED_NUMBER,
} from './shared.js';
import { assertNormalization } from '../normalization.js';
import { assertAdapterReady } from '../contract.js';
import type { UserInputHandler } from '../../types.js';

const HAS_API_KEY = requireEnv('OPENAI_API_KEY');

describe.skipIf(!HAS_API_KEY)('codex e2e', () => {
  it('emits adapter_ready with codexOptions + threadOptions before first message', async () => {
    const adapter = createAdapter('codex');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'gpt-5.5',
        maxTurns: 1,
      }),
    );

    const contractResult = assertAdapterReady(events, 'codex');
    expect(contractResult.passed, contractResult.assertions.filter((a) => !a.passed).map((a) => a.message).join('; ')).toBe(true);

    const ready = events.find((e) => e.type === 'adapter_ready') as Extract<UnifiedEvent, { type: 'adapter_ready' }>;
    const sdk = ready.sdkConfig as {
      codexOptions: { apiKey: string };
      threadOptions: { model: string; sandboxMode: string; approvalPolicy: string };
    };
    expect(sdk.codexOptions).toBeDefined();
    expect(sdk.codexOptions.apiKey).toBe('[REDACTED]');
    expect(sdk.threadOptions).toBeDefined();
    expect(sdk.threadOptions.model).toBe('gpt-5.5');
    expect(sdk.threadOptions.approvalPolicy).toBe('never');
  });

  it('simple text response (model alias)', async () => {
    const adapter = createAdapter('codex');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'gpt-5.5',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);

    // Codex only persists assistant text in NormalizedMessage.content;
    // shell/file/mcp tool flows surface as events but stay out of rawMessages.
    assertNormalization(events, {
      role: 'assistant',
      hasNative: true,
      blocks: [{ type: 'text' }],
    });

    // Codex has no native todo/plan primitive — snapshot must stay undefined,
    // and no todo_list_updated events should fire.
    const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
    expect(result.todoListSnapshot).toBeUndefined();
    expect(events.some((e) => e.type === 'todo_list_updated')).toBe(false);
  });

  it('simple text response (full model ID)', async () => {
    const adapter = createAdapter('codex');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'gpt-5.5',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);
  });

  // Codex does not support dynamic MCP configuration — skipped
  // Codex does not have native thinking events — skipped

  it('abort mid-stream', async () => {
    const adapter = createAdapter('codex');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: 'Write a long essay about the history of computing. Make it very detailed.',
      systemPrompt: 'Write at least 2000 words.',
      model: 'gpt-5.5',
      maxTurns: 1,
    })) {
      events.push(event);
      if (event.type === 'text_delta' && !aborted) {
        aborted = true;
        adapter.abort();
      }
    }

    expect(events.some((e) => e.type === 'text_delta')).toBe(true);

    const errorEvents = events.filter((e) => e.type === 'error') as Extract<UnifiedEvent, { type: 'error' }>[];
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].error).toBeInstanceOf(AdapterAbortError);
  });

  it('unknown model alias warns and passes through (SDK rejects)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const adapter = createAdapter('codex');
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
      } catch {
        threwError = true;
      }

      expect(threwError).toBe(false);
      const passthroughWarns = warnSpy.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('Unknown model "glm-5.1"') &&
          c[0].includes('passing through'),
      );
      expect(passthroughWarns.length).toBeGreaterThanOrEqual(1);
      const errorEvents = events.filter((e) => e.type === 'error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  describe('plan mode', () => {
    it('planMode=true blocks file creation (read-only sandbox)', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('codex');
        const events = await collectEvents(
          adapter.execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: 'gpt-5.5',
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        assertNoFileCreated(dir, 'notes.txt');
        expect(events.some((e) => e.type === 'result' || e.type === 'assistant_message')).toBe(true);
      } finally {
        cleanup();
      }
    });

    it('planMode=true allows listing files via read-only shell', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const adapter = createAdapter('codex');
        const events = await collectEvents(
          adapter.execute({
            prompt: 'List the files in the current directory using ls. Then report what you see.',
            systemPrompt: 'Use the shell tool with `ls` to list files.',
            model: 'gpt-5.5',
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
        expect(result.output.toLowerCase()).toContain('readme');
      } finally {
        cleanup();
      }
    });
  });

  it('no subagent events and subagentTaskId is never populated', async () => {
    const adapter = createAdapter('codex');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'gpt-5.5',
        maxTurns: 1,
      }),
    );

    // Codex SDK has no subagent concept.
    expect(events.some((e) => e.type.startsWith('subagent_'))).toBe(false);

    const deltaLikeTypes = new Set(['text_delta', 'thinking', 'tool_use', 'tool_result']);
    for (const e of events) {
      if (!deltaLikeTypes.has(e.type)) continue;
      const d = e as Extract<UnifiedEvent, { type: 'text_delta' | 'thinking' | 'tool_use' | 'tool_result' }>;
      expect(d.isSubagent).toBe(false);
      expect(d.subagentTaskId).toBeUndefined();
    }
  });

  describe('onUserInput — not supported by SDK', () => {
    it('emits warning and never invokes the handler', async () => {
      const adapter = createAdapter('codex');
      let handlerCalls = 0;
      const handler: UserInputHandler = async () => {
        handlerCalls += 1;
        return { action: 'cancel' };
      };
      const events = await collectEvents(
        adapter.execute({
          prompt: SIMPLE_PROMPT,
          systemPrompt: SIMPLE_SYSTEM_PROMPT,
          model: 'gpt-5.5',
          maxTurns: 1,
          onUserInput: handler,
        }),
      );

      expect(handlerCalls, 'codex must never invoke onUserInput').toBe(0);
      const warnings = events.filter((e) => e.type === 'warning') as Extract<UnifiedEvent, { type: 'warning' }>[];
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].message).toMatch(/codex.*not supported/i);
      expect(events.some((e) => e.type === 'result')).toBe(true);
    });
  });

  describe('resume_session (resumeSessionId round-trip)', () => {
    it('turn 2 recalls a number set in turn 1', async () => {
      const { turn2Events, sessionId } = await runResumeScenario(
        () => createAdapter('codex'),
        { model: 'gpt-5.5', maxTurns: 1 },
      );

      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);

      const result2 = turn2Events.find(
        (e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result',
      )!;
      expect(result2.output).toContain(RESUME_EXPECTED_NUMBER);
    });
  });
});
