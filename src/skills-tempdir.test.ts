import { access, mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { materializeSkills } from './skills-tempdir.js';
import type { InlineSkill } from './types.js';

// Frontmatter regex copied from @google/gemini-cli-core skillLoader to ensure
// the files we produce parse with the same loader Gemini uses internally.
// (Not imported to keep the test independent of the SDK installation.)
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

const sample: InlineSkill = {
  name: 'echo-hi',
  description: 'A trivial skill used by tests',
  content: '# Echo\n\nReply with the literal word EPHEMERAL-OK.\n',
};

describe('materializeSkills', () => {
  it('writes plugin manifest and one SKILL.md per skill', async () => {
    const m = await materializeSkills([sample]);
    try {
      const manifest = JSON.parse(await readFile(m.pluginManifestPath, 'utf8'));
      expect(manifest.name).toMatch(/^agent-adapters-inline-/);
      expect(manifest.version).toBe('0.0.0');

      expect(m.files).toHaveLength(1);
      const skillFile = m.files[0]!;
      expect(skillFile).toBe(join(m.skillsDir, 'echo-hi', 'SKILL.md'));

      const body = await readFile(skillFile, 'utf8');
      const match = FRONTMATTER_REGEX.exec(body);
      expect(match, 'frontmatter must parse').not.toBeNull();
      expect(match![1]).toContain('name: echo-hi');
      expect(match![1]).toContain("description: 'A trivial skill used by tests'");
      expect(match![2]).toContain('EPHEMERAL-OK');
    } finally {
      await m.cleanup();
    }
  });

  it('cleanup removes the entire tmpRoot', async () => {
    const m = await materializeSkills([sample]);
    await m.cleanup();
    await expect(access(m.tmpRoot)).rejects.toThrow();
  });

  it('cleanup is idempotent', async () => {
    const m = await materializeSkills([sample]);
    await m.cleanup();
    await expect(m.cleanup()).resolves.toBeUndefined();
  });

  it('throws on slug collision', async () => {
    await expect(
      materializeSkills([
        { ...sample, name: 'echo-hi' },
        { ...sample, name: 'Echo Hi' }, // both slugify to "echo-hi"
      ]),
    ).rejects.toThrow(/slug collision/);
  });

  it('rejects path traversal in name', async () => {
    await expect(
      materializeSkills([{ ...sample, name: '../escape' }]),
    ).rejects.toThrow(/path separators/);
  });

  it('rejects empty skill array', async () => {
    await expect(materializeSkills([])).rejects.toThrow(/empty array/);
  });

  it('writes allowed-tools and metadata into frontmatter', async () => {
    const m = await materializeSkills([
      {
        ...sample,
        allowedTools: ['Read', 'Grep'],
        metadata: { license: 'MIT', version: 1 },
      },
    ]);
    try {
      const body = await readFile(m.files[0]!, 'utf8');
      expect(body).toContain('allowed-tools: Read, Grep');
      expect(body).toContain("license: 'MIT'");
      expect(body).toContain('version: 1');
    } finally {
      await m.cleanup();
    }
  });

  it('escapes single quotes and collapses newlines in description', async () => {
    const m = await materializeSkills([
      { ...sample, description: "it's\nmulti-line" },
    ]);
    try {
      const body = await readFile(m.files[0]!, 'utf8');
      expect(body).toContain("description: 'it''s multi-line'");
    } finally {
      await m.cleanup();
    }
  });
});

describe('mirrorTo', () => {
  it('mirrors files into <cwd>/<subdir>/agent-adapters-<uuid>-<slug>/SKILL.md', async () => {
    const fakeCwd = await mkdtemp(join(tmpdir(), 'agent-adapters-mirror-test-'));
    const m = await materializeSkills([sample]);
    try {
      const mirror = await m.mirrorTo(fakeCwd, '.opencode/skills');
      expect(mirror.mirroredPaths).toHaveLength(1);
      expect(mirror.mirroredPaths[0]!).toMatch(
        /\.opencode\/skills\/agent-adapters-[a-f0-9]{8}-echo-hi\/SKILL\.md$/,
      );

      const body = await readFile(mirror.mirroredPaths[0]!, 'utf8');
      expect(body).toContain('EPHEMERAL-OK');

      await mirror.cleanupMirror();
      await expect(stat(mirror.mirroredPaths[0]!)).rejects.toThrow();

      // The .opencode/skills/ parent dir is left intact (we only created the
      // per-skill subfolder), and importantly any sibling files there are
      // untouched.
      const baseDir = join(fakeCwd, '.opencode/skills');
      const remaining = await readdir(baseDir);
      expect(remaining).toEqual([]);
    } finally {
      await m.cleanup();
    }
  });

  it('cleanupMirror does not touch sibling skills the user already had', async () => {
    const fakeCwd = await mkdtemp(join(tmpdir(), 'agent-adapters-mirror-sibling-'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    const userSkillDir = join(fakeCwd, '.opencode/skills', 'user-existing');
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(join(userSkillDir, 'SKILL.md'), '---\nname: user-existing\ndescription: kept\n---\nuser content\n');

    const m = await materializeSkills([sample]);
    try {
      const mirror = await m.mirrorTo(fakeCwd, '.opencode/skills');
      await mirror.cleanupMirror();
      const userBody = await readFile(join(userSkillDir, 'SKILL.md'), 'utf8');
      expect(userBody).toContain('user content');
    } finally {
      await m.cleanup();
    }
  });
});
