---
type: patch
brief: 0-0-7-to-0-0-8.md
patch_kind: missing
created_at: '2026-07-15T10:50:10.286Z'
created_by: unknown
status: awaiting
---
# Patch — brief's 0.0.7->0.0.8 numbering doesn't match real npm semver (actual: 0.8.6->0.9.0)

## What I found
The brief's frontmatter and title use the spec's internal release-tracking numbers ('0.0.7 → 0.0.8'), which don't correspond to this repo's real npm semver. The actual current package version at the time of implementation was `0.8.6`, not `0.0.7`.

Per this project's own established changelog convention — breaking changes bump the 0.x **minor**, not a patch (see the `0.7.0 → 0.8.0` bump for the last breaking change, changelog entry 'BREAKING (minor): createSdkMcpServer/tool no longer re-exported') — and because narrowing `@anthropic-ai/claude-agent-sdk`'s peerDependency range is a real breaking change for consumers, the actual shipped release for this brief is `0.9.0`, not '0.0.8' and not a patch-level bump.

## Suggestion
This is likely just a decoupling between the spec's internal release-sequence numbering and the target repo's real semver, which may be expected/by design. Flagging in case it's not — if briefs are meant to map 1:1 onto the code repo's actual next release version, the brief-generation step may want to read the real `package.json` version at generation time rather than incrementing its own internal counter.

