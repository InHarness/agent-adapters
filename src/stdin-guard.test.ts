// Unit tests for the stdin guard. Uses dependency injection (a fake host) so we
// never mutate the real global `process.stdin` — which would be unsafe under
// vitest's parallel workers and would construct the runner's real fd-0 stream.

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { ensureUsableStdin, type StdinHost } from './stdin-guard.js';

/** A host whose `stdin` getter throws like Passenger's fd-0 EEXIST. */
const brokenHost = (): StdinHost =>
  ({
    get stdin(): never {
      throw Object.assign(new Error('open EEXIST'), { code: 'EEXIST', syscall: 'open' });
    },
  }) as unknown as StdinHost;

describe('ensureUsableStdin', () => {
  it('repairs a throwing stdin and returns true', () => {
    const host = brokenHost();
    expect(ensureUsableStdin(host)).toBe(true);
    expect(host.stdin).toBeInstanceOf(Readable); // accessing it no longer throws
  });

  it('installs a benign empty stream that ends without data', async () => {
    const host = brokenHost();
    ensureUsableStdin(host);

    const chunks: unknown[] = [];
    for await (const chunk of host.stdin as Readable) chunks.push(chunk); // resolves => 'end' fired
    expect(chunks).toEqual([]);
  });

  it('is idempotent: a second call no-ops and returns false', () => {
    const host = brokenHost();
    expect(ensureUsableStdin(host)).toBe(true);
    expect(ensureUsableStdin(host)).toBe(false); // now usable → no-op
  });

  it('leaves a healthy stdin untouched and returns false', () => {
    const real = Readable.from([]);
    const host = { stdin: real } as unknown as StdinHost;
    expect(ensureUsableStdin(host)).toBe(false);
    expect(host.stdin).toBe(real);
  });
});
