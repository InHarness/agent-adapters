// Peer-SDK version gate — shared by the four adapters plus MCP integration.
//
// Every peer SDK is an optional peerDependency, loaded lazily so consumers
// who never touch a given adapter never load its SDK (see no-eager-sdk.test.ts).
// This module resolves the *installed* version of a peer SDK and checks it
// against the narrow range each consumer declares support for.
//
// Version resolution deliberately avoids `require.resolve('<pkg>/package.json')`
// as the primary mechanism: several peer SDKs block the `./package.json`
// subpath in their `exports` map, and `@modelcontextprotocol/sdk`'s subpath
// resolves to a decoy nested manifest with no `version` field. `import.meta
// .resolve()` would sidestep the export-condition issues, but this package's
// CJS build target makes it invalid syntax outside real ESM (a build-time
// parse error, not just a runtime one). Instead the primary path walks
// `node_modules/<pkg>/package.json` directly from this module's own location
// — the same directory-walk Node's own resolver uses internally, without
// going through `require`/`import` resolution or `exports` maps at all. That
// covers npm and pnpm (both lay out real — if sometimes symlinked — node_modules
// directories `fs.existsSync` can see).
//
// It does NOT cover Yarn Plug'n'Play, which has no physical `node_modules`
// tree at all — packages resolve through a virtual lookup table only
// `require()`/`import()` understand. For that case there's a second fallback:
// `createRequire(import.meta.url).resolve(pkgName)` (works under PnP, which
// still honors `exports` conditions, and still patches `fs` to transparently
// read the virtual paths `require.resolve` returns), then a plain filesystem
// walk up from the resolved entry for the nearest `package.json` whose `name`
// matches. This still can't resolve an ESM-only package with no `require`/
// `default` export condition (as of writing, `@openai/codex-sdk`) — for that
// residual case, and any other environment-specific resolution gap, version
// resolution intentionally degrades to "undeterminable" rather than silently
// picking a wrong answer; see `PeerSdkVersionCheck` below for how callers are
// expected to treat that outcome differently from a confirmed mismatch.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import semver from 'semver';

const MAX_WALK_DEPTH = 20;

/** Single source of truth for the supported range of each peer SDK — package.json's
 * peerDependencies mirrors this (JSON can't reference it directly); a test asserts they match. */
export const PEER_SDK_RANGES: Record<string, string> = {
  '@anthropic-ai/claude-agent-sdk': '>=0.3.0 <0.4.0',
  '@openai/codex-sdk': '>=0.120.0 <0.121.0',
  '@opencode-ai/sdk': '>=1.4.0 <2.0.0',
  '@google/gemini-cli-core': '>=0.38.0 <0.39.0',
  '@modelcontextprotocol/sdk': '>=1.0.0 <2.0.0',
};

function readVersionField(packageJsonPath: string): { name?: string; version?: string } | undefined {
  if (!fs.existsSync(packageJsonPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string; version?: string };
  } catch {
    return undefined;
  }
}

/** Primary resolution: walk node_modules/<pkg>/package.json upward from this file's own location. */
function resolveViaNodeModulesWalk(pkgName: string): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const pkg = readVersionField(path.join(dir, 'node_modules', pkgName, 'package.json'));
    if (pkg?.version) return pkg.version;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Fallback for layouts the node_modules walk can't see (chiefly Yarn PnP): resolve the
 * package's main entry via require.resolve (honors export conditions, works under PnP),
 * then walk up from there for the nearest package.json with a matching `name`. */
function resolveViaRequireEntry(pkgName: string): string | undefined {
  let entry: string;
  try {
    entry = createRequire(import.meta.url).resolve(pkgName);
  } catch {
    // e.g. an ESM-only package with no "require"/"default" export condition.
    return undefined;
  }
  let dir = path.dirname(entry);
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const pkg = readVersionField(path.join(dir, 'package.json'));
    if (pkg?.name === pkgName && pkg.version) return pkg.version;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const versionCache = new Map<string, string | undefined>();

/** Resolve the installed version of `pkgName`. Memoized — the installed version cannot
 * change within a process's lifetime, so repeat calls (one per execute()/createMcpServer()
 * call) are free after the first. */
export function resolvePeerSdkVersion(pkgName: string): string | undefined {
  if (!versionCache.has(pkgName)) {
    versionCache.set(pkgName, resolveViaNodeModulesWalk(pkgName) ?? resolveViaRequireEntry(pkgName));
  }
  return versionCache.get(pkgName);
}

export interface PeerSdkVersionCheck {
  /**
   * 'ok' — installed version satisfies the range.
   * 'mismatch' — installed version was determined and is outside the range: a hard,
   *   non-suppressible fault (the caller already succeeded at `import()`ing/`require()`ing
   *   this exact package, so we know something is installed — just not a compatible version).
   * 'undeterminable' — the version could not be resolved by any available mechanism, even
   *   though loading the SDK itself already succeeded. This is a resolution/introspection
   *   gap (e.g. an ESM-only package under Yarn PnP), not evidence of an incompatible SDK —
   *   callers should degrade to a warning and proceed, not hard-fail.
   */
  status: 'ok' | 'mismatch' | 'undeterminable';
  /** Human-readable detail, present for 'mismatch' and 'undeterminable'. */
  message?: string;
}

/**
 * Pure semver check, no filesystem access — unit-testable without a real install.
 */
export function evaluatePeerSdkVersion(
  pkgName: string,
  range: string,
  installedVersion: string | undefined,
): PeerSdkVersionCheck {
  if (installedVersion === undefined) {
    return {
      status: 'undeterminable',
      message: `${pkgName}: could not determine installed version (requires ${range})`,
    };
  }
  if (semver.satisfies(installedVersion, range, { includePrerelease: true })) {
    return { status: 'ok' };
  }
  return { status: 'mismatch', message: `${pkgName}: installed ${installedVersion}, requires ${range}` };
}

/** Resolve + check in one call against this package's declared range — what adapters and
 * MCP integration call at init. */
export function checkPeerSdkVersion(pkgName: string): PeerSdkVersionCheck {
  const range = PEER_SDK_RANGES[pkgName];
  return evaluatePeerSdkVersion(pkgName, range, resolvePeerSdkVersion(pkgName));
}
