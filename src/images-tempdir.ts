// Helpers for delivering RuntimeExecuteParams.images to adapters whose SDK does
// not accept the image source verbatim.
//
// Three source shapes (see ImageInput): inline `base64`, a remote `url`, and a
// local `file` path. Adapters consume them differently:
//   - claude-code / gemini accept base64 + url natively → only `file` needs a read.
//   - codex accepts ONLY a local file path → base64 is written to a temp file and
//     url is downloaded to one.
//   - opencode accepts a `file` part with a url → base64/file become `file://…`.
//
// `createImageWorkspace()` is the temp-dir manager, modeled on skills-tempdir.ts:
// created lazily (only when an adapter actually needs a file on disk) and removed
// in the adapter's `finally`. Cleanup is idempotent — `force: true` swallows ENOENT.

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import type { ImageInput } from './types.js';
import { AdapterError } from './types.js';

/** MIME types Anthropic accepts for a base64 image source. */
const ANTHROPIC_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.avif': 'image/avif',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
  'image/avif': '.avif',
};

/** Infer an image MIME type from a path or URL's extension; default image/png. */
export function inferMediaType(pathOrUrl: string): string {
  // Strip any query/fragment before reading the extension.
  const clean = pathOrUrl.split(/[?#]/, 1)[0]!;
  const ext = extname(clean).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'image/png';
}

/** A filesystem-safe extension for a MIME type (default .png). */
function extForMime(mediaType: string): string {
  return MIME_TO_EXT[mediaType.toLowerCase()] ?? '.png';
}

/**
 * Throw if `mediaType` is not one Anthropic accepts. claude-code only — other
 * adapters tolerate any image MIME type.
 */
export function assertAnthropicMediaType(mediaType: string): void {
  if (!ANTHROPIC_MEDIA_TYPES.has(mediaType.toLowerCase())) {
    throw new AdapterError(
      `Unsupported image mediaType "${mediaType}". Anthropic accepts only ` +
        `image/jpeg, image/png, image/gif, image/webp.`,
      'claude-code',
    );
  }
}

/** Read a local image file and return it as base64 plus an inferred MIME type. */
export async function readImageAsBase64(
  path: string,
  mediaType?: string,
): Promise<{ mediaType: string; data: string }> {
  const buf = await readFile(path);
  return {
    mediaType: mediaType ?? inferMediaType(path),
    data: buf.toString('base64'),
  };
}

export interface ImageWorkspace {
  /** Absolute path to the per-call temp dir (created on first write/download). */
  readonly dir: string | null;
  /** Write base64 bytes to a temp file and return its absolute path. */
  writeBase64(data: string, mediaType: string): Promise<string>;
  /**
   * Download a remote image to a temp file. Returns the absolute path and the
   * MIME type (from the response's content-type, else inferred from the URL).
   * Honors `signal` so an aborted/timed-out call does not hang.
   */
  download(url: string, signal?: AbortSignal): Promise<{ path: string; mime: string }>;
  /** Remove the temp dir. Idempotent; no-op if nothing was ever written. */
  cleanup(): Promise<void>;
}

/**
 * Lazily-created temp dir for materializing images. Nothing touches disk until
 * the first `writeBase64`/`download`, so adapters that take images natively
 * (claude-code, gemini) never create a dir.
 */
export function createImageWorkspace(): ImageWorkspace {
  let dir: string | null = null;

  async function ensureDir(): Promise<string> {
    if (dir === null) {
      dir = await mkdtemp(join(tmpdir(), 'agent-adapters-images-'));
    }
    return dir;
  }

  return {
    get dir() {
      return dir;
    },
    async writeBase64(data, mediaType) {
      const root = await ensureDir();
      const path = join(root, `${randomUUID()}${extForMime(mediaType)}`);
      await writeFile(path, Buffer.from(data, 'base64'));
      return path;
    },
    async download(url, signal) {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        throw new Error(`Failed to download image (${res.status}) from ${url}`);
      }
      const mime = res.headers.get('content-type')?.split(';', 1)[0]?.trim() || inferMediaType(url);
      const root = await ensureDir();
      const path = join(root, `${randomUUID()}${extForMime(mime)}`);
      await writeFile(path, Buffer.from(await res.arrayBuffer()));
      return { path, mime };
    },
    async cleanup() {
      if (dir !== null) {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
