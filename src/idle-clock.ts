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
}

export function createIdleHandle(): IdleHandle {
  return { clock: NOOP_CLOCK, expired: false };
}

/**
 * Pass `source` through, feeding each event to the handle's clock BEFORE it is
 * yielded: a `tool_use` or `subagent_started` makes work outstanding the moment it
 * exists, not when the consumer gets round to reading it. Disposes the clock on exit.
 */
export async function* observeIdle(
  handle: IdleHandle,
  source: AsyncIterable<UnifiedEvent>,
): AsyncGenerator<UnifiedEvent> {
  try {
    for await (const event of source) {
      handle.clock.observe(event);
      yield event;
    }
  } finally {
    handle.clock.dispose();
  }
}
