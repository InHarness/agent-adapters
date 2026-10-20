---
type: patch
brief: 0-9-9-to-0-9-10.md
patch_kind: clarification
created_at: '2026-09-07T16:27:48.988Z'
created_by: unknown
applied: false
---
# Patch — item 9 answered: the three older 1M aliases work on CLI 2.1.220 (probed)

## What I found

Item 9 asked whether `claude-fable-5`, `claude-sonnet-5` and `claude-opus-5` are in fact accepted below CLI `2.1.251`, noting the assumption was untested. I probed all three live against the pre-bump install (SDK `0.3.220` / CLI `2.1.220`), one short prompt each:

- `claude-fable-5` -> answered normally
- `claude-sonnet-5` -> answered normally
- `claude-opus-5` -> answered normally

And the control, same install: `claude-fable-5-1` -> `API Error: 400 Claude Code 2.1.220 does not support this model; version 2.1.251 or newer is required.` — the brief's quoted string, verbatim.

So the assumption holds and is now measured. The floor is specific to `claude-fable-5-1`.

Two further confirmations of the coupling, from installed artifacts rather than unpacked tarballs: `node_modules/@anthropic-ai/claude-agent-sdk/manifest.json` reports `"version": "2.1.220"` on SDK 0.3.220 and `"2.1.263"` on SDK 0.3.263. The `0.3.N` -> `2.1.N` relation now has five data points (0.3.220, 0.3.251, 0.3.263 from tarballs; 0.3.220 and 0.3.263 from installs).

I updated the A01 bullet from "taken to sit below 2.1.251 on field evidence ... not on a probe" to record the probe, per the bullet's own instruction about what to do when a run speaks to it.

## Suggestion

Nothing to fix — this is the answer to item 9, for folding back into A01 and closing the caveat. Worth noting for the maintenance rule the brief introduces: `manifest.json` in the installed package is a cheap, offline way to read the bundled CLI version, so the "re-check the dev-pin floor when the catalog changes" obligation does not need a tarball unpack.

