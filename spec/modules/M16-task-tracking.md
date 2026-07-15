<!-- anchor: 27nw8i8j -->
# M16 — Task / todo tracking

> One projection of every engine's task-tracking tool onto a single `todo_list_updated` event and a running todo snapshot — across a landscape where the same SDK renames the tool mid-range and different SDKs source the list from entirely different places.

<!-- anchor: i3tt2nrj -->
## Purpose

Consumers get one legible view of what the agent is planning and doing — a `todo_list_updated` event and an accumulating todo snapshot — regardless of which engine ran or which task-tracking tool that engine happens to ship this version. M16 owns the **per-adapter task-tracking support matrix**, the **projection semantics** (how a raw tool call becomes `todo_list_updated` and how the snapshot accumulates), and the status of legacy tool aliases against each adapter's declared L7 range. It does **not** own the `todo_list_updated` event *type* or the `todoList` content block — those are M01/L1 vocabulary (see <section_ref anchor="8do90d06"/>); M16 owns the semantics of filling them, not the dictionary entry.

<!-- anchor: h60t92ct -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 (M01) | `todo_list_updated` event type + `todoList` content block are M01 vocabulary; M16 projects onto them. |
| L2 | In-range field drift degrades under the warn / skip / synthesize taxonomy. |
| L7 | The flagship case of schema drift *inside* a declared range — the SDK renames the task-tracking tool without a major bump. |
| A01 claude-code | Owns its event-mapping rows; links here for the matrix and projection semantics. |
| A03 opencode | Owns its event-mapping rows; links here for the matrix and projection semantics. |

<!-- anchor: qgg6repw -->
## Unified Contract (L1)

M16 does not define new vocabulary — it consumes M01's `todo_list_updated` event and the `todoList` content block (<section_ref anchor="8do90d06"/>). Its L1 contribution is the **projection**: a raw task-tracking tool call is normalized to a `todo_list_updated` event carrying a `source` discriminator, and the same payload is folded into a `todoList` block so `rawMessages` carries a consistent todo history. The event type is source-agnostic by design, so the projection is rename-durable regardless of which tool alias the SDK ships.

<!-- anchor: 3dln3isl -->
## Task-tracking support matrix (M16)

The canonical home for how each adapter sources and projects task-tracking (adapters link here, one-home rule):

| Adapter | Task-tracking source | `todo_list_updated` `source` | Snapshot accumulation |
| --- | --- | --- | --- |
| **claude-code (A01)** | `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` per-item CRUD family (in-range), gated behind a `ToolSearch` discovery call on newer models; legacy `TodoWrite` full-list-replace as an out-of-range defensive read | `model-tool` | CRUD family: **per-item merge** into the running snapshot. Legacy `TodoWrite`: **wholesale replace**. The echoed `tool_result` is suppressed as redundant. |
| **opencode (A03)** | `todo.updated` SSE frame | `session-state` | **Wholesale replace** from session state; additionally projected into a synthetic assistant message so `rawMessages` carries the todo history. |
| **codex (A02)** | — (SDK exposes no task-tracking tool) | — | No `todo_list_updated` emitted — absence, documented, never a silent pretense of one. |
| **gemini (A04)** | — (SDK exposes no task-tracking tool) | — | No `todo_list_updated` emitted — absence, documented, never a silent pretense of one. |

Two adapters project positively (A01, A03) from different sources; two are honest no-ops (A02, A04). This is not a consumer-requested capability that degrades — task-tracking is model-driven — so A02/A04's "degradation" is simply the documented absence of the event, not a warn/skip on consumer input.

<!-- anchor: ncle4lvp -->
## Capability & Degradation (L2)

Within an adapter's declared L7 range, the task-tracking tool's field/tool *names* may drift without a major SDK bump. M16's rule: read the tool input **defensively** from `Record<string,unknown>` and keep a **dual path** across known aliases, so a renamed field degrades to a correct projection, never a silent no-op (the failure mode where a mis-guessed field name yields an empty todo with no error). The A01 `TodoWrite` → `TaskCreate/…` cutover is the reference instance (see the L7 slice schema <section_ref anchor="d0npth7e"/> and the matrix above).

<!-- anchor: 8awtmgyk -->
## SDK compatibility & schema drift (L7)

Task-tracking is the flagship example of drift *inside* a declared range: the wrapped SDK renames the tool and reshapes its input without a major version bump, so the projection must survive the rename while staying inside the range each adapter declares in its own L7 section. M16 does not declare a range of its own — it names *why* the defensive read exists and defers the concrete range and cutover version to each adapter's L7 section. The **legacy-alias status** is decided by that range: for claude-code, if the declared range excludes the pre-cutover line, legacy `TodoWrite` is "out-of-declared-range, retained as a defensive read" (as recorded in the matrix), not a supported in-range path.

<!-- anchor: 1kbztqb4 -->
## Edge cases

- Newer Claude model where the task-tracking family is gated behind `ToolSearch` → the tool is still discovered and its per-item CRUD blocks still project `todo_list_updated`; the plan-mode allowlist keeps the family + `ToolSearch` available so a turn never regresses to prose-only planning (mechanism owned by A01).
- A `TaskUpdate` with `status: "deleted"` → the item should leave the snapshot; the current projection keeps it (known debt — snapshot merge does not honor deletion). Documented so consumers do not assume a deleted item disappears.
- codex / gemini run → no `todo_list_updated` is ever emitted (the SDKs expose no task-tracking tool); consumers must not treat its absence as an error.

<!-- anchor: qxbc4sjr -->
## Acceptance criteria

These verify the projection to `todo_list_updated` from either tool family, the per-adapter source/accumulation matrix, and defensive reading across in-range drift.

<tagged_list type="ac" tags="m16"/>
