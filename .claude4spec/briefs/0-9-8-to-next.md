---
type: brief
from_release: 0.9.8
to_release: null
generated_at: '2026-09-03T09:30:06.721Z'
implemented: true
---
# Brief: 0.9.8 → (unreleased)

## Summary

Task tracking (module M16) in the `claude-code` adapter stopped working for real traffic: the model's `TaskCreate` / `TaskUpdate` calls are accepted by the SDK but rejected by our merge gate, so the todo snapshot never advances and no `todo_list_updated` event is emitted. Because nothing merged, the adapter also leaves the raw `tool_use` / `tool_result` pair in the stream, and the consumer renders internal task-tracking plumbing as ordinary tool rows.

The root cause is a schema-alignment pass that is correct in principle and wrong at this particular boundary. The merge gate reads the **raw stream input**, which carries the model's *unrepaired* spelling; Claude Code repairs close-but-incorrect key names before executing the tool, but that repair is never reflected back into the stream. We already read the task identifier defensively (`taskId ?? id`, and a `['taskId','task_id','id']` probe) and nowhere else. That asymmetry is the defect.

This release makes the write path defensive on the **status** field as well, teaches the gate the batch `TaskCreate({ tasks })` shape, and makes an unmergeable write **loud** instead of silent.

## Evidence — the regression is dated and measurable

Measured in a real consumer's database (claude4spec, project `app-spec`), which persists the todo list **only** from our `todo_list_updated` event. Share of threads that ever carried a list:

| month | threads with a list |
|---------|---------------------|
| 2026-04 | 12.5% |
| 2026-05 | 15.7% |
| 2026-06 | 7.0% |
| 2026-07 | 1.1% |
| 2026-08 | 1.0% |
| 2026-09 | 0% |

The cliff is mid-July, and it is our date. On 2026-07-14, commit `f4107ee` *"fix(claude-code): correct task-tracking field names against the real SDK schema"* introduced the `hasWritableField` gate. The same day, the model switched from legacy `TodoWrite` (index-keyed ids `"0"`, `"1"`, produced by `todoItemsFromTodoWriteInput`) to the per-item `TaskCreate` / `TaskUpdate` family (ids `toolu_*`).

78 `Task*` calls reached the consumer as plain, unmerged tool rows — each with its `tool_result` echo present. The four observed payload shapes:

| tool | window | n | shape | input |
|------|--------|---|-------|-------|
| `TaskCreate` | 2026-07-03..07 | 24 | canonical | `{ subject, description }` |
| `TaskCreate` | 2026-07-11..28 | 5 | **batch** | `{ tasks: "[{\"content\":…,\"status\":…,\"priority\":…}]" }` |
| `TaskUpdate` | 2026-07-03..07 | 45 | canonical | `{ taskId, status }` |
| `TaskUpdate` | 2026-07-28 | 2 | **non-canonical** | `{ taskId: "4", state: "in_progress" }` |

Both unhandled shapes appear **after** the 2026-07-14 tightening. The consumer-visible effect: creates land, every later update is a silent no-op, the list never advances past `pending`, and the UI renders nothing. To the end user it reads as *"the agent stopped using task lists"*.

## What the system does differently

### 1. The status field is read defensively, like the identifier already is

Before, `mergeTaskToolInputIntoSnapshot` (`src/adapters/claude-code.ts:400-404`) merged only when the raw input carried one of four exact keys:

```ts
const hasWritableField =
  typeof input.subject === 'string' ||
  typeof input.description === 'string' ||
  typeof input.activeForm === 'string' ||
  typeof input.status === 'string';
if (!hasWritableField) return undefined;
```

`return undefined` means: no merge, no `todo_list_updated`, and the caller leaves the `tool_use` / `tool_result` pair in the consumer stream.

Now the status is resolved through an alias list, mirroring the identifier handling that already exists at `:406` (`input.taskId ?? input.id`) and `:453` (`['taskId','task_id','id']`):

- accepted status keys: `status`, `state`, `task_status` — first string-valued key wins;
- SDK 0.3.220 `TaskUpdateInput` (`sdk-tools.d.ts:2509`) declares `status`; `state` and `task_status` are the model's unrepaired spellings, valid only because the gate reads the pre-repair stream.

So `{ taskId: "4", state: "in_progress" }` now merges as a status transition on task `4`.

### 2. Batch `TaskCreate({ tasks })` is understood

`TaskCreate` may arrive with no top-level `subject` at all, carrying instead a `tasks` field that is a **JSON string** holding an array of items in the *`TodoWrite` item vocabulary*:

```json
{ "tasks": "[{\"content\":\"Wire the adapter\",\"status\":\"pending\",\"priority\":\"high\"}]" }
```

The gate now:

- accepts `tasks` as either an already-parsed array or a JSON string;
- parses the string **defensively** — malformed JSON, a non-array result, or non-object items never throw and never crash the stream handler; they fall through to the warning path in §3;
- maps each item's `content` → `TodoItem.content` (the `TaskCreate` vocabulary uses `subject`; the batch items use `content`), carrying `status` and `priority` where present.

A batch create therefore produces one merged snapshot covering all items, and a single `todo_list_updated`.

### 3. An unmergeable write is no longer silent

`TaskGet` and `TaskList` returning `undefined` is deliberate and stays: they are reads, their answer lives in the `tool_result` payload that we do not parse, and there is nothing to merge.

A `TaskCreate` or `TaskUpdate` that could not be merged is a different thing — it is lost state. It now surfaces on the side-band as a `warning` event (an already-supported side-band event type) naming the tool and the offending input keys. Before this release M16 gave the consumer no way to notice the loss at all; the only symptom was an empty list.

### 4. The rule is stated in the spec, not just in the code

M16 now states the invariant that `f4107ee` violated: **the merge gate reads the RAW stream input, so it must accept the model's close-but-incorrect spellings, not only the declared SDK schema.** This is the case the SDK docs (`agent-sdk/todo-tracking`) tell integrators to defend against:

> Claude Code repairs some close-but-incorrect key names before execution, mapping `id` or `task_id` to `taskId` and `active_form` to `activeForm`, but that repair is not reflected in the stream. Read `TaskUpdate` input fields defensively.

Without this stated as a rule, a future "align to the SDK types" pass will re-narrow the gate and re-introduce exactly this outage.

## For implementers

1. `src/adapters/claude-code.ts:400-404` — replace the `hasWritableField` boolean with a resolved-status lookup. Add a local helper next to the existing identifier probe:

   ```ts
   const STATUS_KEYS = ['status', 'state', 'task_status'] as const;
   const readStatus = (input: Record<string, unknown>): string | undefined => {
     for (const k of STATUS_KEYS) {
       if (typeof input[k] === 'string') return input[k] as string;
     }
     return undefined;
   };
   ```

   The gate becomes: mergeable when `subject`, `description`, `activeForm` is a string **or** `readStatus(input) !== undefined` **or** the batch `tasks` field is present (step 2).

2. `src/adapters/claude-code.ts` (same function) — add batch handling for `TaskCreate`:

   ```ts
   const readBatchTasks = (input: Record<string, unknown>): unknown[] | undefined => {
     const raw = input.tasks;
     if (Array.isArray(raw)) return raw;
     if (typeof raw !== 'string') return undefined;
     try {
       const parsed = JSON.parse(raw);
       return Array.isArray(parsed) ? parsed : undefined;
     } catch {
       return undefined;   // never throw out of the stream handler
     }
   };
   ```

   Map each item `{ content, status, priority }` → `TodoItem` with `content: item.content` (not `subject`). Items that are not objects or lack a string `content` are skipped, and the call falls through to step 3 if nothing merged.

3. `src/adapters/claude-code.ts:406` and `:453` — leave the identifier handling as is (`input.taskId ?? input.id`, `['taskId','task_id','id']`); the status lookup in step 1 is deliberately symmetric with it. Do not "unify" by narrowing either side.

4. Emit the warning where the merge result is consumed (the caller of `mergeTaskToolInputIntoSnapshot` that decides whether to swallow the `tool_use`/`tool_result` pair): when the tool name is `TaskCreate` or `TaskUpdate` and the merge returned `undefined`, push a side-band `warning` event carrying the tool name and `Object.keys(input)`. Keep `TaskGet` / `TaskList` on the silent path — gate the warning on the write-tool names, not on "merge returned undefined".

5. Regression tests — build them from the four real payloads verbatim, so a future schema-alignment pass cannot re-narrow the gate:

   ```ts
   { subject: 'x', description: 'y' }                                  // TaskCreate canonical  → merges
   { tasks: '[{"content":"x","status":"pending","priority":"high"}]' } // TaskCreate batch      → merges, content → TodoItem.content
   { taskId: 'toolu_abc', status: 'completed' }                        // TaskUpdate canonical  → merges
   { taskId: '4', state: 'in_progress' }                               // TaskUpdate non-canon  → merges via 'state' alias
   ```

   Plus: malformed `tasks: '[{'` → no throw, one `warning`; `TaskGet` / `TaskList` inputs → no merge and **no** warning; each merging case → exactly one `todo_list_updated` and no leaked `tool_use` / `tool_result` pair.

6. M16 spec text — add the raw-stream rule from §4 above to the module's task-tracking section, worded as a constraint on the merge gate (accept model spellings; the declared SDK schema is a lower bound, not the contract), and add an observable acceptance criterion: *a `TaskUpdate` whose status arrives under `state` advances the todo snapshot and emits `todo_list_updated`*.
