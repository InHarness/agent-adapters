---
type: patch
brief: 0-9-11-to-0-9-12.md
patch_kind: drift
created_at: '2026-09-22T16:38:38.377Z'
created_by: unknown
applied: false
---
# Patch — outbound SendMessage gate is a PreToolUse hook, not canUseTool

## What I found
A01 specifies the outbound peer-messaging predicate as a `canUseTool` input check, installed unconditionally. Our runs use `permissionMode: 'bypassPermissions'` (or `dontAsk` under soft path-scope). The SDK documents bypass as "bypass all permission checks" and dontAsk as "deny if not pre-approved", so neither mode consults `canUseTool` for an ordinary tool. A predicate there would never fire.

## What I shipped
An unconditional PreToolUse hook with no matcher.
- It records the `name` of every `Agent`/`Task` spawn.
- It denies a `SendMessage` whose `to` is not one of this run's subagents. A match can be a task id from a subagent `task_started`, a spawn `name`, or an unambiguous task-id prefix of 6 or more characters.
- The deny reason reads "this run may only address its own subagents".
- `canUseTool`'s installation condition is unchanged, so A01's "the hook becomes unconditional" behaviour change does not happen.

Verified live on sonnet-5 / SDK 0.3.263 under bypassPermissions: the deny reason reaches the model's `tool_result`. Re-entry via `SendMessage({to: "<spawn name>"})` still works, both ungated and under a `web` deny.

## Suggestion
- Reword A01 "Outbound peer messaging" to say a PreToolUse hook, with the permission-mode rationale.
- Specify which `to` spellings resolve: id, name, short-id prefix.
- Decide whether a subagent's message to "the main conversation" should be allowed. Today it is denied, which is strict per the spec.

