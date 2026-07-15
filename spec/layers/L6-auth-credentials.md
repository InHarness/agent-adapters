<!-- anchor: xxay46yf -->
# L6 — Auth & Credentials

> Each adapter declares its own auth model: the default credential source, the optional provider override, the required environment, and the failure mode (`AdapterInitError`) when credentials are missing.

<!-- anchor: y9m843r8 -->
## Role in the system

L6 is a declaration convention, not a credential broker. The library stores no secrets; it requires each adapter to state where its credentials come from and to fail clearly and early when they are absent. The actual credential resolution happens inside the wrapped SDK (local OAuth, API key, CLI auth file). L6 only fixes how that model is declared and how failure surfaces.

<!-- anchor: le0v4g4j -->
## Module slice schema

- **Adapter (consumer)** — the primary (and effectively only) consumer. Each adapter writes a `## Auth model (L6)` section covering four points: **default source** (env var / local OAuth / CLI auth file), **via provider** (whether `M03` can inject a base URL + provider env), **required env** (and whether its absence is fatal), and **failure mode** (always an `error` `phase: 'init'` — `AdapterInitError` — never a throw).
- **Capability-module (consumer)** — only `M03` (Providers) touches L6, supplying provider-override credentials; it documents that in its own L6 section.
- **Implementor (external — wrapped SDKs)** — each SDK resolves its own credentials; the spec only declares the model and the failure surface.

> **Implementor module:** `external — wrapped SDKs` (each SDK resolves its own credentials). Consumers are the **adapters**; M03 (Providers) supplies provider-override credentials.
