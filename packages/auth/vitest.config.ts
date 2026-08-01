import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    globals: true,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/**/index.ts', 'src/types/**'],
      reporter: ['text', 'lcov'],
      // ratchet: raise as coverage improves
      thresholds: {
        statements: 95,
        branches: 91,
        functions: 91,
        lines: 96,
      },
    },
  },
})
