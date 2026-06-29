import { describe, it, expect } from 'vitest';
import { architectureCapabilities } from './capabilities.js';

describe('architectureCapabilities — pathScope', () => {
  it('advertises pathScope per the support matrix', () => {
    expect(architectureCapabilities('claude-code').pathScope).toBe(true);
    expect(architectureCapabilities('claude-code-ollama').pathScope).toBe(true);
    expect(architectureCapabilities('claude-code-minimax').pathScope).toBe(true);
    expect(architectureCapabilities('codex').pathScope).toBe(true);
    expect(architectureCapabilities('gemini').pathScope).toBe(true);
    expect(architectureCapabilities('opencode').pathScope).toBe(false);
    expect(architectureCapabilities('opencode-openrouter').pathScope).toBe(false);
  });

  it('defaults pathScope to false for unknown architectures', () => {
    // @ts-expect-error — exercising the runtime fallback for a custom architecture
    expect(architectureCapabilities('does-not-exist').pathScope).toBe(false);
  });
});
