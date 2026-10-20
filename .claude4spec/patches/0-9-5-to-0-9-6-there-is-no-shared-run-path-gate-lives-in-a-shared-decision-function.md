---
type: patch
brief: 0-9-5-to-0-9-6.md
patch_kind: missing
created_at: '2026-08-25T13:33:04.667Z'
created_by: unknown
applied: false
---
# Patch — there is no shared run path; gate lives in a shared decision function

## What I found

Implementer item 5 says: *"Pre-dispatch gate in **the shared run path** — before any adapter
dispatch: resolve preset + explicit groups, validate, consult the matrix, throw ..."*

There is no shared run path in this codebase. `createAdapter()` returns an adapter and the
consumer calls `adapter.execute()` directly; each of the four adapters has its own
`execute()` async generator, and there is no base class, wrapper, or middleware layer
between the factory and the SDK call. The spec agent confirmed the phrase appears nowhere
in the specification either (`c4s ask`, thread `pH_3arjUouPA`) — it looks like brief-only
language.

The same item also implies a single interception point, which does not exist and cannot be
added without changing the public execution contract.

## Suggestion

The one-home rule is already satisfiable without a shared runner, and that is what I
implemented: a **shared decision function**, not a shared runner.

- `src/tool-groups.ts` owns the vocabulary, the preset constant, the union/dedupe/validation,
  the per-adapter strength + escape-surface matrix, and the probe. It is pure and
  synchronous.
- Each `execute()` calls one internal helper (`checkToolPolicy`) at its top, before any SDK
  contact, and emits the refusal itself. Four three-line call sites, one source of truth.
- The probe and the refusal read the **same matrix**, so probe output and actual refusal
  cannot disagree — which is the property item 4 actually asks for.

Two things worth making explicit in the spec, since both are contract decisions rather than
implementation detail:

1. Reword "shared run path" to something like *"a shared decision function each adapter
   calls at the top of `execute()`, before any SDK contact"* — it describes the achievable
   shape and keeps the one-home rule intact.
2. The L4 export list is `ToolGroup`, the preset constant, `probeToolGating` and
   `AdapterToolPolicyError` — and nothing else. That means the gate helper the four
   adapters share must stay **internal**, which is what I did (`checkToolPolicy` is not
   exported from `src/index.ts`). If the intent was instead a public `assertToolPolicy`-shaped
   helper so consumers can pre-flight a policy themselves, that is a public-contract
   addition and should be named in the L4 list. Right now the spec is silent and the two
   readings produce different published APIs.

