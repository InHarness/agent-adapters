// Unit tests for the image materialization helpers.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inferMediaType,
  assertAnthropicMediaType,
  readImageAsBase64,
  createImageWorkspace,
} from './images-tempdir.js';
import { AdapterError } from './types.js';

const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('inferMediaType', () => {
  it('maps common extensions', () => {
    expect(inferMediaType('/a/b/c.png')).toBe('image/png');
    expect(inferMediaType('photo.JPG')).toBe('image/jpeg');
    expect(inferMediaType('x.jpeg')).toBe('image/jpeg');
    expect(inferMediaType('y.webp')).toBe('image/webp');
    expect(inferMediaType('z.gif')).toBe('image/gif');
  });

  it('ignores query/fragment on urls', () => {
    expect(inferMediaType('https://host/img.png?v=2#frag')).toBe('image/png');
  });

  it('defaults to image/png for unknown extensions', () => {
    expect(inferMediaType('https://host/image')).toBe('image/png');
    expect(inferMediaType('file.xyz')).toBe('image/png');
  });
});

describe('assertAnthropicMediaType', () => {
  it('accepts the four Anthropic types (case-insensitive)', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'IMAGE/PNG']) {
      expect(() => assertAnthropicMediaType(t)).not.toThrow();
    }
  });

  it('throws AdapterError for unsupported types', () => {
    expect(() => assertAnthropicMediaType('image/svg+xml')).toThrow(AdapterError);
    expect(() => assertAnthropicMediaType('image/bmp')).toThrow(/Anthropic accepts only/);
  });
});

describe('readImageAsBase64', () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const d of created.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it('reads bytes as base64 and infers media type from extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'img-read-'));
    created.push(dir);
    const path = join(dir, 'pic.webp');
    await writeFile(path, Buffer.from(PNG_1PX_B64, 'base64'));

    const out = await readImageAsBase64(path);
    expect(out.mediaType).toBe('image/webp');
    expect(out.data).toBe(PNG_1PX_B64);
  });

  it('honors an explicit mediaType override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'img-read-'));
    created.push(dir);
    const path = join(dir, 'noext');
    await writeFile(path, Buffer.from(PNG_1PX_B64, 'base64'));

    const out = await readImageAsBase64(path, 'image/png');
    expect(out.mediaType).toBe('image/png');
  });
});

describe('createImageWorkspace', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not touch disk until first write (dir is null)', async () => {
    const ws = createImageWorkspace();
    expect(ws.dir).toBeNull();
    await ws.cleanup(); // no-op, must not throw
    expect(ws.dir).toBeNull();
  });

  it('writeBase64 writes decoded bytes with a mime-derived extension; cleanup removes the dir', async () => {
    const ws = createImageWorkspace();
    const path = await ws.writeBase64(PNG_1PX_B64, 'image/png');
    expect(path).toMatch(/\.png$/);
    expect(ws.dir).not.toBeNull();
    expect((await readFile(path)).toString('base64')).toBe(PNG_1PX_B64);

    await ws.cleanup();
    await expect(stat(ws.dir!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('download fetches to a temp file, using content-type then url for the extension', async () => {
    const bytes = Buffer.from(PNG_1PX_B64, 'base64');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'image/webp; charset=binary' },
        arrayBuffer: async () => bytes,
      })),
    );

    const ws = createImageWorkspace();
    const { path, mime } = await ws.download('https://host/image');
    expect(mime).toBe('image/webp');
    expect(path).toMatch(/\.webp$/);
    expect((await readFile(path)).toString('base64')).toBe(PNG_1PX_B64);
    await ws.cleanup();
  });

  it('download throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    const ws = createImageWorkspace();
    await expect(ws.download('https://host/missing.png')).rejects.toThrow(/404/);
    await ws.cleanup();
  });
});
