// Unit tests: claude-code adapter native SDK blocks → unified ContentBlock /
// NormalizedMessage. Pure-function level — no SDK calls.

import { describe, it, expect } from 'vitest';
import { PLAN_MODE_DENY_GROUPS } from '../tool-groups.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  normalizeContentBlocks,
  normalizeAssistantMessage,
  todoItemsFromTodoWriteInput,
  mergeTaskToolInputIntoSnapshot,
  extractAssignedTaskId,
  extractAssignedTaskIds,
  batchTaskItemId,
  buildClaudeCodeToolPolicy,
  subagentToolPolicy,
  CLAUDE_CODE_TASK_TRACKING_TOOLS,
} from './claude-code.js';

describe('normalizeContentBlocks', () => {
  it('maps SDK text → text block', () => {
    const out = normalizeContentBlocks([{ type: 'text', text: 'hello' }]);
    expect(out).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('maps SDK thinking → thinking block (uses .thinking field)', () => {
    const out = normalizeContentBlocks([{ type: 'thinking', thinking: 'reasoning…' }]);
    expect(out).toEqual([{ type: 'thinking', text: 'reasoning…' }]);
  });

  it('maps SDK tool_use → toolUse block (renames id→toolUseId, name→toolName)', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_use', id: 'tu_123', name: 'echo', input: { msg: 'hi' } },
    ]);
    expect(out).toEqual([
      { type: 'toolUse', toolUseId: 'tu_123', toolName: 'echo', input: { msg: 'hi' } },
    ]);
  });

  it('defaults missing tool_use input to {}', () => {
    const out = normalizeContentBlocks([{ type: 'tool_use', id: 'x', name: 'noop' }]);
    expect(out).toEqual([{ type: 'toolUse', toolUseId: 'x', toolName: 'noop', input: {} }]);
  });

  it('maps SDK tool_result with string content → toolResult block', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false },
    ]);
    expect(out).toEqual([
      { type: 'toolResult', toolUseId: 'tu_1', content: 'ok', isError: false },
    ]);
  });

  it('JSON-stringifies non-string tool_result content', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_result', tool_use_id: 'tu_2', content: [{ type: 'text', text: 'ok' }] },
    ]);
    expect(out[0]).toMatchObject({
      type: 'toolResult',
      toolUseId: 'tu_2',
      content: JSON.stringify([{ type: 'text', text: 'ok' }]),
    });
  });

  it('passes through tool_result.is_error → isError', () => {
    const out = normalizeContentBlocks([
      { type: 'tool_result', tool_use_id: 'x', content: 'boom', is_error: true },
    ]);
    expect((out[0] as { isError: boolean }).isError).toBe(true);
  });

  it('preserves order across mixed block types', () => {
    const out = normalizeContentBlocks([
      { type: 'thinking', thinking: 'plan' },
      { type: 'text', text: 'answer' },
      { type: 'tool_use', id: 't', name: 'echo', input: { x: 1 } },
    ]);
    expect(out.map((b) => b.type)).toEqual(['thinking', 'text', 'toolUse']);
  });

  it('returns empty for empty input', () => {
    expect(normalizeContentBlocks([])).toEqual([]);
  });

  it('silently drops unknown block types', () => {
    const out = normalizeContentBlocks([
      { type: 'text', text: 'keep' },
      { type: 'mystery_future_type', payload: 'drop' },
    ]);
    expect(out).toEqual([{ type: 'text', text: 'keep' }]);
  });
});

describe('normalizeAssistantMessage', () => {
  function buildSdkAssistant(overrides: Partial<{
    content: unknown[];
    parent_tool_use_id: string | null;
    usage: Record<string, unknown>;
  }>): SDKMessage & { type: 'assistant' } {
    const message: Record<string, unknown> = {
      content: overrides.content ?? [{ type: 'text', text: 'hi' }],
    };
    if (overrides.usage !== undefined) message.usage = overrides.usage;
    return {
      type: 'assistant',
      parent_tool_use_id: overrides.parent_tool_use_id ?? null,
      message,
    } as unknown as SDKMessage & { type: 'assistant' };
  }

  it('produces an assistant NormalizedMessage with normalized content', () => {
    const msg = normalizeAssistantMessage(
      buildSdkAssistant({ content: [{ type: 'text', text: 'hello' }] }),
    );
    expect(msg.role).toBe('assistant');
    expect(msg.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(typeof msg.timestamp).toBe('string');
    expect(msg.timestamp.length).toBeGreaterThan(0);
  });

  it('preserves the raw SDK message in `native`', () => {
    const sdkMsg = buildSdkAssistant({});
    const out = normalizeAssistantMessage(sdkMsg);
    expect(out.native).toBe(sdkMsg);
  });

  it('maps parent_tool_use_id → subagentTaskId', () => {
    const out = normalizeAssistantMessage(
      buildSdkAssistant({ parent_tool_use_id: 'parent_tu_42' }),
    );
    expect(out.subagentTaskId).toBe('parent_tu_42');
  });

  it('omits subagentTaskId when parent_tool_use_id is null', () => {
    const out = normalizeAssistantMessage(buildSdkAssistant({ parent_tool_use_id: null }));
    expect(out.subagentTaskId).toBeUndefined();
  });

  it('treats non-array content as empty', () => {
    const sdkMsg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: null },
    } as unknown as SDKMessage & { type: 'assistant' };
    const out = normalizeAssistantMessage(sdkMsg);
    expect(out.content).toEqual([]);
  });

  it('extracts per-message usage (Anthropic 3-bucket → unified subset shape)', () => {
    // Anthropic API exposes input_tokens (fresh), cache_read_input_tokens,
    // and cache_creation_input_tokens as three ADDITIVE buckets. The unified
    // UsageStats contract follows OpenAI convention: inputTokens = total
    // posted to LLM, with cache fields as SUBSETS (see UsageStats JSDoc in
    // src/types.ts). The adapter rolls all three into inputTokens so the
    // library-wide contextSize / fresh formulas work uniformly.
    const out = normalizeAssistantMessage(
      buildSdkAssistant({
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 4321,
          cache_creation_input_tokens: 100,
        },
      }),
    );
    expect(out.usage).toEqual({
      inputTokens: 4431, // 10 + 4321 + 100
      outputTokens: 20,
      cacheReadInputTokens: 4321,
      cacheCreationInputTokens: 100,
    });
    // Sanity: fresh = inputTokens − cacheRead − cacheWrite recovers the
    // raw Anthropic input_tokens.
    expect(
      out.usage!.inputTokens -
        (out.usage!.cacheReadInputTokens ?? 0) -
        (out.usage!.cacheCreationInputTokens ?? 0),
    ).toBe(10);
  });

  it('omits usage when SDK message has no usage field', () => {
    const out = normalizeAssistantMessage(buildSdkAssistant({}));
    expect(out.usage).toBeUndefined();
  });

  it('round-trips text + tool_use into text + toolUse blocks', () => {
    const out = normalizeAssistantMessage(
      buildSdkAssistant({
        content: [
          { type: 'text', text: 'calling echo…' },
          { type: 'tool_use', id: 'tu_a', name: 'echo', input: { message: 'x' } },
        ],
      }),
    );
    expect(out.content).toEqual([
      { type: 'text', text: 'calling echo…' },
      { type: 'toolUse', toolUseId: 'tu_a', toolName: 'echo', input: { message: 'x' } },
    ]);
  });
});

describe('todoItemsFromTodoWriteInput', () => {
  it('maps TodoWrite.todos → TodoItem[] with synthesized id from index', () => {
    const out = todoItemsFromTodoWriteInput({
      todos: [
        { content: 'First step', status: 'in_progress', activeForm: 'Doing first step' },
        { content: 'Second step', status: 'pending', activeForm: 'Doing second step' },
      ],
    });
    expect(out).toEqual([
      { id: '0', content: 'First step', activeForm: 'Doing first step', status: 'in_progress' },
      { id: '1', content: 'Second step', activeForm: 'Doing second step', status: 'pending' },
    ]);
  });

  it('tolerates missing activeForm', () => {
    const out = todoItemsFromTodoWriteInput({
      todos: [{ content: 'Bare item', status: 'pending' }],
    });
    expect(out).toEqual([{ id: '0', content: 'Bare item', status: 'pending' }]);
  });

  it('defaults missing status to pending and missing content to empty string', () => {
    const out = todoItemsFromTodoWriteInput({ todos: [{}] });
    expect(out).toEqual([{ id: '0', content: '', status: 'pending' }]);
  });

  it('returns [] when todos is missing or not an array', () => {
    expect(todoItemsFromTodoWriteInput({})).toEqual([]);
    expect(todoItemsFromTodoWriteInput({ todos: 'nope' } as unknown as Record<string, unknown>)).toEqual([]);
  });
});

// Newer Claude models ship task-tracking as a per-item CRUD family
// (TaskCreate/TaskGet/TaskUpdate/TaskList) instead of the single TodoWrite
// tool. Field names below match the real schema in
// @anthropic-ai/claude-agent-sdk's sdk-tools.d.ts (TaskCreateInput uses
// subject/description with no id; TaskUpdateInput/TaskGetInput key on
// taskId). Unlike TodoWrite (full-list replace), each call carries at most
// one entry and must be merged into the running snapshot.
describe('mergeTaskToolInputIntoSnapshot', () => {
  it('creates a new item for TaskCreate, keyed by toolUseId (TaskCreateInput has no id)', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_1', {
      subject: 'Do X',
      description: 'Do the X thing',
      activeForm: 'Doing X',
    });
    expect(out).toEqual([{ id: 'toolu_1', content: 'Do the X thing', activeForm: 'Doing X', status: 'pending' }]);
  });

  it('merges a TaskUpdate by taskId, preserving untouched fields and overwriting patched ones', () => {
    const afterCreate = mergeTaskToolInputIntoSnapshot([], 'toolu_1', {
      subject: 'Do X',
      description: 'Do the X thing',
    });
    const afterUpdate = mergeTaskToolInputIntoSnapshot(afterCreate ?? [], 'toolu_2', {
      taskId: 'toolu_1',
      status: 'completed',
    });
    expect(afterUpdate).toEqual([{ id: 'toolu_1', content: 'Do the X thing', status: 'completed' }]);
  });

  it('reconciles a TaskUpdate keyed on the engine-assigned id back to the create that made it', () => {
    // The real shapes, probed live: TaskCreate's input carries no id and its
    // tool_result reads "Task #1 created successfully: …", after which the model
    // updates with `{ taskId: '1' }`. Without the alias that appended a SECOND
    // item with empty content while the first never left `pending` (M16).
    const afterCreate = mergeTaskToolInputIntoSnapshot([], 'toolu_1', {
      subject: 'Extract the avatar upload',
      description: 'Extract the avatar upload component',
    });
    const afterUpdate = mergeTaskToolInputIntoSnapshot(
      afterCreate ?? [],
      'toolu_2',
      { taskId: '1', status: 'in_progress' },
      new Map([['1', 'toolu_1']]),
    );
    expect(afterUpdate).toEqual([
      { id: 'toolu_1', content: 'Extract the avatar upload component', status: 'in_progress' },
    ]);
  });

  it('leaves an unknown taskId as-is rather than guessing — it may name an earlier turn\'s task', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_2', { taskId: '7', status: 'completed' }, new Map());
    expect(out).toEqual([{ id: '7', content: '', status: 'completed' }]);
  });

  it('appends a second task rather than replacing the first (accumulation, not full-list-replace)', () => {
    const afterFirst = mergeTaskToolInputIntoSnapshot([], 'toolu_1', { subject: 'X', description: 'Do X' });
    const afterSecond = mergeTaskToolInputIntoSnapshot(afterFirst ?? [], 'toolu_2', {
      subject: 'Y',
      description: 'Do Y',
    });
    expect(afterSecond).toEqual([
      { id: 'toolu_1', content: 'Do X', status: 'pending' },
      { id: 'toolu_2', content: 'Do Y', status: 'pending' },
    ]);
  });

  it('returns undefined for a bare TaskGet (no writable field) — caller must leave tool_use/tool_result untouched', () => {
    const snapshot = [{ id: 't1', content: 'Do X', status: 'pending' as const }];
    expect(mergeTaskToolInputIntoSnapshot(snapshot, 'toolu_3', { taskId: 't1' })).toBeUndefined();
  });

  it('returns undefined for a bare TaskList (empty input) — caller must leave tool_use/tool_result untouched', () => {
    const snapshot = [{ id: 't1', content: 'Do X', status: 'pending' as const }];
    expect(mergeTaskToolInputIntoSnapshot(snapshot, 'toolu_4', {})).toBeUndefined();
  });

  it('creates a blank-content stub when TaskUpdate references an unknown taskId (e.g. resumed session)', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_5', { taskId: 'unknown', status: 'completed' });
    expect(out).toEqual([{ id: 'unknown', content: '', status: 'completed' }]);
  });
});

// The alias above is only as good as the id extraction that feeds it, and that
// extraction reads ENGLISH PROSE out of an unstructured tool_result. One reworded
// CLI string silently reinstates the M16 bug, so accept the phrasings the engine
// plausibly emits — not just the one it emits today — and prefer structure when
// there is any.
describe('extractAssignedTaskId', () => {
  it('reads the phrasing the CLI actually emits', () => {
    // Verbatim from a live TaskCreate on 0.3.153 AND 0.3.210 (both probed).
    expect(extractAssignedTaskId('Task #1 created successfully: probe task')).toBe('1');
  });

  it.each([
    ['Created task 1: probe task', '1'],
    ['Created task #12: probe task', '12'],
    ['Task 7 created', '7'],
    ['{"taskId":"42","subject":"probe task"}', '42'],
    ['{"task_id":9}', '9'],
    ['task_id: 3', '3'],
    ['taskId=88', '88'],
  ])('reads %j as %j', (content, expected) => {
    expect(extractAssignedTaskId(content)).toBe(expected);
  });

  it('does not mistake a word in the sentence for an id', () => {
    // `/task\s+(\S+)\s+created/` alone captures "was" here — an id that matches
    // nothing, silently poisoning the alias map.
    expect(extractAssignedTaskId('The task was created successfully')).toBeUndefined();
  });

  it('returns undefined when nothing in the payload names an id', () => {
    expect(extractAssignedTaskId('OK')).toBeUndefined();
    expect(extractAssignedTaskId('')).toBeUndefined();
  });
});

// Regression, now expressed against the M18 residual allow-list: `options.tools`
// is the only knob that shapes the model's built-in catalog, and under the
// plan-mode preset it is built by `buildClaudeCodeToolPolicy(['file-write','shell'])`.
describe('plan-mode residual allow-list (M18 preset)', () => {
  const plan = buildClaudeCodeToolPolicy([...PLAN_MODE_DENY_GROUPS])!;

  // Subagents are allowed under the preset (read-only research). Both names are
  // listed because Task→Agent was renamed in Claude Code v2.1.63 but the
  // system:init tools list (what `tools`/`disallowedTools` filter against) still
  // uses 'Task'.
  it('exposes subagent spawning (Task and Agent)', () => {
    expect(plan.allow).toContain('Task');
    expect(plan.allow).toContain('Agent');
    expect(plan.deny).not.toContain('Task');
    expect(plan.deny).not.toContain('Agent');
  });

  it('still blocks the genuinely mutating built-ins', () => {
    expect(plan.deny).toEqual(
      expect.arrayContaining(['Bash', 'Edit', 'Write', 'NotebookEdit']),
    );
    for (const tool of ['Bash', 'Edit', 'Write', 'NotebookEdit']) {
      expect(plan.allow).not.toContain(tool);
    }
  });

  it('keeps reads and web available — plan mode must still be able to research', () => {
    expect(plan.allow).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']));
    expect(plan.allow).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']));
  });

  // Newer Claude models replace TodoWrite with a per-item CRUD family
  // (TaskCreate/TaskGet/TaskUpdate/TaskList) discovered via ToolSearch. Both
  // must stay allowed or a plan-mode turn on a newer model silently falls back
  // to prose-only planning (no usable task-tracking tool at all).
  it('exposes every task-tracking alias plus the ToolSearch discovery gate', () => {
    for (const tool of [...CLAUDE_CODE_TASK_TRACKING_TOOLS, 'ToolSearch']) {
      expect(plan.allow).toContain(tool);
      expect(plan.deny).not.toContain(tool);
    }
  });

  // The alias-tracking invariant itself: the shared constant — not a hand-copied
  // second list — is what the allow-list is built from, so a future rename only
  // needs updating in one place.
  it('derives the allow-list from CLAUDE_CODE_TASK_TRACKING_TOOLS (no drift)', () => {
    for (const tool of CLAUDE_CODE_TASK_TRACKING_TOOLS) {
      expect(plan.allow).toContain(tool);
    }
  });

  // Skill must be present or inline skills materialized as a local plugin can
  // never be opened ("No such tool available: Skill"). Under the plan-mode
  // preset shell IS denied, and a `shell` deny suppresses Skill — a skill
  // routinely instructs the model to run shell commands, so leaving it would
  // reopen the group through the front door. That override is the point.
  it('suppresses Skill under the preset, because the preset denies shell', () => {
    expect(plan.allow).not.toContain('Skill');
  });

  it('keeps Skill available when shell is NOT denied', () => {
    const writeOnly = buildClaudeCodeToolPolicy(['file-write'])!;
    expect(writeOnly.allow).toContain('Skill');
  });
});

// The residual-allow-list invariant, asserted on the SHAPE handed to the SDK
// rather than on today's tool set: a built-in this library has never heard of
// must be BLOCKED, not allowed. A deny-only enumeration would fail this.
describe('residual allow-list invariant', () => {
  it('is an allow-list, so an unknown future built-in is not in it', () => {
    const policy = buildClaudeCodeToolPolicy(['shell'])!;
    expect(policy.allow).not.toContain('SomeFutureBuiltinAnthropicShips');
    // ...and it is a real, finite list — not `undefined`, which would mean
    // "SDK default catalog" and therefore fail open.
    expect(Array.isArray(policy.allow)).toBe(true);
    expect(policy.allow.length).toBeGreaterThan(0);
  });

  it('is undefined when nothing is denied, so an ungated run is byte-for-byte unchanged', () => {
    expect(buildClaudeCodeToolPolicy([])).toBeUndefined();
  });

  it('never lists a tool as both allowed and denied', () => {
    for (const groups of [['shell'], ['file-read'], ['file-write'], ['web'], [...PLAN_MODE_DENY_GROUPS]] as const) {
      const policy = buildClaudeCodeToolPolicy([...groups])!;
      const allow = new Set(policy.allow);
      for (const denied of policy.deny) expect(allow.has(denied)).toBe(false);
    }
  });
});

// A subagent does not natively inherit the parent's denies, so without
// propagation "deny the shell" would mean "deny the shell until the model
// delegates".
describe('subagent deny propagation', () => {
  const policy = buildClaudeCodeToolPolicy(['shell'])!;

  it('narrows a definition that names a denied tool, silently — not an error', () => {
    const out = subagentToolPolicy({ tools: ['Read', 'Bash'] }, policy);
    expect(out.tools).toEqual(['Read']);
    expect(out.disallowedTools).toEqual(expect.arrayContaining(['Bash']));
  });

  it('gives a definition with no toolset the run\'s residual allow-list', () => {
    const out = subagentToolPolicy({}, policy);
    expect(out.tools).toEqual(policy.allow);
  });

  it('is a no-op when the run denies nothing', () => {
    expect(subagentToolPolicy({ tools: ['Bash'] }, undefined)).toEqual({ tools: ['Bash'] });
  });

  // M06: a subagent inherits the run's MCP servers "filtered by its own toolset".
  // Tool groups contain built-ins only, so no group can deny an `mcp__*` name —
  // intersecting them away left a mostly-MCP definition with `tools: []`, which the
  // SDK reads as "no tools" rather than "inherit".
  it('passes an mcp__ name through — groups gate built-ins, not MCP', () => {
    const out = subagentToolPolicy({ tools: ['mcp__reference-tools__search_pages'] }, policy);
    expect(out.tools).toEqual(['mcp__reference-tools__search_pages']);
  });

  it('applies both rules at once: denied built-in drops, MCP survives', () => {
    const out = subagentToolPolicy(
      { tools: ['Read', 'Bash', 'mcp__entity-tools__get_entities'] },
      policy,
    );
    expect(out.tools).toEqual(['Read', 'mcp__entity-tools__get_entities']);
  });

  // The residual-allow-list invariant: the predicate is "is this MCP", never "is this
  // absent from the built-in list". A built-in this library has not heard of — one
  // landing in a future SDK bump — must still be blocked, so an upgrade degrades toward
  // safety. This is the only case where the two predicates disagree.
  it('still blocks a built-in it has never heard of', () => {
    const out = subagentToolPolicy({ tools: ['SomeFutureBuiltin', 'Read'] }, policy);
    expect(out.tools).toEqual(['Read']);
  });

  it('still unions the run\'s denied built-ins into disallowedTools', () => {
    const out = subagentToolPolicy(
      { tools: ['mcp__entity-tools__get_entities'], disallowedTools: ['Custom'] },
      policy,
    );
    expect(out.disallowedTools).toEqual(expect.arrayContaining(['Custom', ...policy.deny]));
  });
});

// The four payload shapes below were observed in a real consumer's traffic, and
// two of them were being DROPPED for two months: the gate introduced on
// 2026-07-14 accepted only the keys the SDK declares, but it reads the RAW STREAM
// input, which carries the model's unrepaired spelling. The consumer's share of
// threads carrying a todo list went 12.5% → 0% (M16).
//
// They are pinned verbatim so a future "align to the SDK types" pass has to
// delete a named regression test rather than quietly re-narrow a boolean.
describe('mergeTaskToolInputIntoSnapshot — the raw-stream shapes the model really emits', () => {
  it('merges a canonical TaskCreate — { subject, description }', () => {
    expect(mergeTaskToolInputIntoSnapshot([], 'toolu_1', { subject: 'x', description: 'y' })).toEqual([
      { id: 'toolu_1', content: 'y', status: 'pending' },
    ]);
  });

  it('merges a canonical TaskUpdate — { taskId, status }', () => {
    const snapshot = [{ id: 'toolu_abc', content: 'x', status: 'pending' as const }];
    expect(mergeTaskToolInputIntoSnapshot(snapshot, 'toolu_2', { taskId: 'toolu_abc', status: 'completed' })).toEqual([
      { id: 'toolu_abc', content: 'x', status: 'completed' },
    ]);
  });

  // The headline regression: status arrives under `state`, never reaches the
  // snapshot, and every later update is a silent no-op.
  it("merges a TaskUpdate whose status arrives under 'state' — the unrepaired spelling", () => {
    const snapshot = [{ id: '4', content: 'Wire the adapter', status: 'pending' as const }];
    expect(mergeTaskToolInputIntoSnapshot(snapshot, 'toolu_3', { taskId: '4', state: 'in_progress' })).toEqual([
      { id: '4', content: 'Wire the adapter', status: 'in_progress' },
    ]);
  });

  it("merges a TaskUpdate whose status arrives under 'task_status'", () => {
    const snapshot = [{ id: '4', content: 'Wire the adapter', status: 'pending' as const }];
    expect(mergeTaskToolInputIntoSnapshot(snapshot, 'toolu_4', { taskId: '4', task_status: 'completed' })).toEqual([
      { id: '4', content: 'Wire the adapter', status: 'completed' },
    ]);
  });

  it('prefers the canonical key when the input carries more than one spelling', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_5', {
      taskId: 'toolu_5',
      status: 'completed',
      state: 'in_progress',
    });
    expect(out?.[0].status).toBe('completed');
  });

  it('merges a batch TaskCreate — items in a JSON STRING under `tasks`, keyed by content', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_6', {
      tasks: '[{"content":"x","status":"pending","priority":"high"}]',
    });
    expect(out).toEqual([
      { id: batchTaskItemId('toolu_6', 0), content: 'x', status: 'pending', priority: 'high' },
    ]);
  });

  it('merges a batch whose `tasks` is already an array (no double-encoding)', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_7', {
      tasks: [{ content: 'a', status: 'in_progress', activeForm: 'Doing a' }],
    });
    expect(out).toEqual([
      { id: batchTaskItemId('toolu_7', 0), content: 'a', activeForm: 'Doing a', status: 'in_progress' },
    ]);
  });

  // The reason batch items are keyed by <toolUseId>#<idx> and not by bare index:
  // the CRUD family accumulates per-item, only TodoWrite replaces wholesale. Index
  // keying would make this second batch overwrite the first one's items.
  it('accumulates across two batch creates rather than overwriting the first', () => {
    const first = mergeTaskToolInputIntoSnapshot([], 'toolu_a', { tasks: '[{"content":"one"}]' });
    const second = mergeTaskToolInputIntoSnapshot(first ?? [], 'toolu_b', { tasks: '[{"content":"two"}]' });
    expect(second).toEqual([
      { id: batchTaskItemId('toolu_a', 0), content: 'one', status: 'pending' },
      { id: batchTaskItemId('toolu_b', 0), content: 'two', status: 'pending' },
    ]);
  });

  it('re-emitting the same batch upserts in place instead of duplicating', () => {
    const first = mergeTaskToolInputIntoSnapshot([], 'toolu_c', { tasks: '[{"content":"one"}]' });
    const again = mergeTaskToolInputIntoSnapshot(first ?? [], 'toolu_c', {
      tasks: '[{"content":"one","status":"completed"}]',
    });
    expect(again).toEqual([{ id: batchTaskItemId('toolu_c', 0), content: 'one', status: 'completed' }]);
  });

  it('keeps every item of a multi-item batch, in order', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_d', {
      tasks: '[{"content":"a"},{"content":"b"},{"content":"c"}]',
    });
    expect(out?.map((i) => i.content)).toEqual(['a', 'b', 'c']);
  });

  it('skips batch entries that are not objects or carry no content, keeping the rest', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_e', {
      tasks: '["nope", null, {"status":"pending"}, {"content":"real"}]',
    });
    expect(out).toEqual([{ id: batchTaskItemId('toolu_e', 3), content: 'real', status: 'pending' }]);
  });

  it('drops a priority outside the closed set rather than widening TodoItem', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_f', { tasks: '[{"content":"x","priority":"urgent"}]' });
    expect(out?.[0]).not.toHaveProperty('priority');
  });

  // Never throw out of the stream handler: an unparseable batch is a warning for
  // the caller, not a crashed run.
  it('returns undefined for a malformed `tasks` string without throwing', () => {
    expect(() => mergeTaskToolInputIntoSnapshot([], 'toolu_g', { tasks: '[{' })).not.toThrow();
    expect(mergeTaskToolInputIntoSnapshot([], 'toolu_g', { tasks: '[{' })).toBeUndefined();
  });

  it('returns undefined when `tasks` parses to a non-array', () => {
    expect(mergeTaskToolInputIntoSnapshot([], 'toolu_h', { tasks: '{"content":"x"}' })).toBeUndefined();
  });

  it('returns undefined for an empty batch — nothing to merge, and the caller warns', () => {
    expect(mergeTaskToolInputIntoSnapshot([], 'toolu_i', { tasks: '[]' })).toBeUndefined();
  });

  it('falls back to the per-item path when a malformed batch rides alongside a usable subject', () => {
    const out = mergeTaskToolInputIntoSnapshot([], 'toolu_j', { tasks: '[{', subject: 'still usable' });
    expect(out).toEqual([{ id: 'toolu_j', content: 'still usable', status: 'pending' }]);
  });

  it('still returns undefined for the read verbs — TaskGet and TaskList merge nothing by design', () => {
    const snapshot = [{ id: 't1', content: 'Do X', status: 'pending' as const }];
    expect(mergeTaskToolInputIntoSnapshot(snapshot, 'toolu_k', { taskId: 't1' })).toBeUndefined();
    expect(mergeTaskToolInputIntoSnapshot(snapshot, 'toolu_l', {})).toBeUndefined();
  });
});

// A batch creates N tasks in one call, so its tool_result names N ids and the
// adapter maps them positionally onto the N items. The single-create fallback
// ("exactly one create unreconciled") cannot cover this: a batch leaves N
// unreconciled at once. See extractAssignedTaskIds (M16).
describe('extractAssignedTaskIds', () => {
  it('reads several ids out of repeated prose, in the order they appear', () => {
    expect(
      extractAssignedTaskIds('Task #1 created successfully: a\nTask #2 created successfully: b'),
    ).toEqual(['1', '2']);
  });

  it('de-duplicates when overlapping patterns match the same sentence', () => {
    expect(extractAssignedTaskIds('Task #7 created successfully: only one task')).toEqual(['7']);
  });

  it('reads a JSON array of ids', () => {
    expect(extractAssignedTaskIds('["11","12"]')).toEqual(['11', '12']);
  });

  it('reads a JSON array of objects, and accepts numeric ids', () => {
    expect(extractAssignedTaskIds('[{"taskId":1},{"task_id":"2"},{"id":"3"}]')).toEqual(['1', '2', '3']);
  });

  it('reads an array nested under `tasks`', () => {
    expect(extractAssignedTaskIds('{"tasks":[{"id":"a1b2c3d4"},{"id":"e5f6g7h8"}]}')).toEqual([
      'a1b2c3d4',
      'e5f6g7h8',
    ]);
  });

  it('reads a single structured id — a one-item batch is still a batch', () => {
    expect(extractAssignedTaskIds('{"taskId":"42"}')).toEqual(['42']);
  });

  // Returning a guess here is worse than returning nothing: a wrong alias
  // corrupts a real item, a missing one merely appends a stray.
  it('returns [] for prose that names no id, rather than capturing an English word', () => {
    expect(extractAssignedTaskIds('The task was created.')).toEqual([]);
    expect(extractAssignedTaskIds('')).toEqual([]);
  });

  it('agrees with the single-id extractor on a single-create result', () => {
    const content = 'Task #1 created successfully: probe';
    expect(extractAssignedTaskIds(content)).toEqual([extractAssignedTaskId(content)]);
  });
});
