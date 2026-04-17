import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  process.env = { ...fileEnv, ...process.env };

  return {
    test: {
      include: ['src/testing/e2e/**/*.e2e.test.ts'],
      testTimeout: 120_000,
      retry: 0,
    },
  };
});
