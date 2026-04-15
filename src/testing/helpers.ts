// Test helpers — MockAdapter for unit testing

import type { RuntimeAdapter, RuntimeExecuteParams, UnifiedEvent } from '../types.js';

/**
 * Mock adapter for unit testing.
 * Yields a predefined sequence of events.
 *
 * @example
 * ```ts
 * const mock = new MockAdapter('test', [
 *   { type: 'text_delta', text: 'Hello', isSubagent: false },
 *   { type: 'result', output: 'Hello', rawMessages: [], usage: { inputTokens: 10, outputTokens: 5 } },
 * ]);
 * const result = await assertSimpleText(mock.execute(params));
 * ```
 */
export class MockAdapter implements RuntimeAdapter {
  architecture: string;
  private events: UnifiedEvent[];
  private aborted = false;

  constructor(architecture: string, events: UnifiedEvent[]) {
    this.architecture = architecture;
    this.events = events;
  }

  abort(): void {
    this.aborted = true;
  }

  async *execute(_params: RuntimeExecuteParams): AsyncIterable<UnifiedEvent> {
    for (const event of this.events) {
      if (this.aborted) return;
      yield event;
    }
  }
}

/** Create a minimal valid params object for testing */
export function createTestParams(overrides?: Partial<RuntimeExecuteParams>): RuntimeExecuteParams {
  return {
    prompt: 'test prompt',
    systemPrompt: 'test system prompt',
    model: 'test-model',
    ...overrides,
  };
}
