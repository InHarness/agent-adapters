// Contract assertions — adapter-agnostic, operates only on AsyncIterable<UnifiedEvent>
// Exported for custom adapter validation

import type { Architecture, UnifiedEvent, ContractResult, ContractAssertion } from '../types.js';
import { collectEvents } from '../utils.js';

// Known secret prefixes that should never leak through redactSecrets.
// If any of these appear in the serialized sdkConfig, the redactor missed them.
const SECRET_LEAK_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]/i,
  /ghp_[A-Za-z0-9]/,
  /gho_[A-Za-z0-9]/,
  /"Bearer\s+\S/,
  /xoxb-[A-Za-z0-9]/,
];

function assert(name: string, condition: boolean, message?: string): ContractAssertion {
  return { name, passed: condition, message: condition ? undefined : message };
}

function buildResult(scenario: string, events: UnifiedEvent[], assertions: ContractAssertion[]): ContractResult {
  return {
    scenario,
    passed: assertions.every((a) => a.passed),
    events,
    assertions,
  };
}

/**
 * Validate a simple text response stream.
 * Checks: ≥1 text_delta, ≥1 assistant_message, 1 terminal result, non-empty output.
 */
export async function assertSimpleText(stream: AsyncIterable<UnifiedEvent>): Promise<ContractResult> {
  const events = await collectEvents(stream);
  const assertions: ContractAssertion[] = [];

  const textDeltas = events.filter((e) => e.type === 'text_delta');
  assertions.push(assert('has text_delta events', textDeltas.length >= 1, `Expected ≥1 text_delta, got ${textDeltas.length}`));

  const assistantMessages = events.filter((e) => e.type === 'assistant_message');
  assertions.push(
    assert('has assistant_message', assistantMessages.length >= 1, `Expected ≥1 assistant_message, got ${assistantMessages.length}`),
  );

  const results = events.filter((e) => e.type === 'result');
  assertions.push(assert('has result event', results.length === 1, `Expected 1 result, got ${results.length}`));

  if (results.length === 1) {
    const result = results[0] as Extract<UnifiedEvent, { type: 'result' }>;
    assertions.push(assert('result.output is non-empty', result.output.length > 0, 'result.output is empty'));
    assertions.push(
      assert(
        'result.rawMessages has assistant message',
        result.rawMessages.some((m) => m.role === 'assistant'),
        'No assistant message in rawMessages',
      ),
    );
  }

  const nonFlush = events.filter((e) => e.type !== 'flush');
  if (nonFlush.length > 0) {
    assertions.push(
      assert(
        'result is terminal event',
        nonFlush[nonFlush.length - 1].type === 'result',
        `Last non-flush event is ${nonFlush[nonFlush.length - 1].type}, expected result`,
      ),
    );
  }

  return buildResult('simple_text', events, assertions);
}

/**
 * Validate a tool use stream.
 * Checks: ≥1 tool_use with toolName+toolUseId, matching tool_result, correct ordering.
 */
export async function assertToolUse(stream: AsyncIterable<UnifiedEvent>): Promise<ContractResult> {
  const events = await collectEvents(stream);
  const assertions: ContractAssertion[] = [];

  const toolUses = events.filter((e) => e.type === 'tool_use') as Extract<UnifiedEvent, { type: 'tool_use' }>[];
  assertions.push(assert('has tool_use event', toolUses.length >= 1, `Expected ≥1 tool_use, got ${toolUses.length}`));

  if (toolUses.length >= 1) {
    const tu = toolUses[0];
    assertions.push(assert('tool_use has toolName', typeof tu.toolName === 'string' && tu.toolName.length > 0, 'tool_use.toolName is empty'));
    assertions.push(assert('tool_use has toolUseId', typeof tu.toolUseId === 'string' && tu.toolUseId.length > 0, 'tool_use.toolUseId is empty'));
  }

  const toolResults = events.filter((e) => e.type === 'tool_result') as Extract<UnifiedEvent, { type: 'tool_result' }>[];
  assertions.push(assert('has tool_result event', toolResults.length >= 1, `Expected ≥1 tool_result, got ${toolResults.length}`));

  if (toolUses.length >= 1 && toolResults.length >= 1) {
    const tuIndex = events.indexOf(toolUses[0]);
    const trIndex = events.indexOf(toolResults[0]);
    assertions.push(assert('tool_result after tool_use', trIndex > tuIndex, `tool_result at ${trIndex} before tool_use at ${tuIndex}`));
  }

  const results = events.filter((e) => e.type === 'result');
  assertions.push(assert('has result event', results.length === 1, `Expected 1 result, got ${results.length}`));

  const assistantMessages = events.filter((e) => e.type === 'assistant_message');
  assertions.push(
    assert('has assistant_message', assistantMessages.length >= 1, `Expected ≥1 assistant_message, got ${assistantMessages.length}`),
  );

  return buildResult('tool_use', events, assertions);
}

/**
 * Validate a thinking stream.
 * Checks: ≥1 thinking with non-empty text, thinking before text_delta.
 */
export async function assertThinking(stream: AsyncIterable<UnifiedEvent>): Promise<ContractResult> {
  const events = await collectEvents(stream);
  const assertions: ContractAssertion[] = [];

  const thinkingEvents = events.filter((e) => e.type === 'thinking') as Extract<UnifiedEvent, { type: 'thinking' }>[];
  assertions.push(assert('has thinking events', thinkingEvents.length >= 1, `Expected ≥1 thinking, got ${thinkingEvents.length}`));

  if (thinkingEvents.length >= 1) {
    assertions.push(
      assert('thinking has non-empty text', thinkingEvents[0].text.length > 0, 'thinking.text is empty'),
    );
  }

  const firstThinkingIdx = events.findIndex((e) => e.type === 'thinking');
  const firstTextDeltaIdx = events.findIndex((e) => e.type === 'text_delta');
  if (firstThinkingIdx >= 0 && firstTextDeltaIdx >= 0) {
    assertions.push(
      assert('thinking before text_delta', firstThinkingIdx < firstTextDeltaIdx, `thinking at ${firstThinkingIdx} after text_delta at ${firstTextDeltaIdx}`),
    );
  }

  const textDeltas = events.filter((e) => e.type === 'text_delta');
  assertions.push(assert('has text_delta events', textDeltas.length >= 1, `Expected ≥1 text_delta, got ${textDeltas.length}`));

  const results = events.filter((e) => e.type === 'result');
  assertions.push(assert('has result event', results.length === 1, `Expected 1 result, got ${results.length}`));

  return buildResult('thinking', events, assertions);
}

/**
 * Validate an `adapter_ready` event in a collected stream.
 * Checks: event is present, `adapter` matches, `sdkConfig` is a non-empty
 * object, and no known secret patterns leak into the serialized payload.
 */
export function assertAdapterReady(
  events: UnifiedEvent[],
  expectedAdapter: Architecture,
): ContractResult {
  const assertions: ContractAssertion[] = [];
  const readyEvents = events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'adapter_ready' }> => e.type === 'adapter_ready',
  );
  assertions.push(
    assert('has exactly one adapter_ready event', readyEvents.length === 1, `Expected 1 adapter_ready, got ${readyEvents.length}`),
  );

  if (readyEvents.length === 1) {
    const ready = readyEvents[0];
    assertions.push(assert('adapter matches', ready.adapter === expectedAdapter, `Expected adapter="${expectedAdapter}", got "${ready.adapter}"`));
    assertions.push(
      assert(
        'sdkConfig is a non-empty object',
        typeof ready.sdkConfig === 'object' && ready.sdkConfig != null && Object.keys(ready.sdkConfig).length > 0,
        'sdkConfig is empty or not an object',
      ),
    );
    const serialized = JSON.stringify(ready.sdkConfig);
    for (const pattern of SECRET_LEAK_PATTERNS) {
      assertions.push(
        assert(
          `sdkConfig does not leak ${pattern}`,
          !pattern.test(serialized),
          `sdkConfig contains a secret matching ${pattern}`,
        ),
      );
    }

    const nonWarning = events.filter((e) => e.type !== 'warning');
    const firstNonWarningIdx = events.indexOf(nonWarning[0]);
    const readyIdx = events.indexOf(ready);
    assertions.push(
      assert(
        'adapter_ready is the first non-warning event',
        readyIdx === firstNonWarningIdx,
        `adapter_ready at index ${readyIdx}, first non-warning at ${firstNonWarningIdx}`,
      ),
    );
  }

  return buildResult('adapter_ready', events, assertions);
}

/**
 * Validate a multi-turn stream.
 * Checks: ≥2 assistant_message events, ≥2 tool_use events, rawMessages.length ≥ 2.
 */
export async function assertMultiTurn(stream: AsyncIterable<UnifiedEvent>): Promise<ContractResult> {
  const events = await collectEvents(stream);
  const assertions: ContractAssertion[] = [];

  const assistantMessages = events.filter((e) => e.type === 'assistant_message');
  assertions.push(
    assert('has ≥2 assistant_message events', assistantMessages.length >= 2, `Expected ≥2 assistant_message, got ${assistantMessages.length}`),
  );

  const toolUses = events.filter((e) => e.type === 'tool_use');
  assertions.push(assert('has ≥2 tool_use events', toolUses.length >= 2, `Expected ≥2 tool_use, got ${toolUses.length}`));

  const results = events.filter((e) => e.type === 'result');
  assertions.push(assert('has result event', results.length === 1, `Expected 1 result, got ${results.length}`));

  if (results.length === 1) {
    const result = results[0] as Extract<UnifiedEvent, { type: 'result' }>;
    assertions.push(
      assert('result.rawMessages.length ≥ 2', result.rawMessages.length >= 2, `Expected ≥2 rawMessages, got ${result.rawMessages.length}`),
    );
  }

  return buildResult('multi_turn', events, assertions);
}
