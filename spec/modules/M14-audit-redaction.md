<!-- anchor: y1w80jqi -->
# M14 — Startup audit & secret redaction

> One audit event at the top of every run — `adapter_ready` — that announces the resolved SDK configuration, with every credential scrubbed first so the payload is safe to log by construction.

<!-- anchor: 5c0hi9kf -->
## Purpose

Operators need to see *what configuration an adapter actually resolved* — model, provider, transports, working directory — without that audit trail leaking an API key into a log aggregator. M14 owns the `adapter_ready` event, the `redactSecrets` pass that sanitizes its `sdkConfig` payload, the "safe to log by construction" guarantee, and the ordering rule that any startup `warning` is emitted **before** `adapter_ready`. It is the observability seam between "adapter constructed" and "first model output".

<!-- anchor: 2h3ixr9t -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `adapter_ready` is a `UnifiedEvent` variant; carries the redacted `sdkConfig`. |
| L4 | Exports `redactSecrets`. |
| M09 | Observers/collectors see `adapter_ready` like any other event; consumers may filter it out. |
| M03 | Provider presets feed the `sdkConfig` that `adapter_ready` reports (post-redaction). |
| every adapter | Emits exactly one `adapter_ready` as its first non-`warning` event. |

<!-- anchor: 0tycjmv6 -->
## Unified Contract (L1)

- **`adapter_ready` event** — `{ type:'adapter_ready', sdkConfig }`. Emitted **exactly once** per run, and it is the **first non-`warning` event** on the stream. Consumers can rely on it as the signal that startup negotiation (model resolution, provider wiring, capability detection) is complete.
- **Redacted payload** — `sdkConfig` is passed through `redactSecrets` before emission, so no field reaching the consumer carries a live credential.
- **Ordering** — startup `warning` events (e.g. an unsupported capability being degraded) are emitted **before** `adapter_ready`, so the readiness marker also delimits "all startup warnings have now been seen".

<!-- anchor: 0vjimvs4 -->
## Public API & Packaging (L4)

Exports `redactSecrets<T>(value: T): T` from the package root — a reusable, shape-preserving redactor consumers can apply to their own logging.

`redactSecrets` is **shape-preserving**: it returns the same structure with only secret-bearing string values replaced by `[REDACTED]`. Detection is two-layer — a **field-name** match (`apiKey`, `*_token`, `authorization`, `password`, `secret`, `credential`, `bearer`) and a **value-prefix** fallback that catches secrets under non-conventional field names by their literal prefix (`sk-`/`sk_`, `xox[abprs]-`, `gh[opusr]_`, `AKIA…`, `AIza…`). Non-string values pass through unchanged; cycles resolve to `[CIRCULAR]`.

<!-- anchor: feqt8or2 -->
## Edge cases

- Secret stored under a conventional key (`apiKey`, `ANTHROPIC_API_KEY`) → field-name regex redacts the value to `[REDACTED]`.
- Secret stashed under a non-conventional key (e.g. opencode's `api`) → value-prefix regex still catches it by its `sk-`/`AIza…`/etc. prefix.
- A `warning` arriving after `adapter_ready` is a contract violation — startup warnings must precede the readiness marker; only mid-run warnings may follow.
- Consumer that does not want config noise → filters `adapter_ready` out via M09 collectors/observers; the event is informational, not control flow.
- Empty-string or non-string value under a secret-named key → left intact (nothing to leak), so the payload shape is never corrupted.

<!-- anchor: h3atuijq -->
## Acceptance criteria

These verify the single-emission/ordering contract of `adapter_ready` and that redaction makes the payload safe to log under both detection layers.

<tagged_list type="ac" tags="m14"/>
