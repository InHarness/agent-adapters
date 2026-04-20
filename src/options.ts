// Architecture-specific option schemas — declarative metadata consumed by UIs
// (e.g. @inharness/agent-chat) to render per-architecture form fields on top of
// the generic advanced options (cwd, systemPrompt, maxTurns).
//
// Source of truth: keys here must match what the adapter actually reads from
// `architectureConfig` inside its `execute()`. Credentials (*_apiKey) are
// intentionally omitted — API keys belong in server env, not client forms.
//
// Exception: `context_window_override` is UI-only metadata — adapters do not
// read it. It lets the UI display a correct usage % for pass-through model IDs
// and runtime-configurable windows (Ollama num_ctx, custom providers).

export type ArchOptionType = 'string' | 'number' | 'boolean' | 'select';

export interface ArchOption {
  key: string;
  label: string;
  type: ArchOptionType;
  scope: 'global' | 'architecture';
  description?: string;
  default?: unknown;
  values?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Show this option only when another option's value matches. UI predicate — adapters ignore. */
  visibleWhen?: { key: string; equals: unknown | unknown[] };
  /** Per-model-alias overrides. Merged over the base option when the given model is selected. UI hint — adapters ignore. */
  modelOverrides?: Record<string, Partial<Pick<ArchOption, 'values' | 'default' | 'description'>>>;
}

export const GLOBAL_OPTIONS: ArchOption[] = [
  {
    key: 'debug',
    label: 'Debug',
    type: 'boolean',
    scope: 'global',
    default: false,
    description: 'Enable adapter-level debug mode (verbose logging / debug config).',
  },
  {
    key: 'context_window_override',
    label: 'Context window (tokens)',
    type: 'number',
    scope: 'global',
    min: 1000,
    placeholder: 'auto',
    description:
      'UI-only: override the auto-detected context window size for the usage indicator. Useful for Ollama (num_ctx) or pass-through model IDs. Adapters ignore this value.',
  },
];

export const CLAUDE_CODE_OPTIONS: ArchOption[] = [
  {
    key: 'claude_thinking',
    label: 'Thinking',
    type: 'select',
    scope: 'architecture',
    values: ['adaptive', 'enabled'],
    description: 'Extended thinking mode. "adaptive" — model decides budget. "enabled" — fixed budget (see below).',
    modelOverrides: {
      'opus-4.7': {
        values: ['adaptive'],
        description: 'Opus 4.7 supports adaptive thinking only (fixed budget not allowed).',
      },
    },
  },
  {
    key: 'claude_thinking_budget',
    label: 'Thinking budget (tokens)',
    type: 'number',
    scope: 'architecture',
    min: 1024,
    placeholder: 'e.g. 5000',
    description: 'Token budget for thinking. Used only when mode = enabled (ignored for adaptive).',
    visibleWhen: { key: 'claude_thinking', equals: 'enabled' },
  },
  {
    key: 'claude_effort',
    label: 'Effort',
    type: 'select',
    scope: 'architecture',
    values: ['low', 'medium', 'high'],
    default: 'high',
    description: 'Reasoning effort level. "high" is the SDK default.',
    modelOverrides: {
      'opus-4.6': {
        values: ['low', 'medium', 'high', 'max'],
        description: 'Reasoning effort level. Opus 4.6 additionally supports "max".',
      },
    },
  },
  {
    key: 'claude_usePreset',
    label: 'Use Claude Code preset',
    type: 'boolean',
    scope: 'architecture',
    default: true,
    description: 'Use the built-in claude_code system-prompt preset (System prompt field is appended).',
  },
];

export const CODEX_OPTIONS: ArchOption[] = [
  {
    key: 'codex_sandboxMode',
    label: 'Sandbox mode',
    type: 'select',
    scope: 'architecture',
    values: ['read-only', 'workspace-write'],
    default: 'workspace-write',
    description: 'Filesystem sandbox policy.',
  },
  {
    key: 'codex_reasoningEffort',
    label: 'Reasoning effort',
    type: 'select',
    scope: 'architecture',
    values: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    description: 'Model reasoning effort.',
  },
  {
    key: 'codex_baseUrl',
    label: 'Base URL',
    type: 'string',
    scope: 'architecture',
    placeholder: 'https://api.openai.com/v1',
    description: 'Override OpenAI-compatible endpoint.',
  },
];

export const OPENCODE_OPTIONS: ArchOption[] = [
  {
    key: 'opencode_temperature',
    label: 'Temperature',
    type: 'number',
    scope: 'architecture',
    min: 0,
    max: 2,
    step: 0.1,
    description: 'Sampling temperature.',
  },
  {
    key: 'opencode_topP',
    label: 'Top P',
    type: 'number',
    scope: 'architecture',
    min: 0,
    max: 1,
    step: 0.05,
    description: 'Nucleus sampling cutoff.',
  },
  {
    key: 'opencode_baseUrl',
    label: 'Base URL',
    type: 'string',
    scope: 'architecture',
    placeholder: 'https://openrouter.ai/api/v1',
    description: 'Override provider endpoint.',
  },
];

export const GEMINI_OPTIONS: ArchOption[] = [
  {
    key: 'gemini_thinkingBudget',
    label: 'Thinking budget',
    type: 'number',
    scope: 'architecture',
    min: 0,
    description: 'Max thinking tokens (takes precedence over level).',
  },
  {
    key: 'gemini_thinkingLevel',
    label: 'Thinking level',
    type: 'select',
    scope: 'architecture',
    values: ['low', 'medium', 'high'],
    description: 'Thinking effort (ignored when budget is set).',
  },
  {
    key: 'gemini_temperature',
    label: 'Temperature',
    type: 'number',
    scope: 'architecture',
    min: 0,
    max: 2,
    step: 0.1,
  },
  {
    key: 'gemini_topP',
    label: 'Top P',
    type: 'number',
    scope: 'architecture',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'gemini_topK',
    label: 'Top K',
    type: 'number',
    scope: 'architecture',
    min: 0,
    step: 1,
  },
  {
    key: 'gemini_approvalMode',
    label: 'Approval mode',
    type: 'select',
    scope: 'architecture',
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
