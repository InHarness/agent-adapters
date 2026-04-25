// Materializes inline skill definitions to a temporary directory for the
// duration of one execute() call.
//
// Layout produced:
//   <tmpRoot>/
//     .claude-plugin/plugin.json   ← Claude Code consumes this as a local plugin
//     skills/<slug>/SKILL.md       ← one file per skill, with YAML frontmatter
//
// The same directory doubles as the source for `mirrorTo()`, which copies the
// SKILL.md files into a target cwd (e.g. <userCwd>/.opencode/skills/) under
// uniquely-prefixed folders so opencode/codex servers that auto-discover from
// fixed cwd locations pick them up. Mirror cleanup removes only what we wrote.
//
// Cleanup is idempotent — `force: true` on `fs.rm` swallows ENOENT.

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { InlineSkill } from './types.js';

export interface MaterializedSkills {
  /** Absolute path to the per-call tmpdir; doubles as Claude Code plugin root. */
  tmpRoot: string;
  /** `<tmpRoot>/skills` — parent of all `<slug>/SKILL.md` files. */
  skillsDir: string;
  /** `<tmpRoot>/.claude-plugin/plugin.json` */
  pluginManifestPath: string;
  /** Plugin name written into plugin.json — uuid-suffixed for safe dedupe. */
  pluginName: string;
  /** Slugified skill names, in the same order as the input array. */
  skillSlugs: string[];
  /** Absolute paths to every SKILL.md file written, parallel to input order. */
  files: string[];
  /** Removes the entire tmpRoot. Idempotent, swallows ENOENT. */
  cleanup: () => Promise<void>;
  /**
   * Mirrors the materialized SKILL.md files into `<targetCwd>/<subdir>/` under
   * uuid-prefixed folders so SDK auto-discovery (codex, opencode) picks them
   * up. Cleanup removes only the directories this call created.
   */
  mirrorTo: (targetCwd: string, subdir: string) => Promise<MirroredSkills>;
}

export interface MirroredSkills {
  /** Absolute paths to every mirrored SKILL.md file. */
  mirroredPaths: string[];
  /** Removes only the per-skill directories this mirror created. Idempotent. */
  cleanupMirror: () => Promise<void>;
}

const SLUG_RE = /[^a-z0-9-]+/g;

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(SLUG_RE, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`InlineSkill name "${name}" produced an empty slug`);
  if (slug.length > 64) throw new Error(`InlineSkill name "${name}" slug exceeds 64 chars`);
  return slug;
}

function escapeYamlSingleLine(value: string): string {
  // YAML single-quoted scalar: doubles every embedded single quote, no
  // newlines allowed. We collapse newlines to spaces because frontmatter
  // description must be one line.
  const oneLine = value.replace(/\r?\n+/g, ' ').trim();
  return `'${oneLine.replace(/'/g, "''")}'`;
}

function buildFrontmatter(skill: InlineSkill): string {
  const lines: string[] = ['---', `name: ${skill.name}`, `description: ${escapeYamlSingleLine(skill.description)}`];
  if (skill.allowedTools?.length) {
    lines.push(`allowed-tools: ${skill.allowedTools.join(', ')}`);
  }
  if (skill.metadata) {
    for (const [key, value] of Object.entries(skill.metadata)) {
      if (key === 'name' || key === 'description' || key === 'allowed-tools') continue;
      const rendered = typeof value === 'string' ? escapeYamlSingleLine(value) : String(value);
      lines.push(`${key}: ${rendered}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function validateSkill(skill: InlineSkill): void {
  if (!skill.name || typeof skill.name !== 'string') {
    throw new Error('InlineSkill.name is required and must be a string');
  }
  if (skill.name.length > 64) {
    throw new Error(`InlineSkill.name "${skill.name}" exceeds 64 chars`);
  }
  if (skill.name.includes('/') || skill.name.includes('\\') || skill.name.includes('..')) {
    throw new Error(`InlineSkill.name "${skill.name}" must not contain path separators or ".."`);
  }
  if (!skill.description || typeof skill.description !== 'string') {
    throw new Error(`InlineSkill "${skill.name}" requires a non-empty description`);
  }
  if (typeof skill.content !== 'string') {
    throw new Error(`InlineSkill "${skill.name}" content must be a string`);
  }
}

export async function materializeSkills(skills: InlineSkill[]): Promise<MaterializedSkills> {
  if (!skills.length) {
    throw new Error('materializeSkills called with empty array');
  }

  const seenSlugs = new Set<string>();
  const slugs = skills.map((s) => {
    validateSkill(s);
    const slug = slugify(s.name);
    if (seenSlugs.has(slug)) {
      throw new Error(`InlineSkill slug collision on "${slug}" (from name "${s.name}")`);
    }
    seenSlugs.add(slug);
    return slug;
  });

  const tmpRoot = await mkdtemp(join(tmpdir(), 'agent-adapters-skills-'));
  const skillsDir = join(tmpRoot, 'skills');
  const pluginDir = join(tmpRoot, '.claude-plugin');
  const pluginManifestPath = join(pluginDir, 'plugin.json');
  const pluginName = `agent-adapters-inline-${randomUUID().slice(0, 8)}`;

  try {
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      pluginManifestPath,
      JSON.stringify(
        {
          name: pluginName,
          version: '0.0.0',
          description: 'Ephemeral inline skills materialized by @inharness-ai/agent-adapters',
        },
        null,
        2,
      ),
      'utf8',
    );

    const files: string[] = [];
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i]!;
      const slug = slugs[i]!;
      const dir = join(skillsDir, slug);
      const file = join(dir, 'SKILL.md');
      await mkdir(dir, { recursive: true });
      await writeFile(file, `${buildFrontmatter(skill)}${skill.content}`, 'utf8');
      files.push(file);
    }

    return {
      tmpRoot,
      skillsDir,
      pluginManifestPath,
      pluginName,
      skillSlugs: slugs,
      files,
      cleanup: () => rm(tmpRoot, { recursive: true, force: true }),
      mirrorTo: (targetCwd, subdir) => mirrorTo(targetCwd, subdir, skills, slugs, files),
    };
  } catch (err) {
    // Best-effort: if we crashed mid-write, don't leak the partial tmpdir.
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function mirrorTo(
  targetCwd: string,
  subdir: string,
  skills: InlineSkill[],
  slugs: string[],
  sourceFiles: string[],
): Promise<MirroredSkills> {
  const baseDir = join(targetCwd, subdir);
  const mirrorPrefix = `agent-adapters-${randomUUID().slice(0, 8)}`;
  const createdDirs: string[] = [];
  const mirroredPaths: string[] = [];

  await mkdir(baseDir, { recursive: true });

  try {
    const { readFile } = await import('node:fs/promises');
    for (let i = 0; i < skills.length; i++) {
      const slug = slugs[i]!;
      const sourceFile = sourceFiles[i]!;
      const skillDir = join(baseDir, `${mirrorPrefix}-${slug}`);
      const targetFile = join(skillDir, 'SKILL.md');
      await mkdir(skillDir, { recursive: true });
      createdDirs.push(skillDir);
      const body = await readFile(sourceFile, 'utf8');
      await writeFile(targetFile, body, 'utf8');
      mirroredPaths.push(targetFile);
    }
  } catch (err) {
    for (const dir of createdDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }

  const cleanupMirror = async () => {
    for (const dir of createdDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };

  return { mirroredPaths, cleanupMirror };
}
