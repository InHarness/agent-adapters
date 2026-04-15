import { describe, it, expect } from 'vitest';
import { createAdapter, registerAdapter, listArchitectures } from './factory.js';
import { MockAdapter } from './testing/helpers.js';

describe('factory', () => {
  it('creates builtin adapters', () => {
    const adapter = createAdapter('claude-code');
    expect(adapter.architecture).toBe('claude-code');
  });

  it('creates claude-code-ollama variant', () => {
    const adapter = createAdapter('claude-code-ollama');
    expect(adapter.architecture).toBe('claude-code-ollama');
  });

  it('throws for unknown architecture', () => {
    expect(() => createAdapter('nonexistent')).toThrow('Unknown architecture');
  });

  it('supports custom adapter registration', () => {
    registerAdapter('custom-test', () => new MockAdapter('custom-test', []));
    const adapter = createAdapter('custom-test');
    expect(adapter.architecture).toBe('custom-test');
  });

  it('lists all architectures', () => {
    const archs = listArchitectures();
    expect(archs).toContain('claude-code');
    expect(archs).toContain('codex');
    expect(archs).toContain('opencode');
    expect(archs).toContain('gemini');
  });
});
