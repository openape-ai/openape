import { defineConfig } from 'vitest/config'

// E2E track: boots the real Nuxt app (file-backed libsql) and drives it over
// HTTP with the real built ape-pr CLI. Slow, so it lives in its own config +
// `test:e2e` script, separate from the fast unit suite.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    environment: 'node',
    retry: 1,
  },
})
