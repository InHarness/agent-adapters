---
type: patch
brief: 0-9-5-to-0-9-6.md
patch_kind: missing
created_at: '2026-08-25T13:35:18.748Z'
created_by: unknown
applied: false
---
# Patch — e2e verification gaps: codex CLI binary absent, .env cannot be suppressed per-run

## What I found

Two environment gaps that limited what I could prove live, reported so "the suite passed"
does not overstate the evidence.

### codex: the CLI binary is absent from the installed vendor package

Every codex e2e case that needs a real model run fails at init with:

```
spawn .../node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex ENOENT
```

The vendor package is installed but ships only `vendor/aarch64-apple-darwin/path/rg` — the
`codex` binary itself is not there. This is **pre-existing and unrelated to this brief**;
it affects every codex live scenario, not just tool gating.

Consequence for M18 evidence: codex's *refusal* cases all pass live (5/5) because a
pre-dispatch refusal never touches the SDK — which is itself a decent proof that the gate
fires before dispatch. But the two cases that need a live turn — `file-write` mapping onto
the read-only sandbox, and the empty-array opt-out — could not be run here. They are
written and collect cleanly.

### The e2e config re-reads `.env`, so creds cannot be suppressed per-run

`vitest.config.e2e.ts` does `process.env = { ...fileEnv, ...process.env }`. Because
`fileEnv` is spread first, `env -u GOOGLE_API_KEY` does not suppress a key present in
`.env` — it comes straight back. Blanking works (`GOOGLE_API_KEY= npm run test:e2e`) since
`requireEnv` tests truthiness, but that is non-obvious and I lost a couple of runs to it.

This matters for cost control: a developer who wants to run only the adapters they have
budget for cannot do it by unsetting variables, and the natural attempt silently runs
everything.

## Suggestion

1. Nothing for the spec on the codex binary — but if the L7 consumer section documents how
   to run codex e2e, it is worth noting that `@openai/codex-sdk` alone is not sufficient
   and the CLI binary must be resolvable, since the failure mode is an opaque `ENOENT` at
   init rather than a clear "codex CLI not found".
2. Consider giving every adapter a `SKIP_<ADAPTER>_E2E` flag. claude-code and codex have
   one; gemini and opencode gate purely on credential presence, so with a populated `.env`
   there is no way to skip them short of editing the file. A uniform skip flag would make
   "run the cheap gates, then one adapter at a time" — which is what the brief-implementer
   workflow asks for — actually expressible.

