// Self-heal an unusable `process.stdin` before the claude-code SDK loads.
//
// Under Phusion Passenger / CloudLinux CageFS (and similar sandboxed hosts),
// fd 0 is already owned and wired by the process manager. When something
// imports the SDK, Node builds the ESM facade of a builtin, which touches the
// lazy `process.stdin` getter → Node constructs `new Socket` on fd 0 → libuv
// returns EEXIST. That surfaces as `AdapterInitError: open EEXIST`
// (syscall:"open", no path) on every request. It is NOT a filesystem error.
//
// The SDK never reads the parent's `process.stdin` (it spawns the child claude
// process with its own stdio pipes), so replacing `process.stdin` with a benign
// empty stream is safe and does not affect streaming input.

import { Readable } from 'node:stream';

/** Minimal shape we mutate — `process` satisfies it; tests pass a fake. */
export interface StdinHost {
  stdin: NodeJS.ReadableStream;
}

function makeEmptyStdin(): Readable {
  // Emits 'end' on first read, yields no data — i.e. "stdin closed / no input".
  return new Readable({
    read() {
      this.push(null);
    },
  });
}

/**
 * Detects an unusable `process.stdin` (throws on access — e.g. EEXIST on fd 0
 * under Phusion Passenger / CloudLinux CageFS) and replaces it with a benign
 * empty stream. Idempotent: a no-op when stdin is healthy or already replaced.
 *
 * NOTE: only protects code that runs AFTER this call. If the host application
 * touches `process.stdin` at boot (a logger TTY probe, `readline`, etc.), call
 * this at process entry — the library cannot retroactively fix an
 * already-thrown lazy getter.
 *
 * @returns `true` only on the call that actually performed the repair.
 */
export function ensureUsableStdin(host: StdinHost = process): boolean {
  try {
    // Probe. On a healthy host this constructs (and caches) the real stream; on
    // Passenger/sandbox hosts the lazy getter throws.
    void host.stdin;
    return false; // usable (real or already-replaced) → no-op
  } catch (err) {
    Object.defineProperty(host, 'stdin', {
      value: makeEmptyStdin(),
      configurable: true,
      writable: true,
      enumerable: true,
    });
    const code = (err as { code?: string })?.code ?? 'unknown';
    const syscall = (err as { syscall?: string })?.syscall ?? '';
    console.warn(
      `[agent-adapters] claude-code: repaired unusable process.stdin ` +
        `(${syscall} ${code}; Passenger/sandbox fd 0)`,
    );
    return true;
  }
}
