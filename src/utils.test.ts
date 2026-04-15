import { describe, it, expect } from 'vitest';
import { collectEvents, filterByType, takeUntilResult, splitBySubagent, extractText } from './utils.js';
import type { UnifiedEvent, NormalizedMessage } from './types.js';

const msg: NormalizedMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello' }],
  timestamp: new Date().toISOString(),
};

async function* fromArray(events: UnifiedEvent[]): AsyncIterable<UnifiedEvent> {
  for (const e of events) yield e;
}

describe('collectEvents', () => {
  it('collects all events', async () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'Hi', isSubagent: false },
      { type: 'result', output: 'Hi', rawMessages: [], usage: { inputTokens: 1, outputTokens: 1 } },
    ];
    const collected = await collectEvents(fromArray(events));
    expect(collected).toHaveLength(2);
  });
});

describe('filterByType', () => {
  it('yields only matching events', async () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'a', isSubagent: false },
      { type: 'thinking', text: 'b', isSubagent: false },
      { type: 'text_delta', text: 'c', isSubagent: false },
      { type: 'result', output: 'ac', rawMessages: [], usage: { inputTokens: 1, outputTokens: 1 } },
    ];
    const deltas: UnifiedEvent[] = [];
    for await (const e of filterByType(fromArray(events), 'text_delta')) {
      deltas.push(e);
    }
    expect(deltas).toHaveLength(2);
  });
});

describe('takeUntilResult', () => {
  it('stops after result event', async () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'a', isSubagent: false },
      { type: 'result', output: 'a', rawMessages: [], usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'text_delta', text: 'should not appear', isSubagent: false },
    ];
    const collected: UnifiedEvent[] = [];
    for await (const e of takeUntilResult(fromArray(events))) {
      collected.push(e);
    }
    expect(collected).toHaveLength(2);
    expect(collected[1].type).toBe('result');
  });
});

describe('splitBySubagent', () => {
  it('separates main and subagent events', async () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'main', isSubagent: false },
      { type: 'text_delta', text: 'sub', isSubagent: true },
      { type: 'subagent_started', taskId: 't1', description: 'test', toolUseId: 'tu1' },
      { type: 'result', output: 'main', rawMessages: [], usage: { inputTokens: 1, outputTokens: 1 } },
    ];
    const { main, subagent } = await splitBySubagent(fromArray(events));
    expect(main).toHaveLength(2); // text_delta(main) + result
    expect(subagent).toHaveLength(2); // text_delta(sub) + subagent_started
  });
});

describe('extractText', () => {
  it('returns result output when available', async () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'partial', isSubagent: false },
      { type: 'result', output: 'final output', rawMessages: [], usage: { inputTokens: 1, outputTokens: 1 } },
    ];
    const text = await extractText(fromArray(events));
    expect(text).toBe('final output');
  });

  it('falls back to text_delta concatenation', async () => {
    const events: UnifiedEvent[] = [
      { type: 'text_delta', text: 'hello ', isSubagent: false },
      { type: 'text_delta', text: 'world', isSubagent: false },
    ];
    const text = await extractText(fromArray(events));
    expect(text).toBe('hello world');
  });
});
