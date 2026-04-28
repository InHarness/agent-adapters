import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../redact.js';

describe('redactSecrets', () => {
  it('redacts flat apiKey', () => {
    const input = { apiKey: 'sk-xxx', model: 'gpt-5' };
    expect(redactSecrets(input)).toEqual({ apiKey: '[REDACTED]', model: 'gpt-5' });
  });

  it('matches case-insensitively and handles various naming conventions', () => {
    const input = {
      API_KEY: 'a',
      ApiKey: 'b',
      OPENAI_API_KEY: 'c',
      GITHUB_TOKEN: 'd',
      SLACK_BOT_TOKEN: 'e',
      Authorization: 'Bearer xxx',
      password: 'pw',
      my_secret: 'ss',
      credentials: 'cc',
    };
    const out = redactSecrets(input) as Record<string, string>;
    for (const v of Object.values(out)) expect(v).toBe('[REDACTED]');
  });

  it('recurses into nested objects (MCP env with GITHUB_TOKEN)', () => {
    const input = {
      mcp: {
        github: {
          command: 'npx',
          args: ['@github/mcp'],
          env: { GITHUB_TOKEN: 'ghp_xxx', NODE_ENV: 'production' },
        },
      },
    };
    const out = redactSecrets(input) as {
      mcp: { github: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(out.mcp.github.command).toBe('npx');
    expect(out.mcp.github.args).toEqual(['@github/mcp']);
    expect(out.mcp.github.env.GITHUB_TOKEN).toBe('[REDACTED]');
    expect(out.mcp.github.env.NODE_ENV).toBe('production');
  });

  it('recurses into arrays of objects', () => {
    const input = { headers: [{ Authorization: 'Bearer xxx' }, { 'X-Custom': 'ok' }] };
    const out = redactSecrets(input) as { headers: Array<Record<string, string>> };
    expect(out.headers[0].Authorization).toBe('[REDACTED]');
    expect(out.headers[1]['X-Custom']).toBe('ok');
  });

  it('preserves innocuous fields', () => {
    const input = {
      command: 'npx',
      args: ['a', 'b'],
      url: 'https://example.com',
      model: 'claude-opus-4-7',
      NODE_ENV: 'production',
      sessionId: 'abc-123',
    };
    expect(redactSecrets(input)).toEqual(input);
  });

  it('does not mutate input', () => {
    const input = { apiKey: 'sk-xxx', nested: { token: 't' } };
    const copy = JSON.parse(JSON.stringify(input));
    redactSecrets(input);
    expect(input).toEqual(copy);
  });

  it('passes through primitives and nullish values', () => {
    expect(redactSecrets('hello')).toBe('hello');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });

  it('leaves non-string redacted-key values alone', () => {
    const input = { token: 0, apiKey: null, secret: false };
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(out.token).toBe(0);
    expect(out.apiKey).toBe(null);
    expect(out.secret).toBe(false);
  });

  it('leaves empty-string redacted-key values alone (nothing to redact)', () => {
    const input = { apiKey: '' };
    expect(redactSecrets(input)).toEqual({ apiKey: '' });
  });

  it('redacts secrets stashed under non-conventional field names by value prefix', () => {
    // OpenCode uses `api` (not `apiKey`); without value-side detection
    // the OpenRouter key would leak into adapter_ready.sdkConfig.
    const input = {
      port: 8080,
      config: {
        provider: { openrouter: { api: 'sk-or-v1-abcdef0123' } },
        model: 'anthropic/claude-sonnet-4',
      },
    };
    const out = redactSecrets(input) as {
      port: number;
      config: { provider: { openrouter: { api: string } }; model: string };
    };
    expect(out.config.provider.openrouter.api).toBe('[REDACTED]');
    expect(out.port).toBe(8080);
    expect(out.config.model).toBe('anthropic/claude-sonnet-4');
  });

  it('value-prefix detection covers common credential families', () => {
    const input = {
      openai: 'sk-abcdef0123',
      slack_bot: 'xoxb-12345-abcdef',
      gh_pat: 'ghp_abcdef0123',
      aws_key: 'AKIAIOSFODNN7EXAMPLE',
      google: 'AIzaSyDOCAbC123dEf456GhIJKL789MnoPQRsTUV',
    };
    const out = redactSecrets(input) as Record<string, string>;
    for (const v of Object.values(out)) expect(v).toBe('[REDACTED]');
  });

  it('does not false-positive on innocuous urls or substrings containing sk-', () => {
    // Anchored regex: `^sk-` only matches at string start, so URLs/text
    // that mention `sk-` mid-string pass through.
    const input = {
      docsUrl: 'https://platform.openai.com/docs/api-keys',
      note: 'use sk-... format for OpenAI keys',
      model: 'gpt-5',
    };
    expect(redactSecrets(input)).toEqual(input);
  });

  it('handles circular references without stack overflow', () => {
    const input: Record<string, unknown> = { name: 'server', apiKey: 'sk-xxx' };
    input.self = input;
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(out.name).toBe('server');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.self).toBe('[CIRCULAR]');
  });
});
