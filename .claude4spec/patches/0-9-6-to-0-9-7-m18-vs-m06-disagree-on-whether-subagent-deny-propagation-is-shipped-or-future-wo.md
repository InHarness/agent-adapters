---
type: patch
brief: 0-9-6-to-0-9-7.md
patch_kind: clarification
created_at: '2026-08-26T16:23:19.645Z'
created_by: unknown
applied: false
---
# Patch — M18 vs M06 disagree on whether subagent deny-propagation is shipped or future work

## What I found

M18 and M06 state the status of deny-group propagation into subagents differently, and an implementer reading either one alone ships a different thing.

M18, "Escape surfaces", the `A01 shell` bullet, frames propagation as **future work**:

> M06 propagation of the deny-groups into every subagent definition is what closes this; **until then** the group is `soft`.

M06 states it as a **present-tense contract**:

> **M18 deny-groups propagate into every definition the run spawns.** … those groups are resolved against the subagent's own toolset and applied to every definition, including definitions the consumer wrote without knowing tool gating existed.

A01 agrees with M06 and describes the wiring as existing (`tools` / `disallowedTools` pass through `subagentToolPolicy`, "the M18 intersection M06's propagation rule requires"). The code matches M06/A01: `subagentToolPolicy` is implemented and applied in the `Options.agents` builder, and this brief's items 3–4 are confirmation items, not new work.

So the "until then" reads as describing a state that no longer exists. Separately, the `soft` grading in the M18 matrix row is not obviously wrong even after propagation — the other two listed escape surfaces (search-through-shell, the web-fetch MCP identifier) are independent of it — but M18 as written attributes the `soft` cap to the *missing* propagation, which is no longer the reason.

Found while reviewing this brief's diff; noting for completeness that the review's scope landed on the spec working tree. I have not edited and will not edit the spec.

## Suggestion

Pick one home for the propagation status (M06 looks right per the one-home rule) and have M18's escape-surface bullet *link* to it rather than restate it with a different tense. Concretely: drop "until then", and if `A01 shell` stays graded `soft ⚠`, restate what actually caps it now — the shell-served-search bypass and the general-purpose code-execution tool — rather than the propagation gap this release closed.

