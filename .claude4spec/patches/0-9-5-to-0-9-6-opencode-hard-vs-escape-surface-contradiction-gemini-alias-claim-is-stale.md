---
type: patch
brief: 0-9-5-to-0-9-6.md
patch_kind: incorrect
created_at: '2026-08-25T13:32:38.713Z'
created_by: unknown
applied: false
---
# Patch — opencode hard-vs-escape-surface contradiction; gemini alias claim is stale

## What I found

Two things in the adapter matrix that do not survive contact with the pinned SDKs.

### 1. opencode "hard ⚠" contradicts the escape-surface AC

Section 3 lists opencode as `hard ⚠` for all four groups, and section 3's opencode
paragraph names an escape surface: "the server's permission schema ends in a catch-all, so
an unknown or mistyped bucket name is **accepted and silently ignored, with no validation
error**".

But AC `ac-a-group-with-a-documented-escape-surf` says: *"A group with a documented escape
surface is never reported with strength 'hard' — the probe reports 'soft' and names the
surface."* Read literally, opencode can never be `hard`, and the matrix is unimplementable
as written.

I resolved it by treating the ⚠ as **conditional**, per the brief's own next sentence
("the adapter may claim `hard` only for buckets confirmed against the running server
version"): the catch-all is a hazard for *unverified* bucket names, not an unconditional
hole. I verified every bucket against the running opencode 1.4.6 binary and report
`hard` with an empty `escapeSurfaces`, with a unit test pinning the bucket vocabulary so
a future typo fails loudly instead of silently enforcing nothing.

That reading is defensible but it is a guess, and it is the difference between an adapter
advertising a real sandbox and advertising a model-behaviour gate.

### 2. gemini's alias caveat is already handled by the SDK

The brief says: *"Tool renames that leave a legacy alias resolvable mean a deny must name
**both spellings** or it silently fails to fire."*

On the pinned `@google/gemini-cli-core` (0.38.1) that is not true. `tool-registry.js:409`
defines `expandExcludeToolsWithAliases()`, which expands the exclude set through
`TOOL_LEGACY_ALIASES` (`tool-names.js:54`, currently `search_file_content -> grep_search`)
before matching. Naming *either* spelling excludes both.

I named both spellings anyway — cheap, and it removes the dependency on that expansion
surviving a peer bump — but the brief states as a hard requirement something the SDK
already guarantees, which misleads about where the risk actually is.

While mapping the groups I also confirmed the names the brief left implicit: the shell
group needs `list_background_processes` and `read_background_output` (both real, in
`dist/src/tools/`), and the current search tool is `grep_search`, not `search_file_content`.

## Suggestion

1. For opencode, state the conditionality in the matrix rather than in prose two paragraphs
   later — e.g. `hard (verified buckets only)` — and add a sentence to the strength axis
   distinguishing a **documented, unconditional** escape surface (which forces `soft`) from
   a **hazard that verification retires**. As written the AC and the matrix cannot both
   hold.
2. For gemini, soften the alias claim to note that the pinned SDK expands legacy aliases on
   the exclude set itself, so naming both spellings is defence-in-depth rather than a
   correctness requirement. The genuine gemini risk is the one the brief already states
   correctly: `excludeTools` is deny-only, so a NEW built-in is available until the mapping
   names it.

