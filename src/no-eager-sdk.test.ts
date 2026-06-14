// Regression guard: the main package entry must NOT statically import any of the
// optional peer-dependency SDKs. They are optional (consumers may not have them
// installed), so each adapter loads its SDK lazily via `await import()` inside
// execute(). A static `import ... from "<sdk>"` anywhere in the eager module
// graph reachable from dist/index.js re-introduces the "Cannot find package"
// load-time crash this test exists to prevent.
//
// Operates on the built output. Skips when dist/ is absent so a bare `npm test`
// without a prior `npm run build` doesn't fail — run `npm run build` first.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '..', 'dist', 'index.js');

const FORBIDDEN = [
  '@anthropic-ai/claude-agent-sdk',
  '@openai/codex-sdk',
  '@opencode-ai/sdk',
  '@google/gemini-cli-core',
  '@modelcontextprotocol/sdk',
];

/**
 * Static import/export specifiers in a chunk of bundled ESM. Dynamic
 * `import("x")` is intentionally NOT matched (no `from`, and `import(` has no
 * quote immediately after `import`), so lazy SDK loads are correctly ignored.
 */
function staticSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const fromRe = /\bfrom\s*["']([^"']+)["']/g; // import/export ... from "x"
  const bareRe = /\bimport\s*["']([^"']+)["']/g; // bare import "x"
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(code))) specs.push(m[1]);
  while ((m = bareRe.exec(code))) specs.push(m[1]);
  return specs;
}

/** BFS the static-import graph from `entry`, collecting non-relative specifiers. */
function reachableExternals(entryFile: string): Set<string> {
  const externals = new Set<string>();
  const seen = new Set<string>();
  const queue = [entryFile];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('./') || spec.startsWith('../')) {
        queue.push(resolve(dirname(file), spec));
      } else {
        externals.add(spec);
      }
    }
  }
  return externals;
}

describe('no eager optional-SDK imports', () => {
  it.skipIf(!existsSync(entry))(
    'main entry does not statically import optional peer SDKs',
    () => {
      const externals = reachableExternals(entry);
      const leaked = FORBIDDEN.filter((pkg) =>
        [...externals].some((e) => e === pkg || e.startsWith(`${pkg}/`)),
      );
      expect(
        leaked,
        `dist/index.js eagerly imports optional SDK(s): ${leaked.join(', ')}`,
      ).toEqual([]);
    },
  );
});
