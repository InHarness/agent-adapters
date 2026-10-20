---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: clarification
created_at: '2026-09-23T08:02:36.646Z'
created_by: unknown
applied: false
---
# Patch — subagentTimeoutMs vs unanswered user input: M06 and M13 disagree

## What I found
M06 (`subagentTimeoutMs`) re-arms the cap only on a closed vocabulary (`subagent_started`, `subagent_progress`). A subagent that is blocked on an unanswered `user_input_request` (AskUserQuestion, permission prompt or elicitation raised inside it) therefore keeps burning its cap, so a slow human ends the run with `AdapterSubagentTimeoutError`.
M13 says the opposite. It states that only `abort()` / `timeoutMs` end a run parked on a human ("those two and no other clock") and calls the tool-call cap "the one clock that could". With a subagent open, `subagentTimeoutMs` is a second such clock. `c4s ask` (thread lpcJQ80gHxCl) confirmed that the spec does not settle this.
Implemented the M06-literal reading: the subagent cap keeps running under an unanswered request.
## Suggestion
Decide it in M06: either add an exemption symmetric to M01's tool-call exemption (the cap is suspended while a request is unanswered and re-armed with the full value after), or keep it running explicitly. Then fix the clock count in M13 to match.

