// M01 `toolCallTimeoutMs` / M06 `subagentTimeoutMs` on gemini: the shared caps wired
// through observeIdle. Subagent lifecycle is synthesized from threadId here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterSubagentTimeoutError, AdapterToolCallTimeoutError } from '../types.js';
import type { RuntimeExecuteParams } from '../types.js';
import { collectEvents } from '../utils.js';
import { createTestParams } from '../testing/helpers.js';

/** `{ sleep: ms }` pauses the scripted stream; `session.abort()` ends it as `aborted`. */
let scriptedEvents: Array<Record<string, unknown>> = [];

vi.mock('@google/gemini-cli-core', () => {
  class Config {
    storage = { getProjectTempDir: () => '/tmp/gemini-run-caps-test' };
    async initialize() {}
    async refreshAuth() {}
  }
  class GeminiClient {
    async initialize() {}
    async resumeChat() {}
  }
  class LegacyAgentSession {
    private wakeOnAbort: (() => void) | null = null;
    private aborted = false;
    async *sendStream() {
      for (const e of scriptedEvents) {
        if (typeof e.sleep === 'number') {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, e.sleep as number);
            this.wakeOnAbort = () => {
              clearTimeout(t);
              resolve();
            };
          });
          if (this.aborted) {
            yield { id: 'abort', type: 'agent_end', streamId: 's-run', reason: 'aborted' };
            return;
          }
          continue;
        }
        yield e;
      }
    }
    async abort() {
      this.aborted = true;
      this.wakeOnAbort?.();
    }
  }
  return {
    Config,
    GeminiClient,
    LegacyAgentSession,
    AuthType: { USE_GEMINI: 'gemini-api-key' },
    MCPServerConfig: class {},
    MessageBusType: {},
    ToolConfirmationOutcome: {},
  };
});

beforeEach(() => {
  process.env.GOOGLE_API_KEY ??= 'test-key';
});

const CAP_MS = 150;

async function run(params: Partial<RuntimeExecuteParams>) {
  const { GeminiAdapter } = await import('./gemini.js');
  return collectEvents(new GeminiAdapter().execute(createTestParams({ model: 'gemini-2.5-pro', ...params })), 10_000);
}

describe('gemini — toolCallTimeoutMs', () => {
  it('a tool call that never returns ends the run with AdapterToolCallTimeoutError', async () => {
    scriptedEvents = [
      { id: 'e1', type: 'tool_request', name: 'run_shell_command', requestId: 'req-1', args: {} },
      { sleep: 60_000 },
      { id: 'e3', type: 'agent_end', streamId: 's-run', reason: 'completed' },
    ];
    const events = await run({ toolCallTimeoutMs: CAP_MS });

    const errs = events.filter((e) => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ phase: 'runtime' });
    expect((errs[0] as { error: Error }).error).toBeInstanceOf(AdapterToolCallTimeoutError);
    expect((errs[0] as { error: Error }).error).toMatchObject({ toolName: 'run_shell_command', toolUseId: 'req-1' });
  });
});

describe('gemini — subagentTimeoutMs', () => {
  it('closes the open thread with a synthesized aborted completion, then ends with AdapterSubagentTimeoutError', async () => {
    scriptedEvents = [
      { id: 'e1', type: 'tool_request', threadId: 'thread-1', name: 'delegate', requestId: 'req-1', args: {} },
      { sleep: 60_000 },
      { id: 'e3', type: 'agent_end', streamId: 's-run', reason: 'completed' },
    ];
    const events = await run({ subagentTimeoutMs: CAP_MS, toolCallTimeoutMs: CAP_MS / 2 });

    expect(events.filter((e) => e.type === 'subagent_completed')).toMatchObject([{ taskId: 'thread-1', status: 'aborted' }]);
    const errs = events.filter((e) => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect((errs[0] as { error: Error }).error).toBeInstanceOf(AdapterSubagentTimeoutError);
  });
});
