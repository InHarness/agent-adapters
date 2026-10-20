---
type: patch
brief: 0-0-8-to-0-0-9.md
patch_kind: clarification
created_at: '2026-07-15T13:46:56.821Z'
created_by: unknown
status: awaiting
---
# Patch — verified-range vs declared range, version axis, and two e2e caveats

## What I found

Three points needed a judgement call while implementing:

1. **"Verified range = declared range" vs the dev-pin.** The brief (anchor `verrange`) says the declared `peerDependencies` range must equal the *verified range* — "the SDK version the e2e suite actually runs against (dev-pinned `^0.3.153`)". But these are two different shapes: the declared peer range is a minor window `>=0.3.0 <0.4.0` (`PEER_SDK_RANGES` + `package.json`), while the dev-pin is a patch-floor `^0.3.153`. They are not equal; the dev-pin is a *point inside* the declared range. My `sdk-version-gate` verified-range e2e therefore asserts the resolved **installed** version satisfies the **declared** range (status `ok`) — the honest, checkable invariant — rather than asserting range-equals-pin.

2. **Spec release axis vs npm SemVer axis.** `to_release: 0.0.9` collides with this repo's npm axis (already at `0.9.0`). Per the skill's explicit instruction and the user's confirmation, I set `package.json` `"version"` to `0.0.9` literally. Note this is a *downgrade* on the npm axis and will block `npm publish` until re-bumped by `/release-process`. Flagging so the two-axis relationship is recorded, not silently reconciled.

3. **Two e2e caveats worth pinning in the spec.**
   - `mcp-elicitation`: the scenario is written end-to-end (an in-process SDK-MCP server that issues `elicitation/create`, an `onElicitation` handler, assertion that it bridges to `user_input_request` source `mcp-elicitation` and the answer reaches the model). It could **not be live-verified** in my environment (no run against a real model). Whether claude-agent-sdk forwards an in-process SDK-MCP server's elicitation to `options.onElicitation` is an SDK behavior this test now guards but I could not confirm green.
   - `image`: I implemented the `base64` and `file` delivery paths (both deterministic and self-contained via an in-process PNG generator). I deliberately omitted the `url` variant to avoid coupling a live-model assertion to a third-party image host.

## Suggestion

Clarify in M12 whether "verified range" means (a) the declared peer range is proven satisfiable by the pinned SDK (what I asserted) or (b) a literal string-equality between range and pin (which the current values violate). For the version axis, add a note in the brief template that `to_release` overrides npm SemVer for spec tracking and may downgrade `package.json`. For `mcp-elicitation`/`image-url`, consider marking them "written, pending live verification / host" rather than fully Covered until a live run confirms them.

