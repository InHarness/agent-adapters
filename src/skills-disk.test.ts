import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSkillSearchDirs, listDiskSkills } from './skills-disk.js';
import { materializeSkills } from './skills-tempdir.js';

let cwd: string;
let home: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'skills-disk-cwd-'));
  home = await mkdtemp(join(tmpdir(), 'skills-disk-home-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

async function writeSkill(
  root: string,
  relSkillDir: string,
  body: { name?: string; description?: string; extra?: string; content?: string },
): Promise<void> {
  const dir = join(root, relSkillDir);
  await mkdir(dir, { recursive: true });
  const lines = ['---'];
  if (body.name !== undefined) lines.push(`name: ${body.name}`);
  if (body.description !== undefined) lines.push(`description: '${body.description.replace(/'/g, "''")}'`);
  if (body.extra !== undefined) lines.push(`tags: ${body.extra}`);
  lines.push('---', '', body.content ?? '# heading');
  await writeFile(join(dir, 'SKILL.md'), lines.join('\n'), 'utf8');
}

describe('listDiskSkills', () => {
  it('finds claude-code skills in project and global dirs with correct scope/source', async () => {
    await writeSkill(cwd, '.claude/skills/alpha', { name: 'alpha', description: 'Project alpha' });
    await writeSkill(home, '.claude/skills/beta', { name: 'beta', description: 'Global beta' });

    const skills = await listDiskSkills('claude-code', { cwd, home });

    expect(skills).toHaveLength(2);
    const alpha = skills.find((s) => s.name === 'alpha')!;
    expect(alpha).toMatchObject({
      description: 'Project alpha',
      scope: 'project',
      source: '.claude/skills',
      dir: join(cwd, '.claude/skills/alpha'),
      path: join(cwd, '.claude/skills/alpha/SKILL.md'),
    });
    const beta = skills.find((s) => s.name === 'beta')!;
    expect(beta).toMatchObject({ scope: 'global', source: '~/.claude/skills' });
  });

  it('returns both entries (no dedup) when the same name exists in project and global', async () => {
    await writeSkill(cwd, '.opencode/skills/dup', { name: 'dup', description: 'project' });
    await writeSkill(home, '.config/opencode/skills/dup', { name: 'dup', description: 'global' });

    const skills = await listDiskSkills('opencode', { cwd, home });
    const dups = skills.filter((s) => s.name === 'dup');

    expect(dups).toHaveLength(2);
    expect(dups.map((s) => s.scope).sort()).toEqual(['global', 'project']);
  });

  it('scans all opencode project + global directories', async () => {
    await writeSkill(cwd, '.opencode/skills/a', { name: 'a', description: 'a' });
    await writeSkill(cwd, '.claude/skills/b', { name: 'b', description: 'b' });
    await writeSkill(cwd, '.agents/skills/c', { name: 'c', description: 'c' });
    await writeSkill(home, '.config/opencode/skills/d', { name: 'd', description: 'd' });
    await writeSkill(home, '.claude/skills/e', { name: 'e', description: 'e' });
    await writeSkill(home, '.agents/skills/f', { name: 'f', description: 'f' });

    const skills = await listDiskSkills('opencode', { cwd, home });

    expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('scans codex .agents/skills and skips a missing /etc/codex/skills', async () => {
    await writeSkill(cwd, '.agents/skills/proj', { name: 'proj', description: 'p' });
    await writeSkill(home, '.agents/skills/glob', { name: 'glob', description: 'g' });

    const skills = await listDiskSkills('codex', { cwd, home });

    expect(skills.map((s) => s.name).sort()).toEqual(['glob', 'proj']);
    expect(skills.some((s) => s.scope === 'system')).toBe(false);
  });

  it('finds gemini skills inside extensions and ignores a flat .gemini/skills dir', async () => {
    await writeSkill(cwd, '.gemini/extensions/myext/skills/tool', { name: 'tool', description: 'in ext' });
    await writeSkill(cwd, '.gemini/skills/flat', { name: 'flat', description: 'should be ignored' });

    const skills = await listDiskSkills('gemini', { cwd, home });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'tool', source: 'extension:myext', scope: 'project' });
  });

  it('parses extra frontmatter keys into metadata', async () => {
    await writeSkill(cwd, '.claude/skills/m', { name: 'm', description: 'd', extra: 'security' });

    const [skill] = await listDiskSkills('claude-code', { cwd, home });

    expect(skill!.metadata).toEqual({ tags: 'security' });
  });

  it('folds a YAML block-scalar description (>- style) into one line', async () => {
    const dir = join(cwd, '.claude/skills/folded');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      ['---', 'name: folded', 'description: >-', '  First line of the', '  folded description.', '---', '', '# body'].join('\n'),
      'utf8',
    );

    const [skill] = await listDiskSkills('claude-code', { cwd, home });

    expect(skill!.description).toBe('First line of the folded description.');
  });

  it('falls back to the directory name when frontmatter name is missing', async () => {
    await writeSkill(cwd, '.claude/skills/no-name', { description: 'no explicit name' });

    const [skill] = await listDiskSkills('claude-code', { cwd, home });

    expect(skill!.name).toBe('no-name');
    expect(skill!.description).toBe('no explicit name');
  });

  it('skips subdirectories without a SKILL.md', async () => {
    await mkdir(join(cwd, '.claude/skills/empty'), { recursive: true });
    await writeSkill(cwd, '.claude/skills/real', { name: 'real', description: 'r' });

    const skills = await listDiskSkills('claude-code', { cwd, home });

    expect(skills.map((s) => s.name)).toEqual(['real']);
  });

  it('returns [] for missing directories and unknown architectures', async () => {
    expect(await listDiskSkills('claude-code', { cwd, home })).toEqual([]);
    expect(await listDiskSkills('not-a-real-arch', { cwd, home })).toEqual([]);
  });

  it('round-trips materializeSkills().mirrorTo() output', async () => {
    const materialized = await materializeSkills([
      { name: 'mirrored-skill', description: "It's mirrored", content: '# body' },
    ]);
    try {
      await materialized.mirrorTo(cwd, '.agents/skills');
      const skills = await listDiskSkills('codex', { cwd, home });

      const found = skills.find((s) => s.name === 'mirrored-skill')!;
      expect(found).toBeDefined();
      expect(found.description).toBe("It's mirrored");
      expect(found.scope).toBe('project');
      expect(found.source).toBe('.agents/skills');
    } finally {
      await materialized.cleanup();
    }
  });
});

describe('getSkillSearchDirs', () => {
  it('resolves directories without touching the filesystem', () => {
    const dirs = getSkillSearchDirs('claude-code', { cwd, home });

    expect(dirs).toEqual([
      { dir: join(cwd, '.claude/skills'), scope: 'project', source: '.claude/skills', layout: 'flat' },
      { dir: join(home, '.claude/skills'), scope: 'global', source: '~/.claude/skills', layout: 'flat' },
    ]);
  });

  it('marks gemini extension roots with the gemini-extensions layout', () => {
    const dirs = getSkillSearchDirs('gemini', { cwd, home });

    expect(dirs.every((d) => d.layout === 'gemini-extensions')).toBe(true);
    expect(dirs.map((d) => d.dir)).toEqual([
      join(cwd, '.gemini/extensions'),
      join(home, '.gemini/extensions'),
    ]);
  });

  it('returns [] for unknown architectures', () => {
    expect(getSkillSearchDirs('nope', { cwd, home })).toEqual([]);
  });
});
