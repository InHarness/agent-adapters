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

  // "Terminal" means last non-`flush`, non-`warning`. Both are side-band: `flush` is
  // a boundary marker, and a `warning` may legitimately trail the terminal `result`
  // (the background-task hold raises one from a timer, after the last result — M17).
  // Same precedent as the `adapter_ready is the first non-warning event` check below.
  const terminal = events.filter((e) => e.type !== 'flush' && e.type !== 'warning');
  if (terminal.length > 0) {
    assertions.push(
      assert(
        'result is terminal event',
        terminal[terminal.length - 1].type === 'result',
        `Last non-flush/non-warning event is ${terminal[terminal.length - 1].type}, expected result`,
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
 * Validate that an adapter whose SDK never backgrounds work degrades by
 * **absence** (M17): no `background_task_*` event is ever emitted, and no
 * `result` carries a `backgroundTasks` in-flight signal.
 *
 * Absence is the whole contract — an adapter that instead reported the gap as an
 * `error`, or warned about it on every run, would be just as wrong as one that
 * emitted the events. So this also asserts nothing complained: a consumer that
 * treats warnings as actionable must not be handed one per turn for a capability
 * it never asked for.
 *
 * Operates on already-collected events rather than a stream, so it can be layered
 * onto an existing scenario's events without paying for a second run.
 */
export function assertNoBackgroundTasks(events: UnifiedEvent[]): ContractResult {
  const assertions: ContractAssertion[] = [];

  const emitted = events.filter((e) => e.type.startsWith('background_task_'));
  assertions.push(
    assert(
      'no background_task_* events',
      emitted.length === 0,
      `Expected none, got: ${emitted.map((e) => e.type).join(', ')}`,
    ),
  );

  const signalling = events
    .filter((e): e is Extract<UnifiedEvent, { type: 'result' }> => e.type === 'result')
    .filter((r) => r.backgroundTasks !== undefined);
  assertions.push(
    assert(
      'no result carries a backgroundTasks signal',
      signalling.length === 0,
      `${signalling.length} result event(s) carry backgroundTasks — a consumer would keep ` +
        `iterating for a background_task_completed that never arrives`,
    ),
  );

  const complaints = events.filter(
    (e) => e.type === 'warning' && /background|task/i.test(e.message),
  );
  assertions.push(
    assert(
      'the gap is silent, not warned about',
      complaints.length === 0,
      `Unsupported background tasks must degrade silently, got: ${complaints
        .map((e) => (e as Extract<UnifiedEvent, { type: 'warning' }>).message)
        .join(' | ')}`,
    ),
  );

  return buildResult('no_background_tasks', events, assertions);
}

/**
 * Validate the subagent lifecycle family (M06) over an already-collected run.
 *
 * TWO invariants, asserted TOGETHER on purpose:
 *
 *   1. PAIRING — every `subagent_started` is matched by a `subagent_completed`
 *      before the stream ends, on EVERY terminal path: normal completion, `abort()`,
 *      `timeoutMs`, a background hold-cap expiry. A run-level termination closes what
 *      the adapter opened; it never leaves a started event without its counterpart.
 *   2. AT MOST ONCE — no `subagent_started` is matched by two completions.
 *
 * Splitting them would let the exact defect this exists to catch through: pairing
 * alone passes a termination flush that re-closes subagents which already reported
 * their own completion, and at-most-once alone passes a flush that closes nothing.
 *
 * Also checks that no `subagent_*` event follows the terminal `error`, and that every
 * `status` is inside the declared vocabulary — an adapter that forwards its SDK's own
 * spelling instead of mapping it fails here.
 *
 * Operates on already-collected events rather than a stream, so it can be layered onto
 * an existing scenario's events without paying for a second run. A run with no
 * delegation at all passes vacuously — this asserts the shape of a lifecycle, not that
 * the model chose to delegate.
 */
export function assertSubagentLifecycle(events: UnifiedEvent[]): ContractResult {
  const assertions: ContractAssertion[] = [];

  const started = events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'subagent_started' }> => e.type === 'subagent_started',
  );
  const completed = events.filter(
    (e): e is Extract<UnifiedEvent, { type: 'subagent_completed' }> => e.type === 'subagent_completed',
  );

  const completionsById = new Map<string, number>();
  for (const e of completed) completionsById.set(e.taskId, (completionsById.get(e.taskId) ?? 0) + 1);

  const unclosed = started.filter((e) => !completionsById.has(e.taskId)).map((e) => e.taskId);
  assertions.push(
    assert(
      'every subagent_started is closed before the stream ends',
      unclosed.length === 0,
      `${unclosed.length} subagent(s) left open: ${unclosed.join(', ')} — a consumer pairing ` +
        `started/completed live would wait forever`,
    ),
  );

  const doubled = [...completionsById.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
  assertions.push(
    assert(
      'no subagent_started is closed twice',
      doubled.length === 0,
      `Duplicate completions: ${doubled.join(', ')} — the termination flush must skip ` +
        `subagents that already reported their own end`,
    ),
  );

  const orphanCompletions = [...completionsById.keys()].filter(
    (id) => !started.some((e) => e.taskId === id),
  );
  assertions.push(
    assert(
      'no subagent_completed without its subagent_started',
      orphanCompletions.length === 0,
      `Completions with no matching start: ${orphanCompletions.join(', ')}`,
    ),
  );

  const declared = new Set(['completed', 'failed', 'aborted', 'stopped']);
  const offVocabulary = completed.filter((e) => !declared.has(e.status)).map((e) => e.status);
  assertions.push(
    assert(
      'every status is inside the declared vocabulary',
      offVocabulary.length === 0,
      `Got ${offVocabulary.map((v) => JSON.stringify(v)).join(', ')} — adapters must MAP their ` +
        `SDK's spelling onto 'completed' | 'failed' | 'aborted' | 'stopped', never forward it raw`,
    ),
  );

  // The LAST error, not the first: `error` is not always terminal. claude-code yields a
  // non-terminal `error` when a consumer's `onUserInput` callback throws and keeps
  // iterating; gemini yields non-fatal ones too. Anchoring on the first would fail a
  // perfectly conformant run whose delegation merely came after such an event.
  const terminalErrorIdx = events.map((e) => e.type).lastIndexOf('error');
  const afterError =
    terminalErrorIdx === -1
      ? []
      : events.slice(terminalErrorIdx + 1).filter((e) => e.type.startsWith('subagent_'));
  assertions.push(
    assert(
      'nothing in the subagent family follows the terminal error',
      afterError.length === 0,
      `Got: ${afterError.map((e) => e.type).join(', ')} — the flush belongs BEFORE the error`,
    ),
  );

  return buildResult('subagent_lifecycle', events, assertions);
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
