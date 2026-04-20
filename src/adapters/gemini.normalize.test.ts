// Unit tests: gemini adapter native SDK parts → unified ContentBlock.
// Pure-function level — no SDK calls.

import { describe, it, expect } from 'vitest';
import { contentPartsToBlocks } from './gemini.js';

describe('contentPartsToBlocks (gemini)', () => {
  it('maps part.type=text → text block', () => {
    expect(contentPartsToBlocks([{ type: 'text', text: 'hi' }])).toEqual([
      { type: 'text', text: 'hi' },
    ]);
  });

  it('maps part.type=thought → thinking block (uses .thought field, not .text)', () => {
    expect(contentPartsToBlocks([{ type: 'thought', thought: 'planning…' }])).toEqual([
      { type: 'thinking', text: 'planning…' },
    ]);
  });

  it('maps media with inline data → image block (base64 source)', () => {
    const out = contentPartsToBlocks([
      { type: 'media', mimeType: 'image/jpeg', data: 'AAAA' },
    ]);
    expect(out).toEqual([
      {
        type: 'image',
        source: { type: 'base64', mediaType: 'image/jpeg', data: 'AAAA' },
      },
    ]);
  });

  it('defaults media mimeType to image/png when missing', () => {
    const out = contentPartsToBlocks([{ type: 'media', data: 'BBBB' }]);
    expect(out[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', mediaType: 'image/png', data: 'BBBB' },
    });
  });

  it('maps media with uri → image block (url source)', () => {
    const out = contentPartsToBlocks([
      { type: 'media', uri: 'https://example.com/x.png' },
    ]);
    expect(out).toEqual([
      { type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } },
    ]);
  });

  it('skips media parts with neither data nor uri', () => {
    expect(contentPartsToBlocks([{ type: 'media' }])).toEqual([]);
  });

  it('preserves order across mixed part types', () => {
    const out = contentPartsToBlocks([
      { type: 'thought', thought: 'plan' },
      { type: 'text', text: 'answer' },
      { type: 'media', uri: 'https://x/y.png' },
    ]);
    expect(out.map((b) => b.type)).toEqual(['thinking', 'text', 'image']);
  });

  it('returns empty for empty input', () => {
    expect(contentPartsToBlocks([])).toEqual([]);
  });

  it('silently drops unknown part types', () => {
    const out = contentPartsToBlocks([
      { type: 'text', text: 'keep' },
      { type: 'function_call_response', payload: 'drop' },
    ]);
    expect(out).toEqual([{ type: 'text', text: 'keep' }]);
  });
});
