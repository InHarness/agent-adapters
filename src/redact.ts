// Recursive secret redactor for adapter_ready payloads.
//
// Two-layer detection:
//
// 1. **Field-name regex** — covers conventional names used by adapter SDKs
//    and MCP configs (`apiKey`, `API_KEY`, `*_TOKEN`, `authorization`,
//    `password`, `secret`, `credential`, `bearer`). Any matching field has
//    its string value replaced with `'[REDACTED]'`.
//
// 2. **Value-prefix regex** — fallback that catches secrets stashed under
//    non-conventional field names (e.g. opencode's `api`). Triggers when a
//    string starts with a known credential prefix: OpenAI/Anthropic/
//    OpenRouter/DeepSeek (`sk-`/`sk_`), Slack (`xox[abprs]-`), GitHub PATs
//    (`gh[opusr]_`), AWS access keys (`AKIA…`), Google API keys (`AIza…`).
//
// Non-string values (numbers, booleans, null) pass through unchanged so the
// payload shape stays intact.
//
// Note: anchored `^` patterns avoid false positives on substrings inside
// long prose.

const SECRET_KEY_REGEX = /(apikey|api_key|token|secret|password|authorization|credential|bearer)/i;

const SECRET_VALUE_REGEX =
  /^(sk-[a-zA-Z0-9]|sk_[a-zA-Z0-9]|xox[abprs]-[a-zA-Z0-9]|gh[opusr]_[a-zA-Z0-9]|AKIA[A-Z0-9]{16}|AIza[a-zA-Z0-9_-]{35})/;

const REDACTED = '[REDACTED]';

export function redactSecrets<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

function shouldRedact(key: string, value: unknown): boolean {
  if (SECRET_KEY_REGEX.test(key)) return true;
  if (typeof value === 'string' && SECRET_VALUE_REGEX.test(value)) return true;
  return false;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(source)) {
    if (shouldRedact(key, v)) {
      out[key] = typeof v === 'string' && v.length > 0 ? REDACTED : v;
    } else {
      out[key] = redactValue(v, seen);
    }
  }
  return out;
}
