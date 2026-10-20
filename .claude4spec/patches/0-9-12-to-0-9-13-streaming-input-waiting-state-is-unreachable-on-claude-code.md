---
type: patch
brief: 0-9-12-to-0-9-13.md
patch_kind: drift
created_at: '2026-09-22T22:29:37.646Z'
created_by: unknown
applied: false
---
# Patch — streaming-input waiting state is unreachable on claude-code

## What I found
The idle-clock outstanding-work list gains "a `streamingInput` session whose input channel is still open, waiting for the next push". On claude-code, the only `midTurnPush: true` adapter, that state is structurally unreachable as a period of engine silence. At each successful `result`:
- the channel is kept open only if a push is already pending, and the SDK starts the next turn immediately;
- otherwise it is closed synchronously, or held by M17, which already stops the idle clock.

While the consumer is still holding the `result` event, the existing "consumer holds the event" rule already stops the idle clock. So the new member of the list changes no behaviour. It is covered by documentation plus a regression test: a consumer that waits well past `idleTimeoutMs` before pushing gets no idle expiry.

## Suggestion
Note in M11/M01 that on claude-code the "open and waiting" state coincides with the consumer holding a `result`, which the clock already excludes. Alternatively, if a future end-of-turn policy keeps the channel open without a pending push, this becomes a real predicate to implement.

