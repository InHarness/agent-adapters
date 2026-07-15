<!-- anchor: hzx35vql -->
# M11 — Mid-turn injection / streaming input

> Push a user message into a turn that is already running — for the one adapter whose SDK has a live input channel — and degrade to "re-dispatch after the turn" everywhere else, with the same observable `user_message` event either way.

<!-- anchor: mffug65m -->
## Purpose

Developers building interactive UIs can inject a follow-up message mid-turn instead of waiting for the model to finish. M11 owns the `streamingInput` mode, the optional `pushMessage(text): boolean` on `RuntimeAdapter`, the `user_message` event, and the degradation contract keyed on `architectureCapabilities().midTurnPush`. Only claude-code has a real streaming-input channel today; the design makes the *unsupported* path explicit and safe rather than silently dropping the message.

<!-- anchor: xtcepzy0 -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `pushMessage` on `RuntimeAdapter`; `streamingInput` param; `user_message` event; multi-`result` streaming exception. |
| L2 | Keys on `midTurnPush`; owns the mid-turn degradation contract. |
| L4 | `pushMessage` is part of the adapter instance surface. |
| M01 | Defines `RuntimeAdapter.pushMessage?` and the streaming-input stream semantics. |

<!-- anchor: fr2hhuye -->
## Unified Contract (L1)

- With `streamingInput: true`, the adapter opens an input channel and the stream may yield **multiple** `result` events (one per delivered turn), staying alive until the channel drains or `abort()`.
- `pushMessage(text)` returns `true` if accepted onto the open channel, `false` if the channel is closed/closing or the adapter isn't in streaming-input mode. An accepted push emits `user_message { text, timestamp }` **before** the model's response, so consumers persist it in transcript order.

<!-- anchor: j2gwlt0q -->
## Capability & Degradation (L2)

- `architectureCapabilities(arch).midTurnPush` advertises support. **claude-code: ✅**; codex / gemini / opencode: ❌ (one prompt per call/`runStreamed`).
- Degradation: on a non-`midTurnPush` adapter, `streamingInput` falls back to a one-shot string prompt and `pushMessage` returns `false`; the caller re-dispatches the message as the next turn. No message is silently lost.

<!-- anchor: 6kzz2r6c -->
## Public API & Packaging (L4)

`pushMessage` is exposed on the adapter instance returned by `createAdapter`; `streamingInput` is a `RuntimeExecuteParams` field (M01/L4).

<!-- anchor: ssdfx250 -->
## Edge cases

- `pushMessage` after the channel closed → returns `false`; caller re-dispatches after the turn.
- Non-`midTurnPush` adapter with `streamingInput: true` → behaves as one-shot; capability is discoverable up front so UIs can gate the affordance.
- `user_message` ordering → always emitted before the model's response to that message.

<!-- anchor: 1nrzaulg -->
## Acceptance criteria

These verify the accept/reject contract of `pushMessage` and that degradation never drops a message.

<tagged_list type="ac" tags="m11"/>
