---
type: patch
brief: 0-9-3-to-0-9-4.md
patch_kind: clarification
created_at: '2026-07-28T15:51:40.522Z'
created_by: unknown
status: awaiting
---
# Patch — full e2e x 11 model scripts per pin bump is cost-prohibitive

## What I found

The brief requires, for every dev-pin bump, the **full** `test:e2e:claude:*` suite — "all scripts,
including the per-model parametrized ones" — and states that a pin verified only by probes is
unfinished. In this repo that expands to 34 live scenarios x **11** per-model scripts:

`test:e2e:claude` plus `:fable-5`, `:sonnet-4.5`, `:sonnet-4.6`, `:sonnet-5`, `:opus-4.5`, `:opus-4.6`,
`:opus-4.7`, `:opus-4.8`, `:opus-5`, `:haiku-4.5`.

Each scenario is a live model turn (`testTimeout: 120_000`, `retry: 0`), several of them multi-turn with
subagents and backgrounded shell work. That is several hundred live turns and well over an hour of wall
clock per bump, in real money — for a change that is one string in `devDependencies`.

With the user's agreement I ran **the default model only** (`npm run test:e2e:claude`). The per-model
scripts were not run, and the Verified-pin-log row I am proposing says exactly that rather than
implying full-matrix coverage. Flagging it because, read literally, the AC would mark this bump
unfinished.

The per-model scripts also do not vary the SDK surface under test — they vary the *model*, which is M02
catalog coverage. A pin bump changes the SDK; a model script exercises the same SDK code path with a
different `model` string.

## Suggestion

Make the e2e requirement for a **pin bump** explicit and proportionate, e.g.: the full scenario suite on
a representative model (the default), plus named per-model scripts only where the brief's expected
deltas are model-sensitive. Keep the full 11-script matrix as a *release* gate (M12 conformance), not a
per-bump gate. If full-matrix really is intended per bump, the AC should say so with its cost
acknowledged, so an implementer running a subset knows they are declaring a deviation rather than
interpreting.

Either way, it would help if the Verified-pin log's `verified by` column were specified to state
**coverage**, not just the tool — "`test:e2e:claude`, default model, per-model scripts not run" is an
honest row; "full e2e suite" is not, when it was one model.

