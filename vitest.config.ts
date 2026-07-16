import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Stub Next.js server-only guard so lib/ files load in vitest's node env.
      'server-only': path.resolve(__dirname, 'tests/shims/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
