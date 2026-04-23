// Key-based recursive secret redactor for adapter_ready payloads.
//
// Matches field names — not values — against a conservative regex covering
// the common conventions used by the adapter SDKs and MCP configs:
// `apiKey`, `API_KEY`, `*_TOKEN`, `authorization`, `password`, `secret`,
// `credential`, and `bearer`. Anything matching has its string value replaced
// with `'[REDACTED]'`; non-string values (numbers, booleans, null) pass
// through unchanged so the payload shape stays intact.
//
// Known limitation: a secret stashed under a custom field name (e.g.
// `{ myCustom: 'sk-xxx' }`) won't be caught. Callers should use conventional
// field names or pre-redact before building their sdkConfig.

const SECRET_KEY_REGEX = /(apikey|api_key|token|secret|password|authorization|credential|bearer)/i;

const REDACTED = '[REDACTED]';

export function redactSecrets<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(source)) {
    if (SECRET_KEY_REGEX.test(key)) {
      out[key] = typeof v === 'string' && v.length > 0 ? REDACTED : v;
    } else {
      out[key] = redactValue(v, seen);
    }
  }
  return out;
}
