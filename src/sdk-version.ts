// Peer-SDK version gate — shared by the four adapters plus MCP integration.
//
// Every peer SDK is an optional peerDependency, loaded lazily so consumers
// who never touch a given adapter never load its SDK (see no-eager-sdk.test.ts).
// This module resolves the *installed* version of a peer SDK and checks it
// against the narrow range each consumer declares support for.
//
// Version resolution deliberately avoids `require.resolve()` / `import.meta.resolve()`:
// several peer SDKs block the `./package.json` subpath in their `exports` map
// (so `require.resolve('<pkg>/package.json')` throws), one is ESM-only with
// no `require`/`default` export condition at all (so even resolving its main
// entry via `require.resolve()` throws), and `@modelcontextprotocol/sdk`'s
// `./package.json` subpath resolves to a decoy nested manifest with no
// `version` field. `import.meta.resolve()` would sidestep the export-condition
// issues, but this package's CJS build target makes it invalid syntax outside
// real ESM. Instead this walks `node_modules/<pkg>/package.json` directly from
// this module's own location — the same directory-walk Node's own resolver
// uses internally, without going through `require`/`import` resolution or
// `exports` maps at all.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import semver from 'semver';

const MAX_WALK_DEPTH = 20;

/** Resolve the installed version of `pkgName` by walking node_modules upward from this file. */
export function resolvePeerSdkVersion(pkgName: string): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = path.join(dir, 'node_modules', pkgName, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // malformed package.json — keep walking in case an ancestor has a valid one
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Pure semver check, no filesystem access — unit-testable without a real install.
 * Returns a human-readable mismatch reason, or undefined when in range.
 */
export function versionMismatchReason(
  pkgName: string,
  range: string,
  installedVersion: string | undefined,
): string | undefined {
  if (installedVersion === undefined) {
    return `${pkgName}: could not determine installed version (requires ${range})`;
  }
  if (semver.satisfies(installedVersion, range)) return undefined;
  return `${pkgName}: installed ${installedVersion}, requires ${range}`;
}

/** Resolve + check in one call — what adapters and MCP integration call at init. */
export function checkPeerSdkVersion(pkgName: string, range: string): string | undefined {
  return versionMismatchReason(pkgName, range, resolvePeerSdkVersion(pkgName));
}
