// E2E tests for opencode-openrouter adapter — real queries via OpenRouter
// Requires: OPENROUTER_API_KEY env var + opencode CLI in PATH
// Run: npm run test:e2e:opencode

import { describe, it, expect, vi } from 'vitest';
import { createAdapter } from '../../factory.js';
import { probeToolGating } from '../../tool-groups.js';
import { collectEvents } from '../../utils.js';
import { isOpencodeAvailable } from '../../adapters/opencode.js';
import { AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import {
  requireEnv,
  assertSimpleTextStream,
  assertNoBackgroundTasksStream,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  SUBAGENT_PROMPT,
  SUBAGENT_SYSTEM_PROMPT,
  USER_QUESTION_PROMPT,
  USER_QUESTION_SYSTEM_PROMPT,
  runUserQuestionScenario,
  assertUserInputRequest,
  assertSubagentTaskIdConsistency,
  TODO_PROMPT,
  TODO_SYSTEM_PROMPT,
  assertTodoListUpdated,
  runResumeScenario,
  RESUME_EXPECTED_NUMBER,
  assertResumeUsageIndependence,
  createPlanModeTmpDir,
  assertNoFileCreated,
  PLAN_WRITE_PROMPT,
  PLAN_WRITE_SYSTEM_PROMPT,
  GATING_SHELL_PROMPT,
  GATING_SHELL_SYSTEM_PROMPT,
  assertNoToolFromGroup,
  assertToolPolicyRefusal,
} from './shared.js';
import { assertNormalization } from '../normalization.js';
import { assertAdapterReady, assertSubagentLifecycle } from '../contract.js';

const HAS_API_KEY = requireEnv('OPENROUTER_API_KEY');
const HAS_CLI = isOpencodeAvailable();

describe.skipIf(!HAS_API_KEY || !HAS_CLI)('opencode-openrouter e2e', () => {
  it('emits adapter_ready with opencode config before first message', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'claude-sonnet-4',
        maxTurns: 1,
      }),
    );

    const contractResult = assertAdapterReady(events, 'opencode');
    expect(contractResult.passed, contractResult.assertions.filter((a) => !a.passed).map((a) => a.message).join('; ')).toBe(true);

    const ready = events.find((e) => e.type === 'adapter_ready') as Extract<UnifiedEvent, { type: 'adapter_ready' }>;
    const sdk = ready.sdkConfig as {
      port: number;
      config: { provider: Record<string, { api?: string }>; agent: { build: { model: string } } };
    };
    expect(typeof sdk.port).toBe('number');
    expect(sdk.config.agent.build.model).toBeTruthy();
    const providerEntry = Object.values(sdk.config.provider)[0] as { api?: string };
    expect(providerEntry.api).not.toBe(process.env.OPENROUTER_API_KEY);
  });

  it('simple text response (model alias)', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'claude-sonnet-4',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);

    // The opencode SDK never backgrounds work (M17) — the family must be absent, and
    // absence is not something to warn about on every turn.
    assertNoBackgroundTasksStream(events);

    const result = events.find(
      (e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result',
    );
    expect(result?.output).not.toContain(SIMPLE_PROMPT);
    expect(result?.rawMessages.every((m) => m.role === 'assistant')).toBe(true);

    // OpenCode bundles all blocks (text, thinking, toolUse, toolResult) into
    // a single accumulating NormalizedMessage that flushes on message-id change.
    assertNormalization(events, {
      role: 'assistant',
      blocks: [{ type: 'text' }],
    });
  });

  it('simple text response (full model ID)', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events = await collectEvents(
      adapter.execute({
        prompt: SIMPLE_PROMPT,
        systemPrompt: SIMPLE_SYSTEM_PROMPT,
        model: 'anthropic/claude-sonnet-4',
        maxTurns: 1,
      }),
    );

    assertSimpleTextStream(events);
  });

  // OpenCode: thinking is model-dependent, not architecture-configured — skipped
  // OpenCode: only supports stdio MCP, no in-process MCP — skipped

  it('abort mid-stream', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: 'Write a long essay about the history of computing. Make it very detailed.',
      systemPrompt: 'Write at least 2000 words.',
      model: 'claude-sonnet-4',
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
      const adapter = createAdapter('opencode-openrouter');
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

  // Plan mode was a `console.warn` no-op here; under M18 it desugars into
  // deny-groups and is GENUINELY ENFORCED, server-side. That is the single
  // biggest behavioural change in this release for opencode consumers.
  describe('plan mode (M18 preset — now enforced, not warned about)', () => {
    it('planMode=true no longer emits the "not natively supported" warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const events = await collectEvents(
          createAdapter('opencode-openrouter').execute({
            prompt: SIMPLE_PROMPT,
            systemPrompt: SIMPLE_SYSTEM_PROMPT,
            model: 'claude-sonnet-4',
            maxTurns: 1,
            planMode: true,
          }),
        );
        expect(events.some((e) => e.type === 'result')).toBe(true);
        expect(
          warnSpy.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('planMode not natively supported'),
          ),
          'plan mode is enforced now — the no-op warning must be gone',
        ).toEqual([]);
      } finally {
        warnSpy.mockRestore();
      }
    }, 120_000);

    it('planMode=true blocks file creation', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        await collectEvents(
          createAdapter('opencode-openrouter').execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: 'claude-sonnet-4',
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        assertNoFileCreated(dir, 'notes.txt');
      } finally {
        cleanup();
      }
    }, 120_000);
  });

  // --- tool-gating scenario (M18) ---
  //
  // OpenCode is the strongest of the four: permission buckets are evaluated
  // server-side, so a denied tool is REFUSED BEFORE EXECUTION rather than merely
  // hidden from the model.
  describe('tool-gating (server-side permission buckets)', () => {
    it('a denied `shell` is unusable for the whole run', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const events = await collectEvents(
          createAdapter('opencode-openrouter').execute({
            prompt: GATING_SHELL_PROMPT,
            systemPrompt: GATING_SHELL_SYSTEM_PROMPT,
            model: 'claude-sonnet-4',
            maxTurns: 3,
            cwd: dir,
            disallowedToolGroups: ['shell'],
          }),
        );
        assertNoToolFromGroup(events, 'shell');
      } finally {
        cleanup();
      }
    }, 120_000);

    it('a denied `file-write` blocks mutation', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const events = await collectEvents(
          createAdapter('opencode-openrouter').execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: 'claude-sonnet-4',
            maxTurns: 3,
            cwd: dir,
            disallowedToolGroups: ['file-write', 'shell'],
          }),
        );
        assertNoToolFromGroup(events, 'file-write');
        assertNoFileCreated(dir, 'notes.txt');
      } finally {
        cleanup();
      }
    }, 120_000);

    // The delegation bucket is part of the file-read mapping precisely so this
    // cannot happen.
    it('a denied `file-read` cannot be laundered through a subagent', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const events = await collectEvents(
          createAdapter('opencode-openrouter').execute({
            prompt:
              'Delegate to a subagent if you can: have it read README.md in the current directory ' +
              'and report its first line verbatim.',
            systemPrompt: 'Use your tools, including delegation, to answer.',
            model: 'claude-sonnet-4',
            maxTurns: 4,
            cwd: dir,
            disallowedToolGroups: ['file-read'],
          }),
        );
        assertNoToolFromGroup(events, 'file-read');
        const result = events.find((e) => e.type === 'result') as
          | Extract<UnifiedEvent, { type: 'result' }>
          | undefined;
        expect(
          result?.output.toLowerCase().includes('test seed'),
          'the seed content leaked despite a file-read deny — the delegation bucket did not hold',
        ).toBe(false);
      } finally {
        cleanup();
      }
    }, 180_000);

    it('an unknown group refuses the run before dispatch', async () => {
      const events = await collectEvents(
        createAdapter('opencode-openrouter').execute({
          prompt: SIMPLE_PROMPT,
          systemPrompt: SIMPLE_SYSTEM_PROMPT,
          model: 'claude-sonnet-4',
          disallowedToolGroups: ['sehll' as 'shell'],
        }),
      );
      assertToolPolicyRefusal(events);
    }, 60_000);

    // The documented escape surface: the server's permission schema ends in a
    // catch-all, so an unknown bucket is accepted and SILENTLY IGNORED. The
    // adapter may therefore claim `hard` only for buckets verified against the
    // running server — which is what the unit test pins.
    it('claims hard strength, which is only sound because the bucket names are verified', () => {
      for (const report of probeToolGating('opencode-openrouter', ['shell', 'file-read'])) {
        expect(report.strength).toBe('hard');
        expect(report.escapeSurfaces).toEqual([]);
      }
    });
  });

  it('abort with a task subagent in flight closes the ONE tracked pair', async (ctx) => {
    // NOT VERIFIED LIVE as of 0.9.8 — written alongside the claude-code leg.
    // Attribution here is ordering-based under a single-active assumption, so the
    // flush closes exactly the one subagent the adapter was tracking. A nested or
    // concurrent `task` was never opened as its own pair, and nothing is claimed for
    // it — that is the documented degradation, not a gap in this case.
    const adapter = createAdapter('opencode-openrouter');
    const events: UnifiedEvent[] = [];
    let aborted = false;

    for await (const event of adapter.execute({
      prompt: SUBAGENT_PROMPT,
      systemPrompt: SUBAGENT_SYSTEM_PROMPT,
      model: 'claude-sonnet-4',
      maxTurns: 5,
    })) {
      events.push(event);
      if (event.type === 'subagent_started' && !aborted) {
        aborted = true;
        adapter.abort();
      }
    }

    if (!events.some((e) => e.type === 'subagent_started')) {
      console.warn(
        `[INCONCLUSIVE] opencode abort × subagents: the model never delegated. ` +
          `Sequence: ${events.map((e) => e.type).join(' → ')}`,
      );
      ctx.skip();
    }

    const lifecycle = assertSubagentLifecycle(events);
    expect(lifecycle.assertions.filter((a) => !a.passed).map((a) => `${a.name}: ${a.message}`)).toEqual([]);
    expect(
      events.filter((e) => e.type === 'subagent_completed' && e.status === 'aborted').length,
      'at most one — single-active by construction',
    ).toBeLessThanOrEqual(1);
  }, 120_000);

  it('subagent events carry subagentTaskId on deltas (ordering-based)', async () => {
    const adapter = createAdapter('opencode-openrouter');
    const events = await collectEvents(
      adapter.execute({
        prompt: SUBAGENT_PROMPT,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        model: 'claude-sonnet-4',
        maxTurns: 5,
      }),
    );

    const started = events.filter((e) => e.type === 'subagent_started') as Extract<
      UnifiedEvent,
      { type: 'subagent_started' }
    >[];

    // Subagent spawning is non-deterministic. Only assert if the model delegated.
    if (started.length > 0) {
      // The ordering heuristic is allowed to miss deltas (undefined is tolerated),
      // but wrong IDs must never appear.
      assertSubagentTaskIdConsistency(events);
    }
  });

  describe('onUserInput — question events bridge', () => {
    it('model fires ask-user question tool → handler runs → answer reaches the model', async () => {
      const adapter = createAdapter('opencode-openrouter');
      const { events, handlerCalls } = await runUserQuestionScenario(adapter, {
        prompt: USER_QUESTION_PROMPT,
        systemPrompt: USER_QUESTION_SYSTEM_PROMPT,
        model: 'claude-sonnet-4',
        maxTurns: 4,
        mockAnswer: 'banana',
      });

      expect(handlerCalls, 'onUserInput should fire at least once').toBeGreaterThanOrEqual(1);
      const req = assertUserInputRequest(events, 'model-tool');
      expect(req.request.origin).toBe('opencode');

      const finalText = (events.filter((e) => e.type === 'assistant_message') as Extract<
        UnifiedEvent,
        { type: 'assistant_message' }
      >[])
        .flatMap((m) => m.message.content.filter((c) => c.type === 'text'))
        .map((c) => (c as { text: string }).text)
        .join(' ')
        .toLowerCase();
      expect(finalText, `expected "banana" in final output, got: ${finalText}`).toContain('banana');
    });
  });

  describe('todo list (todo.updated → todo_list_updated + synthetic message)', () => {
    it('emits session-state event, syntesizes rawMessages entry, and snapshots on result', async () => {
      const adapter = createAdapter('opencode-openrouter');
      const events = await collectEvents(
        adapter.execute({
          prompt: TODO_PROMPT,
          systemPrompt: TODO_SYSTEM_PROMPT,
          model: 'claude-sonnet-4',
          maxTurns: 2,
        }),
      );

      // 1. At least one todo_list_updated with source 'session-state'.
      const todoEvent = assertTodoListUpdated(events, { expectedSource: 'session-state' });
      expect(todoEvent.items.length).toBeGreaterThanOrEqual(1);

      // 2. No TodoWrite tool_use leaked — opencode routes todo through the
      //    session-state channel, not through tool calls.
      const todoWriteToolUse = events.filter(
        (e): e is Extract<UnifiedEvent, { type: 'tool_use' }> =>
          e.type === 'tool_use' && e.toolName === 'TodoWrite',
      );
      expect(todoWriteToolUse.length).toBe(0);

      // 3. result.rawMessages contains a synthetic message with a todoList
      //    content block and native === undefined (marker for "not a
      //    passthrough SDK message").
      const result = events.find(
        (e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result',
      );
      expect(result).toBeDefined();
      const synthetic = result!.rawMessages.find(
        (m) => m.content.some((b) => b.type === 'todoList') && m.native === undefined,
      );
      expect(synthetic, 'expected a synthetic todoList message with native=undefined').toBeDefined();
      expect(synthetic!.role).toBe('assistant');

      // 4. Snapshot matches the last event.
      expect(result!.todoListSnapshot).toBeDefined();
      expect(result!.todoListSnapshot).toEqual(todoEvent.items);
    });
  });

  describe('resume_session (resumeSessionId round-trip)', () => {
    it('turn 2 recalls a number set in turn 1 and reports per-call usage', async () => {
      const { sessionId, result1, result2 } = await runResumeScenario(
        () => createAdapter('opencode-openrouter'),
        { model: 'claude-sonnet-4', maxTurns: 1, cwd: process.cwd() },
      );

      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
      expect(result2.output).toContain(RESUME_EXPECTED_NUMBER);

      assertResumeUsageIndependence(result1, result2);
    });
  });
});
