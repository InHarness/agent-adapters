---
type: patch
brief: 0-9-11-to-0-9-12.md
patch_kind: clarification
created_at: '2026-09-22T16:38:38.584Z'
created_by: unknown
applied: false
---
# Patch — inventory classification of non-obvious catalogue tools

## What I found
Closing the 24-of-45 gap forced a classification of every `sdk-tools.d.ts` schema. The brief names the aliases and the shell classification of TaskOutput/TaskStop, and nothing else. The live `sdk-surface-probe` leg 1 also found `DesignSync` exposed at `system:init` with no published schema.

## What I shipped
- **shell**: TaskOutput plus BashOutput/AgentOutput/BashOutputTool/AgentOutputTool, TaskStop plus KillBash/KillShell, Monitor (streams a shell command), REPL (code execution).
- **file-write**: EnterWorktree, ExitWorktree.
- **delegation**: Agent, Task, SendMessage, ListAgents, ListPeers, Workflow (orchestrates subagents), RemoteTrigger (starts a remote agent run).
- **ungated**: Enter/ExitPlanMode, Cron*, ScheduleWakeup, the MCP-resource tools plus their `…Tool` spellings, RefreshMcpTools, SendUserMessage/Brief, and the host-surface tools (ReportFindings, SendFeedback, ClaudeDesign, Projects, ShowOnboardingRolePicker, ReadNotifications, ProposeSkills, ProposeGoal, Artifact, PushNotification, DesignSync).
- A unit drift guard parses the installed `sdk-tools.d.ts`. The live probe covers deferred and unpublished names.

## Suggestion
Put this table into M18/A01 as the reference classification, especially Workflow/RemoteTrigger → delegation and worktrees → file-write. Consider whether Artifact/PushNotification (outbound publication) belong in `web`.

