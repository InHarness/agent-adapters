// Unit tests: gemini maps M18 deny-groups onto `excludeTools`, which the SDK
// applies when the TOOL REGISTRY IS BUILT — before the approval policy runs. A
// denied tool is therefore never registered and an auto-approving `yolo` mode
// cannot bypass it.

import { describe, it, expect } from 'vitest';
import { geminiExcludedTools } from './gemini.js';
import { PLAN_MODE_DENY_GROUPS, TOOL_GROUPS } from '../tool-groups.js';

describe('gemini excludeTools derivation', () => {
  it('excludes nothing when nothing is denied (byte-for-byte no-op)', () => {
    expect(geminiExcludedTools([])).toEqual([]);
  });

  it('excludes the shell tool for shell', () => {
    expect(geminiExcludedTools(['shell'])).toContain('run_shell_command');
  });

  // The background-process tools are registered OUTSIDE the enumerated built-in
  // set, so a shell deny naming only `run_shell_command` would leave the output
  // of already-started commands readable.
  it('also excludes the background-process tools for shell', () => {
    const excluded = geminiExcludedTools(['shell']);
    expect(excluded).toContain('list_background_processes');
    expect(excluded).toContain('read_background_output');
  });

  it('excludes the write family, including memory persistence, for file-write', () => {
    const excluded = geminiExcludedTools(['file-write']);
    for (const tool of ['write_file', 'replace', 'save_memory']) expect(excluded).toContain(tool);
  });

  it('excludes the read, listing and search tools for file-read', () => {
    const excluded = geminiExcludedTools(['file-read']);
    for (const tool of ['read_file', 'read_many_files', 'list_directory', 'glob']) {
      expect(excluded).toContain(tool);
    }
  });

  // `grep_search` is the current name and `search_file_content` its legacy
  // alias. The registry does expand aliases on the exclude set, but naming both
  // means the deny does not depend on that expansion surviving a peer bump.
  it('names both the current and legacy spelling of the renamed search tool', () => {
    const excluded = geminiExcludedTools(['file-read']);
    expect(excluded).toContain('grep_search');
    expect(excluded).toContain('search_file_content');
  });

  it('excludes both web tools for web', () => {
    const excluded = geminiExcludedTools(['web']);
    expect(excluded).toContain('web_fetch');
    expect(excluded).toContain('google_web_search');
  });

  it('subsumes the old hardcoded plan-mode list', () => {
    const excluded = geminiExcludedTools([...PLAN_MODE_DENY_GROUPS]);
    for (const tool of ['write_file', 'replace', 'run_shell_command', 'save_memory']) {
      expect(excluded).toContain(tool);
    }
  });

  it('leaves reads and web available under the plan-mode preset', () => {
    const excluded = geminiExcludedTools([...PLAN_MODE_DENY_GROUPS]);
    expect(excluded).not.toContain('read_file');
    expect(excluded).not.toContain('web_fetch');
  });

  it('covers every group in the vocabulary', () => {
    for (const group of TOOL_GROUPS) {
      expect(geminiExcludedTools([group]).length, group).toBeGreaterThan(0);
    }
  });
});
