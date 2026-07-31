import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/sp/**'],
      reporter: ['text', 'lcov'],
      // ratchet: raise as coverage improves
      thresholds: {
        statements: 93,
        functions: 98,
        lines: 93,
      },
    },
  },
})
