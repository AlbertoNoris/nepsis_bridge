import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 10000,
    alias: {
      '@nepsis/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@nepsis/daemon': path.resolve(__dirname, 'packages/daemon/src'),
    },
    include: [
      'packages/*/src/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
});
