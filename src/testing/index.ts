// @inharness-ai/agent-adapters/testing — exported test utilities

export {
  assertSimpleText,
  assertToolUse,
  assertThinking,
  assertMultiTurn,
  assertAdapterReady,
  assertNoBackgroundTasks,
  assertSubagentLifecycle,
} from './contract.js';
export { MockAdapter, createTestParams } from './helpers.js';
export {
  assertNormalization,
  assertNormalizedMessage,
  assertContentBlock,
  type ExpectedBlock,
  type NormalizationExpectation,
} from './normalization.js';
