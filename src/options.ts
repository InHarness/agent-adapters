// Architecture-specific option schemas — declarative metadata consumed by UIs
// (e.g. @inharness/agent-chat) to render per-architecture form fields on top of
// the generic advanced options (cwd, systemPrompt, maxTurns).
//
// Source of truth: keys here must match what the adapter actually reads from
// `architectureConfig` inside its `execute()`. Credentials (*_apiKey) are
// intentionally omitted — API keys belong in server env, not client forms.

export type ArchOptionType = 'string' | 'number' | 'boolean' | 'select';

export interface ArchOption {
  key: string;
  label: string;
  type: ArchOptionType;
  description?: string;
  default?: unknown;
  values?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export const GLOBAL_OPTIONS: ArchOption[] = [
  {
    key: 'debug',
    label: 'Debug',
    type: 'boolean',
    default: false,
    description: 'Enable adapter-level debug mode (verbose logging / debug config).',
  },
];

export const CLAUDE_CODE_OPTIONS: ArchOption[] = [
  {
    key: 'claude_thinking',
    label: 'Thinking',
    type: 'boolean',
    description: 'Enable extended thinking output.',
  },
  {
    key: 'claude_effort',
    label: 'Effort',
    type: 'select',
    values: ['minimal', 'low', 'medium', 'high'],
    description: 'Reasoning effort level.',
  },
  {
    key: 'claude_usePreset',
    label: 'Use Claude Code preset',
    type: 'boolean',
    default: true,
    description: 'Use the built-in claude_code system-prompt preset (System prompt field is appended).',
  },
];

export const CODEX_OPTIONS: ArchOption[] = [
  {
    key: 'codex_sandboxMode',
    label: 'Sandbox mode',
    type: 'select',
    values: ['read-only', 'workspace-write'],
    default: 'workspace-write',
    description: 'Filesystem sandbox policy.',
  },
  {
    key: 'codex_reasoningEffort',
    label: 'Reasoning effort',
    type: 'select',
    values: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    description: 'Model reasoning effort.',
  },
  {
    key: 'codex_baseUrl',
    label: 'Base URL',
    type: 'string',
    placeholder: 'https://api.openai.com/v1',
    description: 'Override OpenAI-compatible endpoint.',
  },
];

export const OPENCODE_OPTIONS: ArchOption[] = [
  {
    key: 'opencode_temperature',
    label: 'Temperature',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    description: 'Sampling temperature.',
  },
  {
    key: 'opencode_topP',
    label: 'Top P',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    description: 'Nucleus sampling cutoff.',
  },
  {
    key: 'opencode_baseUrl',
    label: 'Base URL',
    type: 'string',
    placeholder: 'https://openrouter.ai/api/v1',
    description: 'Override provider endpoint.',
  },
];

export const GEMINI_OPTIONS: ArchOption[] = [
  {
    key: 'gemini_thinkingBudget',
    label: 'Thinking budget',
    type: 'number',
    min: 0,
    description: 'Max thinking tokens (takes precedence over level).',
  },
  {
    key: 'gemini_thinkingLevel',
    label: 'Thinking level',
    type: 'select',
    values: ['low', 'medium', 'high'],
    description: 'Thinking effort (ignored when budget is set).',
  },
  {
    key: 'gemini_temperature',
    label: 'Temperature',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.1,
  },
  {
    key: 'gemini_topP',
    label: 'Top P',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'gemini_topK',
    label: 'Top K',
    type: 'number',
    min: 0,
    step: 1,
  },
  {
    key: 'gemini_approvalMode',
    label: 'Approval mode',
    type: 'select',
    values: ['default', 'autoEdit', 'yolo', 'plan'],
    default: 'yolo',
    description:
      'Tool-approval policy. "yolo" auto-approves all tools (needed for headless runs). "plan" = read-only. "autoEdit" = auto-approve edits, ask for shell. "default" = ask for everything (headless blocks).',
  },
];

const OPTIONS_BY_ARCHITECTURE: Record<string, ArchOption[]> = {
  'claude-code': CLAUDE_CODE_OPTIONS,
  'claude-code-ollama': CLAUDE_CODE_OPTIONS,
  'claude-code-minimax': CLAUDE_CODE_OPTIONS,
  codex: CODEX_OPTIONS,
  opencode: OPENCODE_OPTIONS,
  'opencode-openrouter': OPENCODE_OPTIONS,
  gemini: GEMINI_OPTIONS,
};

export function getArchitectureOptions(architecture: string): ArchOption[] {
  return [...GLOBAL_OPTIONS, ...(OPTIONS_BY_ARCHITECTURE[architecture] ?? [])];
}
