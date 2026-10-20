---
type: patch
brief: 0-9-3-to-0-9-4.md
patch_kind: drift
created_at: '2026-07-28T15:51:17.289Z'
created_by: unknown
status: awaiting
---
# Patch — from_release 0.9.3 does not match package.json 0.9.1 on main

## What I found

The brief's frontmatter reads `from_release: 0.9.3` / `to_release: 0.9.4`, but `package.json` on `main`
reads **`0.9.1`**. Commit `42f849c` ("fix: the release is 0.9.1, not 0.10.0") deliberately corrected the
version down, so 0.9.1 is the intended current state of the code repo, not a stale value.

That leaves 0.9.2 and 0.9.3 with no counterpart in the code repo: no commit ever set them. Following
the brief-implementer skill I set `"version": "0.9.4"`, which means this PR jumps 0.9.1 -> 0.9.4 in one
step.

Note also that this repo has a second, independent numbering axis: the `/release-process` skill derives
the npm SemVer from git tags. The two now disagree by two patch releases.

## Suggestion

Worth deciding explicitly which of these is true, and recording it in M12:

- spec releases and npm versions are the **same** axis -> then 0.9.2/0.9.3 were spec-only edits that
  should not have consumed release numbers, and briefs should be generated only for releases that
  produce code; or
- they are **separate** axes -> then `to_release` should not be written into `package.json` at all, and
  the brief-implementer instruction to do so needs revising.

Right now the implementer is told to write a number that the release-process skill will independently
overwrite from git tags.

