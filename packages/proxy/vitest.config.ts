import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    // daemon tests boot a tsx child; 15s tripped on the loaded CI runner once
    // coverage instrumentation landed (run 3086) — must exceed the 30s banner
    // ceiling in test/_helpers/daemon-harness.ts
    testTimeout: 45000,
    environment: 'node',
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/types/**'],
      reporter: ['text', 'lcov'],
      // ratchet: raise as coverage improves
      thresholds: {
        statements: 64,
        functions: 64,
        lines: 66,
      },
    },
  },
})
