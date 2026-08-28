// E2E tests for codex adapter — real queries against OpenAI / ChatGPT
// Auth: OPENAI_API_KEY env var OR local ChatGPT OAuth via `codex login`
// (the SDK resolves credentials internally — see codex-sdk SKILL.md quirk #8).
// Run: npm run test:e2e:codex

import { describe, it, expect, vi } from 'vitest';
import { createAdapter } from '../../factory.js';
import { collectEvents } from '../../utils.js';
import { AdapterAbortError } from '../../types.js';
import type { UnifiedEvent } from '../../types.js';
import {
  assertSimpleTextStream,
  assertNoBackgroundTasksStream,
  createPlanModeTmpDir,
  assertNoFileCreated,
  SIMPLE_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  PLAN_WRITE_PROMPT,
  PLAN_WRITE_SYSTEM_PROMPT,
  runResumeScenario,
  RESUME_EXPECTED_NUMBER,
  assertResumeUsageIndependence,
  assertToolPolicyRefusal,
  assertPorousWarning,
} from './shared.js';
import { assertNormalization } from '../normalization.js';
import { assertAdapterReady } from '../contract.js';
import type { UserInputHandler } from '../../types.js';

// Codex SDK manages auth internally (OPENAI_API_KEY or ChatGPT OAuth via `codex login`).
// We skip only if SKIP_CODEX_E2E is explicitly set — otherwise we let the SDK try its auth flow.
const SKIP = !!process.env.SKIP_CODEX_E2E;

describe.skipIf(SKIP)('codex e2e', () => {
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
      codexOptions: { apiKey?: string };
      threadOptions: { model: string; sandboxMode: string; approvalPolicy: string };
    };
    expect(sdk.codexOptions).toBeDefined();
    // apiKey is present-and-redacted only when OPENAI_API_KEY is set; under
    // ChatGPT OAuth (`codex login` → `~/.codex/auth.json`) the adapter omits
    // the field entirely. See codex-sdk SKILL.md quirk #8.
    if (process.env.OPENAI_API_KEY) {
      expect(sdk.codexOptions.apiKey).toBe('[REDACTED]');
    } else {
      expect(sdk.codexOptions.apiKey).toBeUndefined();
    }
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

    // The codex SDK never backgrounds work (M17) — the family must be absent, and
    // absence is not something to warn about on every turn.
    assertNoBackgroundTasksStream(events);

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

  // Plan mode now desugars into disallowedToolGroups ['file-write','shell'] and
  // inherits M18's fail-closed posture. Codex has NO shell primitive at all, so
  // what used to be "a read-only sandbox with a live shell" — plan mode's
  // contract half-honoured, silently — is now a refusal. That change is the
  // behavioural half of this release's breaking bump.
  describe('plan mode (M18 preset — refuses on codex)', () => {
    it('planMode=true refuses the run before dispatch instead of half-honouring it', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const events = await collectEvents(
          createAdapter('codex').execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: 'gpt-5.5',
            maxTurns: 3,
            cwd: dir,
            planMode: true,
          }),
        );
        assertToolPolicyRefusal(events, ['shell']);
        // Fail-closed all the way through: nothing ran, so nothing was written.
        assertNoFileCreated(dir, 'notes.txt');
      } finally {
        cleanup();
      }
    }, 60_000);

    // The documented opt-out: pass an explicit empty deny-set instead of the
    // preset, and the run proceeds exactly as it did before this release.
    it('an explicit empty disallowedToolGroups is the documented opt-out', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const events = await collectEvents(
          createAdapter('codex').execute({
            prompt: 'List the files in the current directory using ls. Then report what you see.',
            systemPrompt: 'Use the shell tool with `ls` to list files.',
            model: 'gpt-5.5',
            maxTurns: 3,
            cwd: dir,
            disallowedToolGroups: [],
          }),
        );
        const result = events.find((e) => e.type === 'result') as Extract<UnifiedEvent, { type: 'result' }>;
        expect(result.output.toLowerCase()).toContain('readme');
      } finally {
        cleanup();
      }
    }, 120_000);
  });

  // --- tool-gating scenario (M18) ---
  describe('tool-gating (coarse sandbox posture, and two groups it cannot express)', () => {
    it.each(['shell', 'file-read'] as const)(
      'refuses `%s` before dispatch — ThreadOptions has no primitive for it',
      async (group) => {
        const events = await collectEvents(
          createAdapter('codex').execute({
            prompt: 'hello',
            systemPrompt: 'You are helpful.',
            model: 'gpt-5.5',
            disallowedToolGroups: [group],
          }),
        );
        assertToolPolicyRefusal(events, [group]);
      },
      60_000,
    );

    it('refuses the whole run rather than applying the enforceable remainder', async () => {
      const events = await collectEvents(
        createAdapter('codex').execute({
          prompt: 'hello',
          systemPrompt: 'You are helpful.',
          model: 'gpt-5.5',
          // `file-write` IS enforceable here; `shell` is not. No partial application.
          disallowedToolGroups: ['file-write', 'shell'],
        }),
      );
      assertToolPolicyRefusal(events, ['shell']);
    }, 60_000);

    it('a denied `file-write` blocks mutation through the read-only sandbox', async () => {
      const { dir, cleanup } = createPlanModeTmpDir();
      try {
        const events = await collectEvents(
          createAdapter('codex').execute({
            prompt: PLAN_WRITE_PROMPT,
            systemPrompt: PLAN_WRITE_SYSTEM_PROMPT,
            model: 'gpt-5.5',
            maxTurns: 3,
            cwd: dir,
            disallowedToolGroups: ['file-write'],
          }),
        );
        assertNoFileCreated(dir, 'notes.txt');
        // Coarse, not a per-tool gate: reads and the shell stay live, and the
        // run says so.
        assertPorousWarning(events, true);
      } finally {
        cleanup();
      }
    }, 120_000);

    it('an unknown group refuses the run', async () => {
      const events = await collectEvents(
        createAdapter('codex').execute({
          prompt: 'hello',
          systemPrompt: 'You are helpful.',
          model: 'gpt-5.5',
          disallowedToolGroups: ['netwrok' as 'web'],
        }),
      );
      assertToolPolicyRefusal(events);
    }, 60_000);
  });

  it('emits no synthesized subagent_completed on abort either — the absence IS the contract', async () => {
    // M06's termination flush closes every subagent the adapter has OPEN. Codex has no
    // subagent concept at all, so it opens none and closes none: zero lifecycle events
    // on every path, aborted or not. This is a deliberate contract, not an omission —
    // do not "fix" it by adding a flush here.
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

    expect(events.some((e) => e.type.startsWith('subagent_'))).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(true);
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
    it('turn 2 recalls a number set in turn 1 and reports per-call usage', async () => {
      const { sessionId, result1, result2 } = await runResumeScenario(
        () => createAdapter('codex'),
        { model: 'gpt-5.5', maxTurns: 1 },
      );

      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
      expect(result2.output).toContain(RESUME_EXPECTED_NUMBER);

      assertResumeUsageIndependence(result1, result2);
    });
  });
});
