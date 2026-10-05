// Probe: does claude-code honour a FRESH tool policy on a resumed session?
// Shows: disallowedToolGroups + resumeSessionId, observed via adapter_ready.sdkConfig,
//        the UnifiedEvent stream, and — decisively — the files left on disk.
// Usage: npx tsx examples/advanced/tool-policy-resume-probe.ts
// Auth: SDK-managed OAuth (claude login) or ANTHROPIC_API_KEY
// Output: human log on stdout + full JSON dump at $PROBE_OUT (default: os.tmpdir()).
//
// Scenarios (same deterministic prompt every turn, only the file name differs):
//   A  control   — new session, deny from the start            → file must NOT exist
//   B  tighten   — T1 no deny (file exists), T2 resume + deny  → exists = old policy replayed
//   C  loosen    — T1 deny (no file),       T2 resume, no deny → exists = fresh policy honoured

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAdapter } from '../../src/index.js';
import type { ToolGroup, UnifiedEvent } from '../../src/index.js';

// What `planMode: true` desugars into (PLAN_MODE_DENY_GROUPS). `file-write` alone
// leaves Bash live, and the model would write the file through the shell.
// Override with PROBE_DENY=file-write,shell,delegation to also shut the subagent route.
const DENY = (process.env.PROBE_DENY?.split(',') ?? ['file-write', 'shell']) as ToolGroup[];
const MODEL = 'sonnet-4.5';
const AUTO_APPROVE = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];

interface TurnRecord {
  label: string;
  cwd: string;
  file: string;
  deny: boolean;
  resumeSessionId?: string;
  sdkOptions?: Record<string, unknown>;
  events: unknown[];
  text: string;
  sessionId?: string;
  dirAfter: string[];
  fileContent: string | null;
}

function versions() {
  const root = path.resolve(import.meta.dirname, '../..');
  const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')).version as string;
  return {
    claudeCli: execSync('claude --version', { encoding: 'utf8' }).trim(),
    package: read(path.join(root, 'package.json')),
    sdkResolved: read(path.join(root, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json')),
  };
}

function freshDir(): string {
  // realpath: the SDK keys sessions by cwd, and /var is a symlink on macOS.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tp-probe-')));
}

function serialize(event: UnifiedEvent): unknown {
  if (event.type === 'error') {
    return { ...event, error: { name: event.error.name, message: event.error.message } };
  }
  return event;
}

async function runTurn(opts: {
  label: string;
  cwd: string;
  file: string;
  deny: boolean;
  resumeSessionId?: string;
}): Promise<TurnRecord> {
  const rec: TurnRecord = { ...opts, events: [], text: '', dirAfter: [], fileContent: null };
  const adapter = createAdapter('claude-code');

  console.log(`\n=== ${opts.label} (deny=${opts.deny}, resume=${opts.resumeSessionId ?? '-'}) ===`);
  for await (const event of adapter.execute({
    prompt: `utwórz plik ${opts.file} z treścią ok`,
    systemPrompt: 'Be concise.',
    model: MODEL,
    cwd: opts.cwd,
    maxTurns: 5,
    autoApproveTools: AUTO_APPROVE,
    disallowedToolGroups: opts.deny ? DENY : [],
    ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
  })) {
    if (event.type === 'text_delta') {
      rec.text += event.text;
      continue;
    }
    if (event.type === 'thinking') continue;
    rec.events.push(serialize(event));
    switch (event.type) {
      case 'adapter_ready': {
        const o = (event.sdkConfig as { options: Record<string, unknown> }).options;
        rec.sdkOptions = o;
        console.log('  adapter_ready.options:', JSON.stringify({
          tools: o.tools, disallowedTools: o.disallowedTools, allowedTools: o.allowedTools,
          permissionMode: o.permissionMode, resume: o.resume,
        }));
        break;
      }
      case 'tool_use':
        console.log(`  tool_use ${event.toolName} ${JSON.stringify(event.input)}`);
        break;
      case 'tool_result':
        console.log(`  tool_result isError=${event.isError ?? false} ${event.summary.slice(0, 200)}`);
        break;
      case 'warning':
        console.log(`  warning: ${event.message}`);
        break;
      case 'error':
        console.log(`  error [${event.error.name}] phase=${event.phase}: ${event.error.message}`);
        break;
      case 'result':
        rec.sessionId = event.sessionId;
        console.log(`  result sessionId=${event.sessionId}`);
        break;
    }
  }

  rec.dirAfter = fs.readdirSync(opts.cwd).sort();
  const p = path.join(opts.cwd, opts.file);
  rec.fileContent = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  console.log(`  text: ${rec.text.trim().replace(/\s+/g, ' ').slice(0, 300)}`);
  console.log(`  dir: [${rec.dirAfter.join(', ')}]  ${opts.file} exists=${rec.fileContent !== null}`);
  return rec;
}

const exists = (r: TurnRecord) => r.fileContent !== null;

async function main() {
  const v = versions();
  console.log('Versions:', v, '\nDeny groups:', DENY, 'Model:', MODEL);
  const dump: Record<string, unknown> = { versions: v, denyGroups: DENY, model: MODEL, turns: [] };
  const turns = dump.turns as TurnRecord[];
  const verdict: Record<string, string> = {};

  // A — control
  const a = await runTurn({ label: 'A', cwd: freshDir(), file: 'probe.txt', deny: true });
  turns.push(a);
  verdict.A = exists(a) ? 'CONTROL FAILED (file created under deny)' : 'ok (file not created)';

  if (!exists(a)) {
    // B — tighten on resume
    const bDir = freshDir();
    const b1 = await runTurn({ label: 'B/T1', cwd: bDir, file: 'probe-b1.txt', deny: false });
    turns.push(b1);
    if (!exists(b1) || !b1.sessionId) {
      verdict.B = 'inconclusive (T1 did not create the file or no sessionId)';
    } else {
      const b2 = await runTurn({ label: 'B/T2', cwd: bDir, file: 'probe-b2.txt', deny: true, resumeSessionId: b1.sessionId });
      turns.push(b2);
      verdict.B = exists(b2) ? 'file created → old (permissive) policy replayed' : 'file not created → fresh (restrictive) policy honoured';
    }

    // C — loosen on resume
    const cDir = freshDir();
    const c1 = await runTurn({ label: 'C/T1', cwd: cDir, file: 'probe-c1.txt', deny: true });
    turns.push(c1);
    if (exists(c1) || !c1.sessionId) {
      verdict.C = 'inconclusive (T1 created the file or no sessionId)';
    } else {
      const c2 = await runTurn({ label: 'C/T2', cwd: cDir, file: 'probe-c2.txt', deny: false, resumeSessionId: c1.sessionId });
      turns.push(c2);
      verdict.C = exists(c2) ? 'file created → fresh (permissive) policy honoured' : 'file not created → old (restrictive) policy replayed';
    }
  }

  dump.verdict = verdict;
  const out = process.env.PROBE_OUT ?? path.join(os.tmpdir(), `tool-policy-resume-probe-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(dump, null, 2));
  console.log('\nVerdict:', verdict, '\nFull dump:', out);
  if (exists(a)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
