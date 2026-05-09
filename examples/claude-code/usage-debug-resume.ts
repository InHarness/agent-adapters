// Claude Code: per-execute() usage across a resumed session — parallel to
// examples/codex/usage-debug-resume.ts so the two adapters can be compared on
// the same prompts and same metrics (USAGE BILLING TOKENS vs USAGE CONTEXT
// WINDOW). Two turns on the same session: turn 1 generates the FIRST Lorem
// Ipsum paragraph, turn 2 resumes and asks for the SECOND.
//
// Why claude-code is much simpler than codex here:
//   - The Anthropic SDK reports per-execute() usage natively. There is no
//     cumulative-as-delta conversion, no module-LRU, no priorUsage plumbing.
//     Per-turn `result.usage` is exactly what was billed for that call.
//   - The unified `result.contextSize` is computed identically across all
//     adapters: usage.inputTokens + usage.outputTokens after THIS turn.
//
// Usage: npx tsx examples/claude-code/usage-debug-resume.ts
// Auth:  local Anthropic OAuth (set up via Claude Code CLI). ANTHROPIC_API_KEY
//        is optional — the adapter does not require it.
//
// Debug logging: stderr lines prefixed `[agent-adapters claude-code] result`
// show the raw SDK usage shape (Anthropic's three additive input buckets)
// and the normalized emit (rolled into a single inputTokens, OpenAI
// convention). Useful for verifying contextSize / fresh math after the
// normalize fix. Mirrors AGENT_ADAPTERS_DEBUG_USAGE in the codex adapter.
process.env.AGENT_ADAPTERS_DEBUG_USAGE = '1';

import { createAdapter, getModelContextWindow } from '../../src/index.js';
import type { UsageStats } from '../../src/index.js';

const FIRST_PROMPT =
  'Output the FIRST paragraph of the classic Lorem Ipsum, verbatim, with no commentary or surrounding text.';
const SECOND_PROMPT =
  'Now output the SECOND paragraph of the classic Lorem Ipsum, verbatim, with no commentary or surrounding text.';

const MODEL = 'sonnet-4.6';

async function runTurn(params: {
  label: string;
  prompt: string;
  resumeSessionId?: string;
}): Promise<{
  text: string;
  sessionId?: string;
  usage: UsageStats;
  contextSize: number;
}> {
  const adapter = createAdapter('claude-code');

  console.log(`\n=== ${params.label} ===`);
  console.log(`prompt: ${params.prompt.slice(0, 80)}…`);
  if (params.resumeSessionId) {
    console.log(`resumeSessionId: ${params.resumeSessionId}`);
  }
  console.log('--- model output ---');

  let text = '';
  let sessionId: string | undefined;
  let usage: UsageStats = { inputTokens: 0, outputTokens: 0 };
  let contextSize = 0;

  for await (const event of adapter.execute({
    prompt: params.prompt,
    systemPrompt: 'Be concise. Output only what is asked, with no extra explanation.',
    model: MODEL,
    // Intentionally NOT setting maxTurns: claude-code SDK's Options.maxTurns
    // counts CUMULATIVELY across a resumed session (prior turns from the
    // session are loaded into the counter), not per-execute() call. Passing
    // maxTurns: 1 here would error on turn 2 with "Reached maximum number of
    // turns (1)" because the counter already includes turn 1 from the resumed
    // session. See claude-code-sdk SKILL.md quirk on maxTurns + resume.
    resumeSessionId: params.resumeSessionId,
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

  // Cache split — same convention as Codex: cacheReadInputTokens is a SUBSET
  // of inputTokens, not a separate bucket. Anthropic also exposes
  // cacheCreationInputTokens (tokens that wrote to cache); we surface both.
  const cached = usage.cacheReadInputTokens ?? 0;
  const cacheWrites = usage.cacheCreationInputTokens ?? 0;
  const fresh = usage.inputTokens - cached - cacheWrites;

  console.log('\n--- result ---');
  console.log(`sessionId:  ${sessionId ?? '(none)'}`);
  console.log(
    `per-call BILLING:   in=${usage.inputTokens} (fresh=${fresh}, cacheRead=${cached}, cacheWrite=${cacheWrites}) out=${usage.outputTokens}`,
  );
  console.log(`CONTEXT WINDOW after this turn: ${contextSize} tokens`);

  return { text, sessionId, usage, contextSize };
}

async function main() {
  const turn1 = await runTurn({
    label: 'TURN 1 — first Lorem Ipsum paragraph (fresh session)',
    prompt: FIRST_PROMPT,
  });

  if (!turn1.sessionId) {
    console.error('\nTurn 1 returned no sessionId — cannot resume.');
    return;
  }

  const turn2 = await runTurn({
    label: 'TURN 2 — second paragraph (resumed)',
    prompt: SECOND_PROMPT,
    resumeSessionId: turn1.sessionId,
  });

  const fmt = (u: UsageStats): string => {
    const cached = u.cacheReadInputTokens ?? 0;
    const cacheWrites = u.cacheCreationInputTokens ?? 0;
    const fresh = u.inputTokens - cached - cacheWrites;
    return (
      `in=${u.inputTokens.toString().padStart(6)} ` +
      `(fresh=${fresh.toString().padStart(5)}, ` +
      `cacheRead=${cached.toString().padStart(5)}, ` +
      `cacheWrite=${cacheWrites.toString().padStart(5)}) ` +
      `out=${u.outputTokens.toString().padStart(4)}`
    );
  };

  // claude-code's per-call `usage` is already per-execute(), so summing across
  // turns gives the session-level billing total directly (no subtract needed).
  const sessionBilling: UsageStats = {
    inputTokens: turn1.usage.inputTokens + turn2.usage.inputTokens,
    outputTokens: turn1.usage.outputTokens + turn2.usage.outputTokens,
    cacheReadInputTokens:
      (turn1.usage.cacheReadInputTokens ?? 0) + (turn2.usage.cacheReadInputTokens ?? 0),
    cacheCreationInputTokens:
      (turn1.usage.cacheCreationInputTokens ?? 0) + (turn2.usage.cacheCreationInputTokens ?? 0),
  };

  const window = getModelContextWindow('claude-code', MODEL) ?? 200_000;
  const pct = (n: number): string => `${((n / window) * 100).toFixed(2)}%`;

  console.log('\n=== summary ===');
  console.log('USAGE BILLING TOKENS — what Anthropic bills you:');
  console.log(`  turn 1 per-call: ${fmt(turn1.usage)}`);
  console.log(`  turn 2 per-call: ${fmt(turn2.usage)}`);
  console.log(`  session total:   ${fmt(sessionBilling)}`);
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
    '    NOT by the size of the replayed history. Same identity as Codex despite',
  );
  console.log(
    '    Anthropic\'s SDK reporting per-call (not cumulative): contextSize = ',
  );
  console.log(
    '    inputTokens + outputTokens after THIS turn.',
  );
  console.log(
    '\nNotes:',
  );
  console.log(
    '- No priorUsage plumbing here: Anthropic SDK reports per-call usage natively,',
  );
  console.log(
    '  so each result.usage is the cost of THAT turn alone. To get session-level',
  );
  console.log(
    '  billing, sum across turns yourself (sumUsage from the public API).',
  );
  console.log(
    '- Anthropic exposes both cacheReadInputTokens (replayed history hit) and',
  );
  console.log(
    '  cacheCreationInputTokens (this turn wrote new cache entries). OpenAI/Codex',
  );
  console.log(
    '  only reports cache reads; cache writes are not surfaced separately.',
  );
  console.log(
    '- USD cost: the underlying @anthropic-ai/claude-agent-sdk emits total_cost_usd',
  );
  console.log(
    '  natively on its ResultMessage. The agent-adapters library does not surface',
  );
  console.log(
    '  it on UnifiedEvent — sum tokens × Anthropic pricing yourself if you need it.',
  );
}

main().catch((err) => {
  console.error('\nfatal:', err);
  process.exit(1);
});
