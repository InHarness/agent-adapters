// Static per-architecture capability discovery.
//
// Consumers use this to decide a delivery strategy up front WITHOUT a trial
// call: e.g. a chat-message queue checks `midTurnPush` to know whether it can
// inject a message into a live turn (claude-code) or must always wait for the
// turn to end and re-dispatch (codex/gemini/opencode). Mirrors the static-map
// pattern used by `OPTIONS_BY_ARCHITECTURE` in `src/options.ts`.

import type { Architecture } from './types.js';

export interface ArchitectureCapabilities {
  /**
   * The adapter supports {@link RuntimeAdapter.pushMessage} — pushing a user
   * message into the live session mid-turn when run with
   * `RuntimeExecuteParams.streamingInput`. Only claude-code's underlying SDK
   * (`@anthropic-ai/claude-agent-sdk`) exposes streaming input today; the other
   * wrapped SDKs deliver one prompt per call, so consumers must use the
   * after-turn path (re-dispatch with `resumeSessionId`) for them.
   */
  midTurnPush: boolean;
  /**
   * The adapter accepts images on the initial prompt via
   * `RuntimeExecuteParams.images`. True for all built-in adapters — those whose
   * SDK only takes a local path or url have base64 transparently materialized to
   * a temp file. See {@link ImageInput} for per-adapter delivery.
   */
  imageInput: boolean;
  /**
   * The adapter honors `RuntimeExecuteParams.subagents` — programmatically
   * defining custom subagents the model can invoke. Only claude-code's
   * underlying SDK (`@anthropic-ai/claude-agent-sdk`) exposes `Options.agents`;
   * the other wrapped SDKs have no equivalent, so they ignore the field and
   * emit a one-shot warning. Note: *observing* subagent events is supported
   * more broadly — this flag is strictly about *defining* them.
   */
  subagentDefinition: boolean;
  /**
   * The adapter honors `RuntimeExecuteParams.allowedPaths`/`disallowedPaths` —
   * mapping the engine-neutral path scope onto its SDK's native sandbox primitive.
   * `false` means the adapter has no native primitive: it emits a one-shot warning
   * and runs unscoped. This flag is strictly "does it honor the fields at all" — it
   * says NOTHING about enforcement strength (hard OS-syscall vs soft model-visible),
   * which is a separate, runtime-confirmable signal owned by the path-scope module
   * (see {@link probePathScope} and the `adapter_ready` event's `pathScope`).
   */
  pathScope: boolean;
}

const CAPABILITIES: Record<string, ArchitectureCapabilities> = {
  'claude-code': { midTurnPush: true, imageInput: true, subagentDefinition: true, pathScope: true },
  'claude-code-ollama': { midTurnPush: true, imageInput: true, subagentDefinition: true, pathScope: true },
  'claude-code-minimax': { midTurnPush: true, imageInput: true, subagentDefinition: true, pathScope: true },
  codex: { midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: true },
  opencode: { midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: false },
  'opencode-openrouter': { midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: false },
  gemini: { midTurnPush: false, imageInput: true, subagentDefinition: false, pathScope: true },
};

/**
 * Report the static capabilities of an architecture. Unknown/custom
 * architectures default to all-false so consumers fall back to the safe
 * (after-turn) path.
 */
export function architectureCapabilities(architecture: Architecture): ArchitectureCapabilities {
  return (
    CAPABILITIES[architecture] ?? {
      midTurnPush: false,
      imageInput: false,
      subagentDefinition: false,
      pathScope: false,
    }
  );
}
