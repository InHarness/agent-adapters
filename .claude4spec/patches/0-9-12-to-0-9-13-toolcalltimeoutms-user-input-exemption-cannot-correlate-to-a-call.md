---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: clarification
created_at: '2026-09-22T22:29:37.262Z'
created_by: unknown
applied: false
---
# Patch — toolCallTimeoutMs user-input exemption cannot correlate to a call

## What I found
The tool-call cap exemption is phrased as "a `tool_use` with an unanswered `user_input_request` **under it**". But `UserInputRequest` carries no `toolUseId`, so an adapter cannot tell which in-flight call a request belongs to. This applies to MCP elicitation, tool-approval prompts and AskUserQuestion alike. The brief also says "suspend while…" and then "arm on the remainder of the call when it is answered", which can be read two ways: resume the remaining budget, or give a fresh full value.

## What was implemented
- While ANY `user_input_request` is unanswered, every in-flight tool-call timer is suspended. This is a conservative superset of "the call under it": a parallel unrelated call is also unbounded by the per-call cap during the human wait, but is still bounded by `timeoutMs`.
- When the last pending request is answered, each suspended call is re-armed with the **full** `toolCallTimeoutMs`.
- New calls starting while a request is pending are registered but not armed until the answer.

## Suggestion
State the correlation limitation, or add `toolUseId?` to `UserInputRequest` so the exemption can be exact. State whether "remainder" means the remaining budget or a fresh full value.

