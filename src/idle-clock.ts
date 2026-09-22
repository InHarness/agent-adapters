// The idle clock (M01 `idleTimeoutMs`) — shared by every adapter.
//
// A run is at every moment in one of two states: nothing outstanding (the engine owes
// the consumer something, so silence is a stall) or work in flight (something
// legitimate is pending, so silence is healthy). The clock advances ONLY in the first
// state and stops — without resetting — in the second, so the budget is cumulative
// idle time across the run.
//
// This is deliberately NOT a "re-arm on the last sign of life" timer: ordinary events
// never touch it. Only transitions of the outstanding set start or stop it.

import type { UnifiedEvent } from './types.js';
import { createRunCaps, type RunCaps, type CapExpiry } from './run-caps.js';

export interface IdleClock {
  /** Derive outstanding work from a unified event. Call BEFORE the event is yielded. */
  observe(event: UnifiedEvent): void;
  /**
   * Mark work the unified stream cannot show as outstanding: a pending `onUserInput`
   * answer, a codex item between `item.started` and `item.completed`, a nested turn.
   */
  begin(key: string): void;
  end(key: string): void;
  dispose(): void;
}

const NOOP_CLOCK: IdleClock = {
  observe() {},
  begin() {},
  end() {},
  dispose() {},
};

/**
 * `idleMs` absent (or not a positive number) → a no-op clock that never creates a
 * timer: omitting `idleTimeoutMs` means there is no idle clock at all.
 */
export function createIdleClock(deps: {
  idleMs: number | undefined;
  onExpire: () => void;
  now?: () => number;
}): IdleClock {
  const { idleMs, onExpire } = deps;
  if (typeof idleMs !== 'number' || !(idleMs > 0)) return NOOP_CLOCK;
  const now = deps.now ?? Date.now;

  const outstanding = new Set<string>();
  let remainingMs = idleMs;
  let runningSince: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  const start = () => {
    if (done || runningSince !== undefined) return;
    runningSince = now();
    timer = setTimeout(() => {
      timer = undefined;
      runningSince = undefined;
      remainingMs = 0;
      done = true;
      onExpire();
    }, remainingMs);
  };

  const stop = () => {
    if (runningSince === undefined) return;
    remainingMs = Math.max(0, remainingMs - (now() - runningSince));
    runningSince = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const sync = () => (outstanding.size === 0 ? start() : stop());

  const add = (key: string) => {
    outstanding.add(key);
    sync();
  };
  const remove = (key: string) => {
    if (outstanding.delete(key)) sync();
  };

  // The run starts with nothing outstanding: the engine owes the consumer a response.
  start();

  return {
    observe(event) {
      switch (event.type) {
        case 'tool_use':
          add(`tool:${event.toolUseId}`);
          break;
        case 'tool_result':
          remove(`tool:${event.toolUseId}`);
          break;
        case 'subagent_started':
          add(`sub:${event.taskId}`);
          break;
        case 'subagent_completed':
          remove(`sub:${event.taskId}`);
          break;
        case 'background_task_started':
          add(`bg:${event.taskId}`);
          break;
        case 'background_task_completed':
          remove(`bg:${event.taskId}`);
          break;
        case 'user_input_request':
          // Outstanding from the moment it exists — not from when the consumer pulls
          // the next event and the adapter starts awaiting the answer. The adapter
          // ends this same key (`uin:<requestId>`) once the answer is in.
          add(`uin:${event.request.requestId}`);
          break;
        case 'result': {
          // A turn has ended, so no tool call of it is still in flight. Drop tool
          // keys whose result was never emitted, so they cannot pause the clock
          // forever. Subagents and background tasks legitimately outlive a turn.
          let changed = false;
          for (const key of outstanding) {
            if (key.startsWith('tool:')) changed = outstanding.delete(key) || changed;
          }
          if (changed) sync();
          break;
        }
      }
    },
    begin: add,
    end: remove,
    dispose() {
      done = true;
      stop();
    },
  };
}

/**
 * A run's idle clock plus whether it expired, shared between an adapter's public
 * `execute()` (which feeds the clock every yielded event) and the session generator
 * behind it (which arms the clock and reports the expiry).
 */
export interface IdleHandle {
  clock: IdleClock;
  expired: boolean;
  /** The per-unit caps (`toolCallTimeoutMs`, `subagentTimeoutMs`), fed the same events. */
  caps: RunCaps;
  /** Set when a per-unit cap expired — carried so every exit reports the same reason. */
  capExpired: CapExpiry | null;
}

export function createIdleHandle(): IdleHandle {
  return {
    clock: NOOP_CLOCK,
    expired: false,
    caps: createRunCaps({ toolCallMs: undefined, subagentMs: undefined, onExpire: () => {} }),
    capExpired: null,
  };
}

/** Key held while the consumer has an event in hand — see {@link observeAndYield}. */
const CONSUMER_KEY = 'consumer';

/**
 * Feed `event` to the clock, then yield it with the clock stopped for as long as the
 * consumer holds it. The engine is not idle while the consumer is still busy with
 * what it already produced (a slow DB write, a UI round trip): that time is the
 * consumer's, and billing it as a stall would kill runs whose engine is healthy.
 *
 * `endsRun` — this event is the run's last word (a one-shot adapter's `result`):
 * the clock is disposed before the yield, so nothing after it (the consumer's
 * handling, engine shutdown) can turn a finished run into an idle expiry.
 */
export async function* observeAndYield(
  clock: IdleClock,
  event: UnifiedEvent,
  endsRun = false,
): AsyncGenerator<UnifiedEvent> {
  clock.observe(event);
  if (endsRun) {
    clock.dispose();
    yield event;
    return;
  }
  clock.begin(CONSUMER_KEY);
  try {
    yield event;
  } finally {
    clock.end(CONSUMER_KEY);
  }
}

/**
 * Pass `source` through, feeding each event to the handle's clock BEFORE it is
 * yielded: a `tool_use` or `subagent_started` makes work outstanding the moment it
 * exists, not when the consumer gets round to reading it. The clock is stopped while
 * the consumer holds an event, and disposed at the run's `result` — these adapters
 * are one-shot, so a `result` is their last word. The handle's per-unit caps see
 * the same events at the same point. Disposes both on exit.
 */
export async function* observeIdle(
  handle: IdleHandle,
  source: AsyncIterable<UnifiedEvent>,
): AsyncGenerator<UnifiedEvent> {
  try {
    for await (const event of source) {
      handle.caps.observe(event);
      yield* observeAndYield(handle.clock, event, event.type === 'result');
    }
  } finally {
    handle.clock.dispose();
    handle.caps.dispose();
  }
}
