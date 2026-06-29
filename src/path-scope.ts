// Filesystem path scoping — engine-neutral declaration of which directories an
// agent's tools may touch, plus the runtime-confirmable gate-strength signal.
//
// Two deliberately-separate layers:
//   1. `architectureCapabilities(arch).pathScope` (src/capabilities.ts) — a STATIC
//      flat bool: does this adapter honor `allowedPaths`/`disallowedPaths` at all?
//   2. `probePathScope(arch, params)` (here) — the RUNTIME signal: given this host
//      and config, what enforcement strength ('hard' | 'soft' | 'none') will the
//      run actually get? A consumer building a real security sandbox MUST confirm
//      this BEFORE dispatching work — a post-hoc `warning` is insufficient, and a
//      "hard-capable" capability bool is a static fact, NOT a runtime guarantee
//      that hard (OS-syscall) enforcement is active on this host.
//
// Strength meaning:
//   - 'hard' = OS-syscall enforcement (kernel blocks out-of-scope FS access:
//     bubblewrap on Linux / seatbelt on macOS, or codex's OS sandbox).
//   - 'soft' = model-visible permission rules only (the agent is told not to, but
//     nothing at the OS level stops a subprocess).
//   - 'none' = the adapter has no native primitive; the run proceeds unscoped.
//
// Declared-scope precedence is `disallowedPaths` > `allowedPaths` > the implicit
// base (`cwd`). Scope is read+write combined (no read/write split yet — a noted
// future extension, along with glob support). Relative entries are normalized
// against `cwd`, not rejected. Both fields absent/empty is a no-op (identical to
// pre-0.0.2 behavior). Path-scope composes additively with plan mode — both only
// ever narrow access.

import { accessSync, constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { RuntimeExecuteParams } from './types.js';

export type PathScopeStrength = 'hard' | 'soft' | 'none';

/**
 * The runtime-resolved path-scope for a single run. Surfaced two ways: returned
 * by {@link probePathScope} (synchronous, callable BEFORE dispatch) and mirrored
 * on the `adapter_ready` event for in-stream observability.
 */
export interface ResolvedPathScope {
  /** The consumer passed at least one non-empty `allowedPaths`/`disallowedPaths`. */
  requested: boolean;
  /** `allowedPaths` normalized to absolute paths (relative entries resolved vs `cwd`). */
  allowed: string[];
  /** `disallowedPaths` normalized to absolute paths. */
  disallowed: string[];
  /** Enforcement strength this run will actually get on this host. */
  strength: PathScopeStrength;
  /**
   * Entries this adapter cannot enforce despite honoring path-scope — e.g. codex's
   * allow-list-only OS sandbox cannot enforce `disallowedPaths` carve-outs. Surfaced
   * (not silently dropped) so consumers don't assume an unenforced deny.
   */
  unenforceable: string[];
}

/**
 * Opt-in OS-sandbox config for claude-code, read from
 * `architectureConfig.claude_sandbox`. When `enabled` and the host has an OS
 * sandbox (bubblewrap/seatbelt), claude-code flips from the soft default to
 * OS-syscall enforcement, merging `filesystem` rules into the same rule set.
 */
export interface ClaudeSandboxConfig {
  enabled?: boolean;
  filesystem?: {
    allowWrite?: string[];
    denyWrite?: string[];
    allowRead?: string[];
    denyRead?: string[];
  };
}

/** Read & shape-check `architectureConfig.claude_sandbox`. */
export function getClaudeSandboxConfig(
  config: Record<string, unknown> | undefined,
): ClaudeSandboxConfig | undefined {
  const raw = config?.claude_sandbox;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as ClaudeSandboxConfig;
  return undefined;
}

/** Resolve relative entries against `cwd`; pass absolute paths through unchanged. */
export function normalizePaths(paths: string[] | undefined, cwd: string): string[] {
  if (!paths || paths.length === 0) return [];
  return paths.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)));
}

/** Whether the consumer declared any path-scope (either field non-empty). */
export function isPathScopeRequested(
  params: Pick<RuntimeExecuteParams, 'allowedPaths' | 'disallowedPaths'>,
): boolean {
  return Boolean(params.allowedPaths?.length || params.disallowedPaths?.length);
}

function isExecutableOnPath(binary: string): boolean {
  const dirs = (process.env.PATH ?? '').split(':');
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      accessSync(resolve(dir, binary), constants.X_OK);
      return true;
    } catch {
      // not here — keep looking
    }
  }
  return false;
}

/**
 * Probe whether this host can provide OS-syscall sandboxing: seatbelt on macOS
 * (`sandbox-exec`), bubblewrap on Linux (`bwrap`). Synchronous and host-local so a
 * consumer can call it before dispatching work. Returns false on every other
 * platform.
 */
export function detectOsSandbox(): boolean {
  if (process.platform === 'darwin') {
    try {
      accessSync('/usr/bin/sandbox-exec', constants.X_OK);
      return true;
    } catch {
      return isExecutableOnPath('sandbox-exec');
    }
  }
  if (process.platform === 'linux') {
    return isExecutableOnPath('bwrap');
  }
  return false;
}

/**
 * Resolve the path-scope a run will actually get, synchronously and before any SDK
 * call. This is the runtime gate-strength signal — distinct from the static
 * `architectureCapabilities(arch).pathScope` bool. Adapters call this internally
 * (and emit the result on `adapter_ready`); consumers building a real sandbox
 * should call it themselves to confirm `strength === 'hard'` before dispatch.
 */
export function probePathScope(
  architecture: string,
  params: Pick<
    RuntimeExecuteParams,
    'allowedPaths' | 'disallowedPaths' | 'cwd' | 'architectureConfig'
  >,
): ResolvedPathScope {
  const cwd = params.cwd ?? process.cwd();
  const allowed = normalizePaths(params.allowedPaths, cwd);
  const disallowed = normalizePaths(params.disallowedPaths, cwd);
  const requested = allowed.length > 0 || disallowed.length > 0;

  const base: ResolvedPathScope = { requested, allowed, disallowed, strength: 'none', unenforceable: [] };
  if (!requested) return base;

  switch (architecture) {
    case 'claude-code':
    case 'claude-code-ollama':
    case 'claude-code-minimax': {
      const sandbox = getClaudeSandboxConfig(params.architectureConfig);
      const hard = sandbox?.enabled === true && detectOsSandbox();
      return { ...base, strength: hard ? 'hard' : 'soft' };
    }
    case 'codex':
      // Codex's OS sandbox is allow-list-only — `disallowedPaths` carve-outs
      // inside an allowed root cannot be enforced. Surface, don't drop.
      return { ...base, strength: 'hard', unenforceable: disallowed };
    case 'gemini':
      // Soft gate via Config.includeDirectories (model-visible workspace, NOT
      // OS-enforced). `allowedPaths` are expressible; gemini has no construct-time
      // deny primitive, so `disallowedPaths` carve-outs are surfaced as unenforceable.
      return { ...base, strength: 'soft', unenforceable: disallowed };
    case 'opencode':
    case 'opencode-openrouter':
    default:
      // No native primitive — runs unscoped (a warning is emitted by the adapter).
      return base;
  }
}
