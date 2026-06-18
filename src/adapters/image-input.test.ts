// Unit tests for per-adapter image-input conversion. Each adapter's build helper
// is exercised directly (the SDKs are lazy-loaded inside execute(), so importing
// the adapter module and calling a pure build function never touches an SDK).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ImageInput } from '../types.js';
import type { ImageWorkspace } from '../images-tempdir.js';
import { buildClaudeImageBlocks } from './claude-code.js';
import { buildCodexInput } from './codex.js';
import { buildGeminiImageParts } from './gemini.js';
import { buildOpencodeFileParts } from './opencode.js';

const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Deterministic stub so tests assert mapping logic without disk/network.
const stubWorkspace: ImageWorkspace = {
  dir: null,
  async writeBase64(_data, mediaType) {
    return `/tmp/stub/written.${mediaType.split('/')[1]}`;
  },
  async download(_url) {
    return { path: '/tmp/stub/downloaded.png', mime: 'image/png' };
  },
  async cleanup() {},
};

const created: string[] = [];
afterEach(async () => {
  for (const d of created.splice(0)) await rm(d, { recursive: true, force: true });
});

async function makeTempImage(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'img-adapter-'));
  created.push(dir);
  const path = join(dir, name);
  await writeFile(path, Buffer.from(PNG_1PX_B64, 'base64'));
  return path;
}

describe('claude-code: buildClaudeImageBlocks', () => {
  it('base64 → native base64 image block', async () => {
    const blocks = await buildClaudeImageBlocks([
      { type: 'base64', mediaType: 'image/png', data: PNG_1PX_B64 },
    ]);
    expect(blocks).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX_B64 } },
    ]);
  });

  it('url → native url image block', async () => {
    const blocks = await buildClaudeImageBlocks([{ type: 'url', url: 'https://h/i.png' }]);
    expect(blocks).toEqual([{ type: 'image', source: { type: 'url', url: 'https://h/i.png' } }]);
  });

  it('file → read and inlined as base64', async () => {
    const path = await makeTempImage('a.png');
    const blocks = await buildClaudeImageBlocks([{ type: 'file', path }]);
    expect(blocks).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX_B64 } },
    ]);
  });

  it('rejects a mediaType Anthropic does not accept', async () => {
    await expect(
      buildClaudeImageBlocks([{ type: 'base64', mediaType: 'image/svg+xml', data: 'x' }]),
    ).rejects.toThrow(/Anthropic accepts only/);
  });
});

describe('codex: buildCodexInput', () => {
  it('no images → returns the prompt string unchanged (text fast path)', async () => {
    const input = await buildCodexInput('hello', undefined, stubWorkspace);
    expect(input).toBe('hello');
  });

  it('empty images → returns the prompt string unchanged', async () => {
    const input = await buildCodexInput('hello', [], stubWorkspace);
    expect(input).toBe('hello');
  });

  it('file → local_image with the path passed through, after the text part', async () => {
    const input = await buildCodexInput('hi', [{ type: 'file', path: '/abs/x.png' }], stubWorkspace);
    expect(input).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'local_image', path: '/abs/x.png' },
    ]);
  });

  it('base64 → materialized to a local file path', async () => {
    const input = await buildCodexInput(
      'hi',
      [{ type: 'base64', mediaType: 'image/png', data: PNG_1PX_B64 }],
      stubWorkspace,
    );
    expect(input).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'local_image', path: '/tmp/stub/written.png' },
    ]);
  });

  it('url → downloaded to a local file path', async () => {
    const input = await buildCodexInput('hi', [{ type: 'url', url: 'https://h/i.png' }], stubWorkspace);
    expect(input).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'local_image', path: '/tmp/stub/downloaded.png' },
    ]);
  });
});

describe('gemini: buildGeminiImageParts', () => {
  it('base64 → inline media data part', async () => {
    const parts = await buildGeminiImageParts([
      { type: 'base64', mediaType: 'image/png', data: PNG_1PX_B64 },
    ]);
    expect(parts).toEqual([{ type: 'media', data: PNG_1PX_B64, mimeType: 'image/png' }]);
  });

  it('url → media uri part with inferred mime', async () => {
    const parts = await buildGeminiImageParts([{ type: 'url', url: 'https://h/i.webp' }]);
    expect(parts).toEqual([{ type: 'media', uri: 'https://h/i.webp', mimeType: 'image/webp' }]);
  });

  it('file → inline media data read from disk', async () => {
    const path = await makeTempImage('b.gif');
    const parts = await buildGeminiImageParts([{ type: 'file', path }]);
    expect(parts).toEqual([{ type: 'media', data: PNG_1PX_B64, mimeType: 'image/gif' }]);
  });
});

describe('opencode: buildOpencodeFileParts', () => {
  it('url → file part with passthrough url and inferred mime', async () => {
    const parts = await buildOpencodeFileParts([{ type: 'url', url: 'https://h/i.png' }], stubWorkspace);
    expect(parts).toEqual([{ type: 'file', mime: 'image/png', url: 'https://h/i.png' }]);
  });

  it('file → file:// url with basename and inferred mime', async () => {
    const path = await makeTempImage('c.jpeg');
    const parts = await buildOpencodeFileParts([{ type: 'file', path }], stubWorkspace);
    expect(parts).toEqual([
      { type: 'file', mime: 'image/jpeg', filename: 'c.jpeg', url: pathToFileURL(path).href },
    ]);
  });

  it('base64 → materialized temp file referenced as file://', async () => {
    const parts = await buildOpencodeFileParts(
      [{ type: 'base64', mediaType: 'image/png', data: PNG_1PX_B64 }],
      stubWorkspace,
    );
    expect(parts).toEqual([
      {
        type: 'file',
        mime: 'image/png',
        filename: 'written.png',
        url: pathToFileURL('/tmp/stub/written.png').href,
      },
    ]);
  });

  it('relative file path is resolved to an absolute file:// url', async () => {
    const parts = (await buildOpencodeFileParts(
      [{ type: 'file', path: 'rel/pic.png' }],
      stubWorkspace,
    )) as Array<{ url: string }>;
    expect(parts[0].url.startsWith('file:///')).toBe(true);
    expect(parts[0].url.endsWith('/rel/pic.png')).toBe(true);
  });
});

// Type-only guard: ImageInput stays a closed union of the three sources.
it('ImageInput union shape', () => {
  const samples: ImageInput[] = [
    { type: 'base64', mediaType: 'image/png', data: 'x' },
    { type: 'url', url: 'https://h/i.png' },
    { type: 'file', path: '/x.png' },
    { type: 'file', path: '/x', mediaType: 'image/png' },
  ];
  expect(samples).toHaveLength(4);
});
