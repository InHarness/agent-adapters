import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/testing/e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    retry: 0,
  },
});
