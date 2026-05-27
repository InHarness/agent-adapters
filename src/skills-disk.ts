// Discovers skills that a runtime auto-loads from disk.
//
// This is the read-side counterpart to skills-tempdir.ts (`materializeSkills`),
// which writes inline skills into the directories a runtime scans. Each runtime
// auto-loads `<name>/SKILL.md` files from a fixed set of project/global/system
// directories (and this cannot be disabled). `listDiskSkills(architecture)`
// scans those same directories and returns the skills the runtime will see,
// in a unified shape.
//
// Directory sources (from the runtime SDK docs):
//   claude-code  .claude/skills, ~/.claude/skills
//   codex        .agents/skills, ~/.agents/skills, /etc/codex/skills
//   opencode     .opencode/skills, .claude/skills, .agents/skills (project)
//                ~/.config/opencode/skills, ~/.claude/skills, ~/.agents/skills (global)
//   gemini       skills live ONLY inside extensions —
//                {.gemini,~/.gemini}/extensions/<ext>/skills/<name>/SKILL.md
//
// Out of scope: claude-code plugin-bundled skills and Codex-bundled skills have
// no fixed scannable path. codex itself also walks `.agents/skills` upward from
// cwd to the repo root; we scan cwd only to match the other runtimes.

import type { Dirent } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SkillScope = 'project' | 'global' | 'system';
export type SkillLayout = 'flat' | 'gemini-extensions';

export interface DiskSkill {
  /** Frontmatter `name`; falls back to the skill directory name when absent. */
  name: string;
  /** Frontmatter `description`; empty string when absent. */
  description: string;
  /** Absolute path to the skill's SKILL.md. */
  path: string;
  /** Absolute path to the skill directory containing SKILL.md. */
  dir: string;
  /** Whether the skill was found in a project, global (home), or system directory. */
  scope: SkillScope;
  /**
   * Which directory the skill came from, e.g. `.claude/skills`,
   * `~/.config/opencode/skills`, or `extension:<name>` for gemini.
   */
  source: string;
  /** Remaining flat frontmatter keys (everything except name/description). */
  metadata: Record<string, string>;
}

export interface ListDiskSkillsOptions {
  /** Project directory to resolve project-scoped sources against. Default: `process.cwd()`. */
  cwd?: string;
  /** Home directory to resolve global-scoped sources against. Default: `os.homedir()`. */
  home?: string;
}

export interface SkillSearchLocation {
  /** Resolved absolute directory that gets scanned. */
  dir: string;
  scope: SkillScope;
  /** Source label for this location (the directory pattern). */
  source: string;
  layout: SkillLayout;
}

type SearchBase = 'cwd' | 'home' | 'abs';

interface SkillSearchSpec {
  base: SearchBase;
  /** Path relative to the base, or an absolute path when `base === 'abs'`. */
  relDir: string;
  scope: SkillScope;
  source: string;
  layout: SkillLayout;
}

const flat = (base: SearchBase, relDir: string, scope: SkillScope, source: string): SkillSearchSpec => ({
  base,
  relDir,
  scope,
  source,
  layout: 'flat',
});

const CLAUDE_CODE_SPECS: SkillSearchSpec[] = [
  flat('cwd', '.claude/skills', 'project', '.claude/skills'),
  flat('home', '.claude/skills', 'global', '~/.claude/skills'),
];

const CODEX_SPECS: SkillSearchSpec[] = [
  flat('cwd', '.agents/skills', 'project', '.agents/skills'),
  flat('home', '.agents/skills', 'global', '~/.agents/skills'),
  flat('abs', '/etc/codex/skills', 'system', '/etc/codex/skills'),
];

const OPENCODE_SPECS: SkillSearchSpec[] = [
  flat('cwd', '.opencode/skills', 'project', '.opencode/skills'),
  flat('cwd', '.claude/skills', 'project', '.claude/skills'),
  flat('cwd', '.agents/skills', 'project', '.agents/skills'),
  flat('home', '.config/opencode/skills', 'global', '~/.config/opencode/skills'),
  flat('home', '.claude/skills', 'global', '~/.claude/skills'),
  flat('home', '.agents/skills', 'global', '~/.agents/skills'),
];

const GEMINI_SPECS: SkillSearchSpec[] = [
  { base: 'cwd', relDir: '.gemini/extensions', scope: 'project', source: '.gemini/extensions', layout: 'gemini-extensions' },
  { base: 'home', relDir: '.gemini/extensions', scope: 'global', source: '~/.gemini/extensions', layout: 'gemini-extensions' },
];

const SKILL_DIRS_BY_ARCHITECTURE: Record<string, SkillSearchSpec[]> = {
  'claude-code': CLAUDE_CODE_SPECS,
  'claude-code-ollama': CLAUDE_CODE_SPECS,
  'claude-code-minimax': CLAUDE_CODE_SPECS,
  codex: CODEX_SPECS,
  opencode: OPENCODE_SPECS,
  'opencode-openrouter': OPENCODE_SPECS,
  gemini: GEMINI_SPECS,
};

function resolveDir(spec: SkillSearchSpec, cwd: string, home: string): string {
  switch (spec.base) {
    case 'cwd':
      return join(cwd, spec.relDir);
    case 'home':
      return join(home, spec.relDir);
    case 'abs':
      return spec.relDir;
  }
}

/**
 * Returns the directories `listDiskSkills` would scan for the given
 * architecture, without touching the filesystem. Pure and synchronous —
 * useful for UI/debugging. Unknown architectures return `[]`.
 */
export function getSkillSearchDirs(
  architecture: string,
  options: ListDiskSkillsOptions = {},
): SkillSearchLocation[] {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const specs = SKILL_DIRS_BY_ARCHITECTURE[architecture];
  if (!specs) return [];
  return specs.map((spec) => ({
    dir: resolveDir(spec, cwd, home),
    scope: spec.scope,
    source: spec.source,
    layout: spec.layout,
  }));
}

/**
 * Lists the skills a runtime auto-loads from disk for the given architecture.
 *
 * Scans every project/global/system directory the runtime reads and returns one
 * entry per `<name>/SKILL.md` found, parsed for frontmatter `name`/`description`
 * plus any extra flat metadata keys. Missing directories are skipped silently.
 *
 * Results are NOT deduplicated: the same skill name appearing in both a project
 * and a global directory yields two entries, each carrying its own `scope` and
 * `source` so callers can see where each came from.
 *
 * Unknown architectures (and gemini in a repo without extensions) return `[]`.
 *
 * @example
 * ```ts
 * const skills = await listDiskSkills('claude-code', { cwd: process.cwd() });
 * for (const s of skills) console.log(s.scope, s.source, s.name);
 * ```
 */
export async function listDiskSkills(
  architecture: string,
  options: ListDiskSkillsOptions = {},
): Promise<DiskSkill[]> {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const specs = SKILL_DIRS_BY_ARCHITECTURE[architecture];
  if (!specs) return [];

  const results: DiskSkill[] = [];
  for (const spec of specs) {
    const root = resolveDir(spec, cwd, home);
    if (spec.layout === 'gemini-extensions') {
      results.push(...(await scanGeminiExtensions(root, spec.scope)));
    } else {
      results.push(...(await scanFlat(root, spec.scope, spec.source)));
    }
  }
  return results;
}

// Scans `<root>/<skillName>/SKILL.md`. Returns [] when root is missing.
async function scanFlat(root: string, scope: SkillScope, source: string): Promise<DiskSkill[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: DiskSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = join(root, entry.name);
    const file = join(dir, 'SKILL.md');
    const parsed = await readFrontmatter(file);
    if (!parsed) continue;
    out.push({
      name: parsed.name || entry.name,
      description: parsed.description,
      path: file,
      dir,
      scope,
      source,
      metadata: parsed.metadata,
    });
  }
  return out;
}

// Scans `<root>/<extName>/skills/<skillName>/SKILL.md` — gemini skills live only
// inside extensions, so we descend one extra level and label the source by ext.
async function scanGeminiExtensions(root: string, scope: SkillScope): Promise<DiskSkill[]> {
  let exts: Dirent[];
  try {
    exts = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: DiskSkill[] = [];
  for (const ext of exts) {
    if (!ext.isDirectory() && !ext.isSymbolicLink()) continue;
    const skillsRoot = join(root, ext.name, 'skills');
    out.push(...(await scanFlat(skillsRoot, scope, `extension:${ext.name}`)));
  }
  return out;
}

interface ParsedFrontmatter {
  name: string;
  description: string;
  metadata: Record<string, string>;
}

// SKILL.md bodies can be large; frontmatter sits at the very top, so we only
// read the head. 16 KiB is far more than any realistic frontmatter block.
const FRONTMATTER_READ_LIMIT = 16 * 1024;

async function readFrontmatter(file: string): Promise<ParsedFrontmatter | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(FRONTMATTER_READ_LIMIT);
    const { bytesRead } = await handle.read(buf, 0, FRONTMATTER_READ_LIMIT, 0);
    return parseFrontmatter(buf.subarray(0, bytesRead).toString('utf8'));
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const KEY_VALUE_RE = /^([A-Za-z0-9_-]+):\s?(.*)$/;
const BLOCK_SCALAR_RE = /^([|>])[+-]?\d*$/;

// Minimal YAML-frontmatter reader for flat `key: value` scalars (the inverse of
// escapeYamlSingleLine in skills-tempdir.ts), plus block scalars (`>`, `|`)
// which real Claude/OpenCode skills commonly use for long descriptions. Other
// complex YAML (lists, nested maps) is kept as the raw string. No YAML
// dependency — the repo has none.
function parseFrontmatter(text: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = { name: '', description: '', metadata: {} };
  const normalized = text.replace(/^\uFEFF/, '');
  const match = FRONTMATTER_RE.exec(normalized);
  if (!match) return result;

  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = KEY_VALUE_RE.exec(lines[i]!);
    if (!kv) continue;
    const key = kv[1]!;
    const raw = kv[2]!.trim();

    let value: string;
    const block = BLOCK_SCALAR_RE.exec(raw);
    if (block) {
      const collected: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1] === '' || /^\s/.test(lines[i + 1]!))) {
        collected.push(lines[++i]!);
      }
      value = foldBlock(collected, block[1] === '>');
    } else {
      value = unquote(raw);
    }

    if (key === 'name') result.name = value;
    else if (key === 'description') result.description = value;
    else result.metadata[key] = value;
  }
  return result;
}

// Joins the indented continuation lines of a YAML block scalar. Folded (`>`)
// joins non-empty lines with spaces; literal (`|`) joins with newlines.
function foldBlock(lines: string[], folded: boolean): string {
  const trimmed = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  return trimmed.join(folded ? ' ' : '\n');
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === "'" && last === "'") {
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (first === '"' && last === '"') {
      return value.slice(1, -1).replace(/\\"/g, '"');
    }
  }
  return value;
}
