import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  evaluatePeerSdkVersion,
  resolvePeerSdkVersion,
  checkPeerSdkVersion,
  PEER_SDK_RANGES,
} from './sdk-version.js';

describe('evaluatePeerSdkVersion', () => {
  it('reports ok when the installed version satisfies the range', () => {
    expect(evaluatePeerSdkVersion('pkg', '>=1.0.0 <2.0.0', '1.5.0')).toEqual({ status: 'ok' });
  });

  it('reports a mismatch when the installed version is below the range', () => {
    expect(evaluatePeerSdkVersion('pkg', '>=1.0.0 <2.0.0', '0.9.0')).toEqual({
      status: 'mismatch',
      message: 'pkg: installed 0.9.0, requires >=1.0.0 <2.0.0',
    });
  });

  it('reports a mismatch when the installed version is above the range', () => {
    expect(evaluatePeerSdkVersion('pkg', '>=1.0.0 <2.0.0', '2.0.0')).toEqual({
      status: 'mismatch',
      message: 'pkg: installed 2.0.0, requires >=1.0.0 <2.0.0',
    });
  });

  it('reports undeterminable when the installed version could not be resolved', () => {
    expect(evaluatePeerSdkVersion('pkg', '>=1.0.0 <2.0.0', undefined)).toEqual({
      status: 'undeterminable',
      message: 'pkg: could not determine installed version (requires >=1.0.0 <2.0.0)',
    });
  });

  it('accepts an in-range prerelease version (includePrerelease)', () => {
    expect(evaluatePeerSdkVersion('pkg', '>=0.3.0 <0.4.0', '0.3.5-alpha.1')).toEqual({ status: 'ok' });
  });

  it('still rejects an out-of-range prerelease version', () => {
    expect(evaluatePeerSdkVersion('pkg', '>=0.3.0 <0.4.0', '0.2.0-alpha.1').status).toBe('mismatch');
  });
});

describe('PEER_SDK_RANGES matches package.json peerDependencies (single source of truth)', () => {
  const peerDependencies = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .peerDependencies as Record<string, string>;

  it('declares the exact same package set', () => {
    expect(Object.keys(PEER_SDK_RANGES).sort()).toEqual(Object.keys(peerDependencies).sort());
  });

  it.each(Object.keys(PEER_SDK_RANGES))('%s range matches package.json', (pkgName) => {
    expect(PEER_SDK_RANGES[pkgName]).toBe(peerDependencies[pkgName]);
  });
});

describe('resolvePeerSdkVersion (real install)', () => {
  const devDeps = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .devDependencies as Record<string, string>;

  it.each(Object.keys(PEER_SDK_RANGES))('finds the installed version of %s', (pkgName) => {
    const version = resolvePeerSdkVersion(pkgName);
    expect(version).toBeDefined();
    expect(devDeps[pkgName]).toBeDefined();
  });

  it('returns undefined for a package that is not installed', () => {
    expect(resolvePeerSdkVersion('@not-a-real-scope/definitely-not-installed')).toBeUndefined();
  });

  it('memoizes: a second call for the same package returns the identical cached result', () => {
    const first = resolvePeerSdkVersion('@anthropic-ai/claude-agent-sdk');
    const second = resolvePeerSdkVersion('@anthropic-ai/claude-agent-sdk');
    expect(second).toBe(first);
  });
});

describe('checkPeerSdkVersion (real install)', () => {
  it.each(Object.keys(PEER_SDK_RANGES))('the dev-installed %s satisfies its declared range', (pkgName) => {
    expect(checkPeerSdkVersion(pkgName)).toEqual({ status: 'ok' });
  });
});
