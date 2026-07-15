import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { versionMismatchReason, resolvePeerSdkVersion, checkPeerSdkVersion } from './sdk-version.js';

describe('versionMismatchReason', () => {
  it('returns undefined when the installed version satisfies the range', () => {
    expect(versionMismatchReason('pkg', '>=1.0.0 <2.0.0', '1.5.0')).toBeUndefined();
  });

  it('reports a mismatch when the installed version is below the range', () => {
    expect(versionMismatchReason('pkg', '>=1.0.0 <2.0.0', '0.9.0')).toBe(
      'pkg: installed 0.9.0, requires >=1.0.0 <2.0.0',
    );
  });

  it('reports a mismatch when the installed version is above the range', () => {
    expect(versionMismatchReason('pkg', '>=1.0.0 <2.0.0', '2.0.0')).toBe(
      'pkg: installed 2.0.0, requires >=1.0.0 <2.0.0',
    );
  });

  it('reports a mismatch when the installed version could not be determined', () => {
    expect(versionMismatchReason('pkg', '>=1.0.0 <2.0.0', undefined)).toBe(
      'pkg: could not determine installed version (requires >=1.0.0 <2.0.0)',
    );
  });
});

describe('resolvePeerSdkVersion (real install)', () => {
  const devDeps = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .devDependencies as Record<string, string>;

  const packages = [
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex-sdk',
    '@opencode-ai/sdk',
    '@google/gemini-cli-core',
    '@modelcontextprotocol/sdk',
  ];

  it.each(packages)('finds the installed version of %s', (pkgName) => {
    const version = resolvePeerSdkVersion(pkgName);
    expect(version).toBeDefined();
    expect(devDeps[pkgName]).toBeDefined();
  });

  it('returns undefined for a package that is not installed', () => {
    expect(resolvePeerSdkVersion('@not-a-real-scope/definitely-not-installed')).toBeUndefined();
  });
});

describe('checkPeerSdkVersion (real install)', () => {
  it.each([
    ['@anthropic-ai/claude-agent-sdk', '>=0.3.0 <0.4.0'],
    ['@openai/codex-sdk', '>=0.120.0 <0.121.0'],
    ['@opencode-ai/sdk', '>=1.4.0 <2.0.0'],
    ['@google/gemini-cli-core', '>=0.38.0 <0.39.0'],
    ['@modelcontextprotocol/sdk', '>=1.0.0 <2.0.0'],
  ])('the dev-installed %s satisfies its declared range', (pkgName, range) => {
    expect(checkPeerSdkVersion(pkgName, range)).toBeUndefined();
  });

  it('reports a mismatch against a real installed package with a narrower fake range', () => {
    const reason = checkPeerSdkVersion('@anthropic-ai/claude-agent-sdk', '>=0.5.0 <0.6.0');
    expect(reason).toMatch(/@anthropic-ai\/claude-agent-sdk: installed .+, requires >=0\.5\.0 <0\.6\.0/);
  });
});
