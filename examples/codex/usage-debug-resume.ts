// Codex: per-execute() usage across a resumed session, with debug logging on.
// Reproduces the cumulative-as-delta diagnostic flow from
// .claude/skills/codex-sdk/SKILL.md (quirk #9). Two turns on the same thread:
// turn 1 generates the FIRST Lorem Ipsum paragraph, turn 2 resumes and asks
// for the SECOND. Stderr will print the raw SDK usage and the adapter's
// per-execute() delta for each turn so you can see exactly what the LLM
// server returned vs what the adapter emitted.
//
// Usage: npx tsx examples/codex/usage-debug-resume.ts
// Auth:  OPENAI_API_KEY env var, OR local ChatGPT OAuth via `codex login`
//
// What to watch in stderr (lines prefixed `[agent-adapters codex]`):
//   - turn 1: priorSource='zero-fallback', emittedDelta == rawSdkUsage
//   - turn 2 WITH priorUsage:    priorSource='params', emittedDelta is the
//                                true per-call delta (small, stable)
//   - turn 2 WITHOUT priorUsage: priorSource='lru' if same process kept the
//                                LRU, OR 'zero-fallback' if you ran turn 2
//                                in a fresh process (the cross-process bug)

// Turn debug logging on for this run. The adapter checks this env var before
// printing anything, so without it the run stays quiet.
process.env.AGENT_ADAPTERS_DEBUG_USAGE = '1';

import { createAdapter, getModelContextWindow } from '../../src/index.js';
import type { UsageStats } from '../../src/index.js';

const FIRST_PROMPT =
  'Output the FIRST paragraph of the classic Lorem Ipsum, verbatim, with no commentary or surrounding text.';
const SECOND_PROMPT =
  'Now output the SECOND paragraph of the classic Lorem Ipsum, verbatim, with no commentary or surrounding text.';

async function runTurn(params: {
  label: string;
  prompt: string;
  resumeSessionId?: string;
  priorUsage?: UsageStats;
}): Promise<{
  text: string;
  sessionId?: string;
  usage: UsageStats;
  contextSize: number;
  // The raw cumulative reported by the SDK at the end of this turn — the
  // adapter doesn't expose this in result events, so we reconstruct it
  // ourselves: cumulative = (caller's prior or {0,0}) + emitted delta.
  cumulative: UsageStats;
}> {
  const adapter = createAdapter('codex');
  const prior = params.priorUsage ?? { inputTokens: 0, outputTokens: 0 };

  console.log(`\n=== ${params.label} ===`);
  console.log(`prompt: ${params.prompt.slice(0, 80)}…`);
  if (params.resumeSessionId) {
    console.log(`resumeSessionId: ${params.resumeSessionId}`);
  }
  if (params.priorUsage) {
    console.log(
      `priorUsage passed: in=${params.priorUsage.inputTokens} out=${params.priorUsage.outputTokens}`,
    );
  }
  console.log('--- model output ---');

  let text = '';
  let sessionId: string | undefined;
  let usage: UsageStats = { inputTokens: 0, outputTokens: 0 };
  let contextSize = 0;

  for await (const event of adapter.execute({
    prompt: params.prompt,
    systemPrompt: 'Be concise. Output only what is asked, with no extra explanation.',
    model: 'gpt-5.4',
    maxTurns: 1,
    resumeSessionId: params.resumeSessionId,
    priorUsage: params.priorUsage,
    architectureConfig: {
      codex_sandboxMode: 'read-only',
    },
  })) {
    switch (event.type) {
      case 'text_delta':
        text += event.text;
        process.stdout.write(event.text);
        break;
      case 'result':
        sessionId = event.sessionId;
        usage = event.usage;
        contextSize = event.contextSize;
        break;
      case 'error':
        console.error('\n[error]', event.error.message);
        break;
    }
  }

  const cumulative: UsageStats = {
    inputTokens: prior.inputTokens + usage.inputTokens,
    outputTokens: prior.outputTokens + usage.outputTokens,
    ...((prior.cacheReadInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) > 0
      ? {
          cacheReadInputTokens:
            (prior.cacheReadInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0),
        }
      : {}),
  };

  // Split inputTokens into "fresh" (sent to LLM at full price) and "cached"
  // (cache reads, discounted). OpenAI convention: cached_input_tokens IS a
  // subset of input_tokens, not a separate bucket. So fresh = in - cached.
  const callCached = usage.cacheReadInputTokens ?? 0;
  const callFresh = usage.inputTokens - callCached;
  const cumCached = cumulative.cacheReadInputTokens ?? 0;
  const cumFresh = cumulative.inputTokens - cumCached;

  console.log('\n--- result ---');
  console.log(`sessionId:  ${sessionId ?? '(none)'}`);
  console.log(
    `per-call BILLING:   in=${usage.inputTokens} (fresh=${callFresh}, cached=${callCached}) out=${usage.outputTokens}`,
  );
  console.log(
    `cumulative BILLING: in=${cumulative.inputTokens} (fresh=${cumFresh}, cached=${cumCached}) out=${cumulative.outputTokens}`,
  );
  console.log(`CONTEXT WINDOW after this turn: ${contextSize} tokens`);

  return { text, sessionId, usage, contextSize, cumulative };
}

async function main() {
  // Turn 1: fresh thread. priorUsage is implicit zero — adapter starts a new
  // Codex thread and reports the SDK's first cumulative as the delta (correct,
  // because there's nothing before it).
  const turn1 = await runTurn({
    label: 'TURN 1 — first Lorem Ipsum paragraph (fresh thread)',
    prompt: FIRST_PROMPT,
  });

  if (!turn1.sessionId) {
    console.error('\nTurn 1 returned no sessionId — cannot resume.');
    return;
  }

  // Turn 2: resume the same thread and ask for the second paragraph. We pass
  // turn1.cumulative as priorUsage so the adapter's subtractUsage produces
  // the *true* per-call delta even if this were running in a fresh process.
  // To see the bug instead (cumulative-as-delta), comment out priorUsage.
  const turn2 = await runTurn({
    label: 'TURN 2 — second paragraph (resumed, priorUsage passed)',
    prompt: SECOND_PROMPT,
    resumeSessionId: turn1.sessionId,
    priorUsage: turn1.cumulative,
  });

  const fmt = (u: UsageStats): string => {
    const cached = u.cacheReadInputTokens ?? 0;
    const fresh = u.inputTokens - cached;
    return `in=${u.inputTokens.toString().padStart(6)} (fresh=${fresh.toString().padStart(5)}, cached=${cached.toString().padStart(5)}) out=${u.outputTokens.toString().padStart(4)}`;
  };

  // gpt-5.4 / gpt-5-codex windows are 400k. Fall back to a sane default if the
  // model is unknown to the model registry.
  const window = getModelContextWindow('codex', 'gpt-5.4') ?? 400_000;
  const pct = (n: number): string => `${((n / window) * 100).toFixed(2)}%`;

  console.log('\n=== summary ===');
  console.log('USAGE BILLING TOKENS — what OpenAI bills you (replay re-billed at cache rate):');
  console.log(`  turn 1 per-call: ${fmt(turn1.usage)}`);
  console.log(`  turn 2 per-call: ${fmt(turn2.usage)}`);
  console.log(`  session total:   ${fmt(turn2.cumulative)}`);
  console.log(
    `\nUSAGE CONTEXT WINDOW — tokens in the model's window (cap ${window.toLocaleString()}):`,
  );
  console.log(
    `  after turn 1: ${turn1.contextSize.toLocaleString()} (${pct(turn1.contextSize)} of window)`,
  );
  console.log(
    `  after turn 2: ${turn2.contextSize.toLocaleString()} (${pct(turn2.contextSize)} of window)`,
  );
  console.log(
    '  ↑ grows by ~size of the new exchange each turn (tens to hundreds of tokens),',
  );
  console.log(
    '    NOT by the size of the replayed history. This is what an IDE-style',
  );
  console.log(
    '    "X / 400k" utilization bar should show.',
  );
  console.log(
    '\nNotes:',
  );
  console.log(
    '- BILLING and CONTEXT WINDOW are different metrics:',
  );
  console.log(
    '    • CONTEXT WINDOW is bounded by the model (400k here) — when full, compact.',
  );
  console.log(
    '    • BILLING is unbounded across turns — every resumed call re-bills the',
  );
  console.log(
    '      replayed history (mostly as cache reads at a discounted rate).',
  );
  console.log(
    '- "cached" tokens come from OpenAI prompt cache (replayed thread history)',
  );
  console.log(
    '  and are billed at a fraction of the normal input rate. OpenAI convention:',
  );
  console.log(
    '  cached_input_tokens is a SUBSET of input_tokens, not a separate bucket.',
  );
  console.log(
    '- If turn 2 fresh ≈ turn 1 fresh, the per-call delta is correct — only your',
  );
  console.log(
    '  new prompt + the small uncached delta from replay was billed at full rate.',
  );
  console.log(
    '- USD cost: claude-code SDK exposes total_cost_usd natively; OpenAI does not.',
  );
  console.log(
    '  Estimate from token counts × OpenAI pricing for the model.',
  );
}

main().catch((err) => {
  console.error('\nfatal:', err);
  process.exit(1);
});
