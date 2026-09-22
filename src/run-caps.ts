// The per-unit caps (M01 `toolCallTimeoutMs`, M06 `subagentTimeoutMs`) — shared by
// every adapter, fed the same unified events the idle clock sees.
//
// Each cap bounds ONE unit of work and is moved by a CLOSED VOCABULARY attached to
// that unit, never by stream traffic at large:
//
//  - a tool call is armed at its `tool_use` and disarmed by ITS `tool_result`;
//  - a subagent is armed at its `subagent_started` and re-armed only by its own
//    `subagent_started` (re-entry) and `subagent_progress`.
//
// Expiry is terminal for the whole run: the caller stops the run down the path its
// `timeoutMs` uses and reports the expiry below as the terminal error.

import type { UnifiedEvent, RuntimeExecuteParams } from './types.js';
import { AdapterToolCallTimeoutError, AdapterSubagentTimeoutError, type AdapterError } from './types.js';

export type CapExpiry =
  | { kind: 'tool'; toolName: string; toolUseId: string }
  | { kind: 'subagent'; taskId: string };

export interface RunCaps {
  /** Feed a unified event. Call BEFORE the event is yielded. */
  observe(event: UnifiedEvent): void;
  /**
   * Arm the tool-call cap for a call the unified stream does not show in flight —
   * codex emits `tool_use` and `tool_result` together at `item.completed`, so its
   * call is armed at `item.started` instead. The matching `tool_result` disarms it.
   */
  beginToolCall(toolUseId: string, toolName: string): void;
  /**
   * The consumer answered a `user_input_request`. Once nothing is left unanswered,
   * every call suspended under a request is armed again on its remainder.
   */
  inputAnswered(requestId: string): void;
  dispose(): void;
}

const NOOP_CAPS: RunCaps = {
  observe() {},
  beginToolCall() {},
  inputAnswered() {},
  dispose() {},
};

/**
 * Tool names that open a subagent. Such a call is bounded by `subagentTimeoutMs`
 * alone — the two caps never race on the same object. A spawn under any other name
 * is caught when its `subagent_started` names the call's `toolUseId`.
 */
const SUBAGENT_SPAWN_TOOLS = new Set(['Agent', 'Task']);

const positive = (ms: number | undefined): ms is number => typeof ms === 'number' && ms > 0;

/**
 * Both caps absent → a no-op that never creates a timer: omitting the fields is a
 * guarantee, not a request for a default.
 */
export function createRunCaps(deps: {
  toolCallMs: number | undefined;
  subagentMs: number | undefined;
  onExpire: (expiry: CapExpiry) => void;
}): RunCaps {
  const { onExpire } = deps;
  const toolCallMs = positive(deps.toolCallMs) ? deps.toolCallMs : undefined;
  const subagentMs = positive(deps.subagentMs) ? deps.subagentMs : undefined;
  if (toolCallMs === undefined && subagentMs === undefined) return NOOP_CAPS;

  let done = false;

  // --- tool calls ---
  /** Calls in flight, by toolUseId. `timer` is unset while suspended. */
  const calls = new Map<string, { toolName: string; timer?: ReturnType<typeof setTimeout> }>();
  /** Calls that turned out to open a subagent — never armed again. */
  const exempt = new Set<string>();
  /** Unanswered `user_input_request`s. While non-empty, no tool timer runs. */
  const pendingInputs = new Set<string>();

  const expire = (expiry: CapExpiry) => {
    if (done) return;
    done = true;
    clearAll();
    onExpire(expiry);
  };

  const armCall = (toolUseId: string) => {
    const call = calls.get(toolUseId);
    if (!call || toolCallMs === undefined || done) return;
    if (call.timer) clearTimeout(call.timer);
    call.timer = setTimeout(
      () => expire({ kind: 'tool', toolName: call.toolName, toolUseId }),
      toolCallMs,
    );
  };

  const startCall = (toolUseId: string, toolName: string) => {
    if (toolCallMs === undefined || exempt.has(toolUseId) || calls.has(toolUseId)) return;
    if (SUBAGENT_SPAWN_TOOLS.has(toolName)) {
      exempt.add(toolUseId);
      return;
    }
    calls.set(toolUseId, { toolName });
    // A human is slow, not the call: nothing arms while a request is unanswered.
    if (pendingInputs.size === 0) armCall(toolUseId);
  };

  const dropCall = (toolUseId: string) => {
    const call = calls.get(toolUseId);
    if (!call) return;
    if (call.timer) clearTimeout(call.timer);
    calls.delete(toolUseId);
  };

  const suspendCalls = () => {
    for (const call of calls.values()) {
      if (call.timer) clearTimeout(call.timer);
      call.timer = undefined;
    }
  };

  // --- subagents ---
  const subagents = new Map<string, ReturnType<typeof setTimeout>>();

  const armSubagent = (taskId: string) => {
    if (subagentMs === undefined || done) return;
    const prev = subagents.get(taskId);
    if (prev) clearTimeout(prev);
    subagents.set(
      taskId,
      setTimeout(() => expire({ kind: 'subagent', taskId }), subagentMs),
    );
  };

  const dropSubagent = (taskId: string) => {
    const timer = subagents.get(taskId);
    if (timer) clearTimeout(timer);
    subagents.delete(taskId);
  };

  function clearAll() {
    for (const id of [...calls.keys()]) dropCall(id);
    for (const id of [...subagents.keys()]) dropSubagent(id);
  }

  return {
    observe(event) {
      if (done) return;
      switch (event.type) {
        case 'tool_use':
          startCall(event.toolUseId, event.toolName);
          break;
        case 'tool_result':
          dropCall(event.toolUseId);
          break;
        case 'subagent_started':
          // The call that opened it belongs to the subagent cap from here on.
          exempt.add(event.toolUseId);
          dropCall(event.toolUseId);
          armSubagent(event.taskId);
          break;
        case 'subagent_progress':
          // Only a subagent already open is re-armed: progress is its own
          // lifecycle, not a way to open one.
          if (subagents.has(event.taskId)) armSubagent(event.taskId);
          break;
        case 'subagent_completed':
          dropSubagent(event.taskId);
          break;
        case 'user_input_request':
          pendingInputs.add(event.request.requestId);
          suspendCalls();
          break;
        case 'result':
          // A turn has ended, so no tool call of it is still in flight — the same
          // rule the idle clock applies. Subagents legitimately outlive a turn.
          for (const id of [...calls.keys()]) dropCall(id);
          break;
      }
    },
    beginToolCall(toolUseId, toolName) {
      if (!done) startCall(toolUseId, toolName);
    },
    inputAnswered(requestId) {
      if (!pendingInputs.delete(requestId) || pendingInputs.size > 0 || done) return;
      for (const id of calls.keys()) armCall(id);
    },
    dispose() {
      done = true;
      clearAll();
    },
  };
}

/** The terminal error a cap expiry reports — one place, so every adapter says the same. */
export function capExpiryError(
  adapter: string,
  expiry: CapExpiry,
  params: Pick<RuntimeExecuteParams, 'toolCallTimeoutMs' | 'subagentTimeoutMs'>,
): AdapterError {
  return expiry.kind === 'tool'
    ? new AdapterToolCallTimeoutError(adapter, params.toolCallTimeoutMs!, expiry.toolName, expiry.toolUseId)
    : new AdapterSubagentTimeoutError(adapter, params.subagentTimeoutMs!, expiry.taskId);
}
