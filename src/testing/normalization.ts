// Normalization assertions — verify adapters map native SDK events into the
// unified `NormalizedMessage` / `ContentBlock` shape correctly. Used by both
// per-adapter normalization unit tests and E2E enrichment.

import { expect } from 'vitest';
import type { ContentBlock, NormalizedMessage, UnifiedEvent } from '../types.js';

/** Assert a NormalizedMessage has correct structure. */
export function assertNormalizedMessage(msg: NormalizedMessage): void {
  expect(msg.role).toMatch(/^(user|assistant)$/);
  expect(Array.isArray(msg.content)).toBe(true);
  expect(msg.content.length).toBeGreaterThanOrEqual(1);
  expect(typeof msg.timestamp).toBe('string');
  expect(msg.timestamp.length).toBeGreaterThan(0);

  for (const block of msg.content) {
    assertContentBlock(block);
  }
}

/** Assert a ContentBlock has correct structure for its type. */
export function assertContentBlock(block: ContentBlock): void {
  switch (block.type) {
    case 'text':
      expect(typeof block.text).toBe('string');
      break;
    case 'thinking':
      expect(typeof block.text).toBe('string');
      break;
    case 'toolUse':
      expect(typeof block.toolUseId).toBe('string');
      expect(block.toolUseId.length).toBeGreaterThan(0);
      expect(typeof block.toolName).toBe('string');
      expect(block.toolName.length).toBeGreaterThan(0);
      expect(typeof block.input).toBe('object');
      break;
    case 'toolResult':
      expect(typeof block.toolUseId).toBe('string');
      expect(block.toolUseId.length).toBeGreaterThan(0);
      expect(typeof block.content).toBe('string');
      break;
    case 'image':
      expect(block.source).toBeDefined();
      break;
  }
}

/** Partial match against a ContentBlock: only specified fields are compared. */
export type ExpectedBlock = Partial<ContentBlock> & { type: ContentBlock['type'] };

export interface NormalizationExpectation {
  /**
   * Expected content blocks, in order. Matched against the flattened sequence
   * of blocks across all `rawMessages` (filtered by `role` if provided).
   * Only the fields present on each expected block are compared — extras on the
   * actual block are allowed.
   */
  blocks: ExpectedBlock[];
  /** If set, only consider rawMessages with this role for the block match. */
  role?: 'user' | 'assistant';
  /** If true, every matched-against message must carry a `native` field. */
  hasNative?: boolean;
  /** If true, every matched-against message must have `subagentTaskId` set. */
  hasSubagentTaskId?: boolean;
}

/**
 * Verify that the events stream produced by an adapter normalizes correctly
 * into `NormalizedMessage`s with the expected `ContentBlock` sequence.
 *
 * Pulls `rawMessages` from the terminal `result` event, optionally filters by
 * role, then walks the flattened block stream looking for the expected blocks
 * in the given order. Each expected block is a partial match (type required,
 * other fields compared only when present).
 *
 * Falls back to scanning `assistant_message` events if no `result` is present
 * (useful for tests that abort before completion).
 */
export function assertNormalization(events: UnifiedEvent[], expected: NormalizationExpectation): void {
  const result = events.find((e) => e.type === 'result') as
    | Extract<UnifiedEvent, { type: 'result' }>
    | undefined;

  let messages: NormalizedMessage[];
  if (result) {
    messages = result.rawMessages;
  } else {
    messages = events
      .filter((e): e is Extract<UnifiedEvent, { type: 'assistant_message' }> => e.type === 'assistant_message')
      .map((e) => e.message);
  }

  expect(messages.length, 'expected ≥1 NormalizedMessage to match against').toBeGreaterThanOrEqual(1);
  for (const msg of messages) {
    assertNormalizedMessage(msg);
  }

  const considered = expected.role ? messages.filter((m) => m.role === expected.role) : messages;
  expect(
    considered.length,
    `expected ≥1 NormalizedMessage with role=${expected.role ?? 'any'}`,
  ).toBeGreaterThanOrEqual(1);

  if (expected.hasNative) {
    for (const m of considered) {
      expect(m.native, `NormalizedMessage missing 'native' field`).toBeDefined();
    }
  }
  if (expected.hasSubagentTaskId) {
    for (const m of considered) {
      expect(typeof m.subagentTaskId, `NormalizedMessage missing 'subagentTaskId'`).toBe('string');
    }
  }

  const actualBlocks: ContentBlock[] = considered.flatMap((m) => m.content);

  let cursor = 0;
  for (const want of expected.blocks) {
    let found = -1;
    for (let i = cursor; i < actualBlocks.length; i++) {
      if (matchesBlock(actualBlocks[i], want)) {
        found = i;
        break;
      }
    }
    expect(
      found,
      `expected block ${describeExpected(want)} not found at or after position ${cursor}. Actual blocks: ${actualBlocks
        .map(describeActual)
        .join(' → ')}`,
    ).toBeGreaterThanOrEqual(0);
    cursor = found + 1;
  }
}

function matchesBlock(actual: ContentBlock, want: ExpectedBlock): boolean {
  if (actual.type !== want.type) return false;
  for (const key of Object.keys(want) as Array<keyof ExpectedBlock>) {
    if (key === 'type') continue;
    const wantVal = (want as Record<string, unknown>)[key];
    const actualVal = (actual as unknown as Record<string, unknown>)[key];
    if (wantVal === undefined) continue;
    if (typeof wantVal === 'object' && wantVal !== null) {
      if (JSON.stringify(actualVal) !== JSON.stringify(wantVal)) return false;
    } else if (actualVal !== wantVal) {
      return false;
    }
  }
  return true;
}

function describeExpected(b: ExpectedBlock): string {
  const extra = Object.entries(b)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
  return extra ? `${b.type}(${extra})` : b.type;
}

function describeActual(b: ContentBlock): string {
  switch (b.type) {
    case 'text':
      return `text("${b.text.slice(0, 20)}")`;
    case 'thinking':
      return `thinking("${b.text.slice(0, 20)}")`;
    case 'toolUse':
      return `toolUse(${b.toolName})`;
    case 'toolResult':
      return `toolResult(${b.toolUseId.slice(0, 8)}${b.isError ? ',err' : ''})`;
    case 'image':
      return `image(${b.source.type})`;
  }
}
