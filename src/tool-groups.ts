// Built-in tool gating (M18) — engine-neutral declaration of which CLASSES of
// built-in capability a run may not use, plus the runtime-confirmable
// gate-strength signal.
//
// Two deliberately-separate layers, mirroring src/path-scope.ts:
//   1. `architectureCapabilities(arch).toolGating` (src/capabilities.ts) — a
//      STATIC flat bool: does this adapter have ANY gating mechanism? It says
//      nothing about coverage or strength, and is `true` on an adapter that can
//      enforce some groups but not others (codex).
//   2. `probeToolGating(arch, groups)` (here) — the per-group RUNTIME signal:
//      is this group enforceable at all, at what strength, and through which
//      documented holes? Synchronous and pre-dispatch ON PURPOSE: a startup
//      *event* arrives too late for a consumer to decline the run.
//
// THIS MODULE IS FAIL-CLOSED, and that is the opposite posture from M15
// path-scoping. Path-scope warns and continues; a requested group with no
// primitive on the target adapter REFUSES the run before anything is dispatched.
// Silently dropping an unrecognized entry from a security policy would enforce
// less than was asked for, so an unknown group string refuses too.
//
// Delivery of that refusal is an `{ type: 'error', error, phase: 'init' }` event
// yielded at the first `next()`, NOT a thrown exception: M01/M13 hold the
// invariant that an adapter never propagates a throw out of its async iterator
// ("a `result` then return, or an `error`" is the whole of the stream contract).
// "Pre-dispatch" describes the MOMENT OF DECISION — nothing reaches the SDK —
// not the delivery channel. The synchronous `probeToolGating` below is the
// channel a consumer uses to decline before it ever calls `execute()`.
//
// Deny-shaped for the consumer, allow-shaped inside the adapter: wherever the
// SDK supports it an adapter derives a RESIDUAL ALLOW-LIST from the non-denied
// groups and uses deny entries only as a backstop, so a built-in this library
// has never heard of is blocked rather than allowed. An adapter with no
// allow-list primitive (gemini) is fail-open on future built-ins by
// construction and is therefore capped at 'soft'.
//
// Scope: BUILT-INS ONLY. An MCP tool is never denied by group — MCP tool names
// are opaque and cannot be reliably classified, and guessing wrong in either
// direction is worse than declining. A run with every group denied can still
// call every MCP tool it was given; the consumer's remedy is to withhold the
// server.

import type { RuntimeExecuteParams } from './types.js';
import { AdapterToolPolicyError } from './types.js';

/**
 * A class of built-in tool capability. An adapter maps its SDK's tool
 * identifiers onto these — never the reverse.
 *
 * - `shell` — executing an OS command in any form, INCLUDING background-process
 *   inspection and any general-purpose code-execution tool (a JS REPL counts).
 * - `file-read` — reading, listing or searching files.
 * - `file-write` — creating, editing or deleting files, and persisting memory.
 * - `web` — fetching URLs and web search.
 */
export type ToolGroup = 'shell' | 'file-read' | 'file-write' | 'web';

/** The complete group vocabulary. Anything outside it refuses the run. */
export const TOOL_GROUPS: readonly ToolGroup[] = ['shell', 'file-read', 'file-write', 'web'];

/**
 * Enforcement strength for one group on one adapter.
 *
 * - `hard` — enforced OUTSIDE the model: an OS sandbox posture, or a
 *   server-side refusal before the tool executes.
 * - `soft` — the tool is removed from the model's context/catalog. A
 *   model-behaviour gate, not a sandbox.
 * - `none` — no primitive at all; requesting this group refuses the run.
 */
export type ToolGatingStrength = 'hard' | 'soft' | 'none';

/**
 * The plan-mode preset — M01's preset-registry convention in its first
 * instance: a named, library-built constant that desugars a coarse consumer
 * flag into the fine-grained contract.
 *
 * `planMode: true` IS these groups. It is not a weaker mode: it produces
 * identical deny-groups and inherits the fail-closed posture, so an adapter
 * that used to ignore plan mode with a console warning now refuses the run.
 * The documented opt-out is an explicit empty `disallowedToolGroups`.
 *
 * Reads and web stay available — plan mode must still be able to research.
 */
export const PLAN_MODE_DENY_GROUPS: readonly ToolGroup[] = ['file-write', 'shell'];

/** One record per requested group, returned by {@link probeToolGating}. */
export interface ToolGatingReport {
  group: ToolGroup;
  /** False → requesting this group refuses the run on this adapter. */
  enforceable: boolean;
  strength: ToolGatingStrength;
  /**
   * Canon list of documented bypasses. A group with a documented escape surface
   * is NEVER reported `hard` — the probe reports `soft` and names the surface.
   */
  escapeSurfaces: string[];
}

/** The per-adapter matrix backing both the probe and the pre-dispatch refusal,
 *  so the two can never disagree. */
type GroupMatrix = Record<ToolGroup, { strength: ToolGatingStrength; escapeSurfaces: string[] }>;

const NONE = { strength: 'none' as const, escapeSurfaces: [] };

// claude-code: the deny rides the built-in allow-list on `options.tools` plus
// `disallowedTools` as backstop — never the shared `permissions.allow`/`deny`
// surface, which M15 path-scope and auto-approval also write and which could
// therefore re-widen a deny. Removing a tool from the model's catalog is a
// model-behaviour gate, so every group here is 'soft' by construction.
const CLAUDE_CODE_MATRIX: GroupMatrix = {
  shell: {
    strength: 'soft',
    escapeSurfaces: [
      'a spawned subagent does not natively inherit the parent run\'s tool denies; the adapter propagates the deny into every subagent definition it sends, but a built-in subagent type the SDK spawns on its own is outside that reach',
    ],
  },
  'file-read': {
    strength: 'soft',
    escapeSurfaces: [
      'with `shell` still allowed, native builds can serve search and file reads through the shell, so this deny is bypassable — deny `shell` too for a boundary',
    ],
  },
  'file-write': { strength: 'soft', escapeSurfaces: [] },
  web: {
    strength: 'soft',
    escapeSurfaces: [
      'a built-in MCP web-fetch identifier the deny mechanism does not reliably filter',
    ],
  },
};

// codex: `ThreadOptions` has a whole-run `sandboxMode` and a web-search toggle,
// and nothing else. There is no shell toggle and no per-tool primitive; the
// permission-profile family that could express read-denial is incompatible with
// the sandbox posture and is unreachable through config passthrough (nested
// keys are flattened into dotted paths by raw concatenation without quoting).
// So `shell` and `file-read` REFUSE — the fail-closed exception to codex's
// usual warn-and-degrade.
const CODEX_MATRIX: GroupMatrix = {
  shell: NONE,
  'file-read': NONE,
  // 'read-only' is an OS sandbox posture: writes are blocked even from the
  // shell, which is why this is hard rather than soft. It is HARD BUT COARSE —
  // reads and the shell stay live — which the porous-combination warning says
  // out loud on every run that denies file-write without denying shell.
  'file-write': { strength: 'hard', escapeSurfaces: [] },
  web: { strength: 'hard', escapeSurfaces: [] },
};

// opencode: the strongest of the four. Server-side `permission` buckets with a
// '*' wildcard default; a denied tool is REFUSED BEFORE EXECUTION, not prompted.
// The server's permission schema ends in a catch-all, so an unknown or mistyped
// bucket name is accepted and silently ignored with no validation error — which
// is why `hard` may only be claimed for buckets confirmed against the running
// server version (the SDK does not bundle the server, so the pin, the resolved
// SDK and the installed binary can be three different versions). Every bucket
// this adapter writes is confirmed against opencode 1.4.6, hence no escape
// surface here; see the bucket table in src/adapters/opencode.ts.
const OPENCODE_MATRIX: GroupMatrix = {
  shell: { strength: 'hard', escapeSurfaces: [] },
  'file-read': { strength: 'hard', escapeSurfaces: [] },
  'file-write': { strength: 'hard', escapeSurfaces: [] },
  web: { strength: 'hard', escapeSurfaces: [] },
};

// gemini: exclusion happens when the tool registry is built, BEFORE the
// approval policy runs — so a denied tool is never registered, never reaches
// the model, and an auto-approving `yolo` mode cannot bypass it (there is
// nothing registered to approve). But `excludeTools` is deny-only with no
// allow-list counterpart, so gemini cannot satisfy the residual-allow-list
// invariant: a built-in added by a peer-SDK bump stays available until the
// group mapping names it. That caps every group at 'soft'.
const GEMINI_DENY_ONLY =
  '`excludeTools` is deny-only with no allow-list counterpart, so a built-in added by a peer-SDK bump stays available until the group mapping names it';
const GEMINI_MATRIX: GroupMatrix = {
  shell: { strength: 'soft', escapeSurfaces: [GEMINI_DENY_ONLY] },
  'file-read': { strength: 'soft', escapeSurfaces: [GEMINI_DENY_ONLY] },
  'file-write': { strength: 'soft', escapeSurfaces: [GEMINI_DENY_ONLY] },
  web: { strength: 'soft', escapeSurfaces: [GEMINI_DENY_ONLY] },
};

/** No known primitive — every group refuses. The safe default for a custom
 *  architecture the library has never heard of. */
const UNKNOWN_MATRIX: GroupMatrix = {
  shell: NONE,
  'file-read': NONE,
  'file-write': NONE,
  web: NONE,
};

function matrixFor(architecture: string): GroupMatrix {
  switch (architecture) {
    case 'claude-code':
    case 'claude-code-ollama':
    case 'claude-code-minimax':
      return CLAUDE_CODE_MATRIX;
    case 'codex':
      return CODEX_MATRIX;
    case 'opencode':
    case 'opencode-openrouter':
      return OPENCODE_MATRIX;
    case 'gemini':
      return GEMINI_MATRIX;
    default:
      return UNKNOWN_MATRIX;
  }
}

function isToolGroup(value: unknown): value is ToolGroup {
  return typeof value === 'string' && (TOOL_GROUPS as readonly string[]).includes(value);
}

/** What {@link resolveDeniedGroups} computed for a run. */
export interface ResolvedToolGroups {
  /** Preset-derived ∪ explicitly requested, deduplicated, in `TOOL_GROUPS` order. */
  groups: ToolGroup[];
  /** Entries that are not a known group. Non-empty ⇒ the run is refused. */
  unknown: string[];
  /** The consumer asked for gating (via the field or the plan-mode preset). */
  requested: boolean;
}

/**
 * Union the plan-mode preset with the explicitly requested groups.
 *
 * Deny-only and ADDITIVE: a preset can never be weakened by omitting its groups
 * from `disallowedToolGroups`. Duplicates collapse and order is insignificant —
 * naming the same group twice applies it once.
 *
 * Absent field or `[]` with no preset → today's behaviour byte for byte.
 */
export function resolveDeniedGroups(
  params: Pick<RuntimeExecuteParams, 'disallowedToolGroups' | 'planMode'>,
): ResolvedToolGroups {
  const explicit = params.disallowedToolGroups ?? [];
  const preset = params.planMode ? PLAN_MODE_DENY_GROUPS : [];
  const requested = explicit.length > 0 || preset.length > 0;

  const seen = new Set<ToolGroup>();
  const unknown: string[] = [];
  for (const entry of [...preset, ...explicit]) {
    if (isToolGroup(entry)) seen.add(entry);
    else if (!unknown.includes(String(entry))) unknown.push(String(entry));
  }

  // Stable `TOOL_GROUPS` order so the resolved set is comparable by value —
  // session-resume's immutability check compares these structurally.
  return { groups: TOOL_GROUPS.filter((g) => seen.has(g)), unknown, requested };
}

/**
 * Resolve, synchronously and BEFORE dispatch, what each requested group will
 * actually get on this adapter — so a consumer can decline the run rather than
 * learn from a post-hoc warning.
 *
 * Returns one record per requested group, in the order given (duplicates are
 * collapsed). Unknown group strings are not reported here; they are a refusal,
 * surfaced through {@link checkToolPolicy}.
 */
export function probeToolGating(
  architecture: string,
  requestedGroups: readonly ToolGroup[],
): ToolGatingReport[] {
  const matrix = matrixFor(architecture);
  const seen = new Set<ToolGroup>();
  const out: ToolGatingReport[] = [];
  for (const group of requestedGroups) {
    if (!isToolGroup(group) || seen.has(group)) continue;
    seen.add(group);
    const { strength, escapeSurfaces } = matrix[group];
    out.push({
      group,
      enforceable: strength !== 'none',
      strength,
      escapeSurfaces: [...escapeSurfaces],
    });
  }
  return out;
}

/**
 * The pre-dispatch gate. Returns the error to emit, or `undefined` when the run
 * may proceed.
 *
 * Backed by the same matrix as {@link probeToolGating}, so probe output and the
 * actual refusal can never disagree. There is NO PARTIAL APPLICATION: if any
 * requested group is unenforceable, nothing runs — the remaining enforceable
 * groups are not applied on their own.
 *
 * Deliberately not exported from the package root: the public M18 surface is
 * `ToolGroup`, `PLAN_MODE_DENY_GROUPS`, `probeToolGating` and
 * `AdapterToolPolicyError`. Adapters call this internally so four `execute()`
 * bodies do not each re-derive the same decision.
 */
export function checkToolPolicy(
  architecture: string,
  params: Pick<RuntimeExecuteParams, 'disallowedToolGroups' | 'planMode'>,
): AdapterToolPolicyError | undefined {
  const { groups, unknown, requested } = resolveDeniedGroups(params);
  if (!requested) return undefined;

  const reports = probeToolGating(architecture, groups);
  const unenforceable = reports.filter((r) => !r.enforceable).map((r) => r.group);
  if (unenforceable.length === 0 && unknown.length === 0) return undefined;

  return new AdapterToolPolicyError(architecture, {
    unenforceable,
    unknownGroups: unknown,
    enforceable: reports
      .filter((r) => r.enforceable)
      .map((r) => ({ group: r.group, strength: r.strength })),
  });
}

/**
 * Denying `file-read` or `file-write` while `shell` stays available is NOT a
 * filesystem boundary — the shell reaches the same files. Groups are
 * independent (denying `file-write` does not auto-deny `shell`), so the run
 * proceeds; the caller emits exactly one warning per run saying this plainly.
 */
export function isPorousCombination(groups: readonly ToolGroup[]): boolean {
  const denied = new Set(groups);
  return !denied.has('shell') && (denied.has('file-read') || denied.has('file-write'));
}

/** The wording of that warning, shared so all four adapters say the same thing. */
export function porousCombinationWarning(architecture: string, groups: readonly ToolGroup[]): string {
  const fs = groups.filter((g) => g === 'file-read' || g === 'file-write');
  return (
    `${architecture} adapter: ${fs.join(' and ')} ${fs.length > 1 ? 'are' : 'is'} denied while \`shell\` ` +
    'remains available — this is NOT a filesystem boundary. A shell command reaches the same files the ' +
    'denied tools would have. Deny `shell` as well if you need the boundary. The run proceeds.'
  );
}
