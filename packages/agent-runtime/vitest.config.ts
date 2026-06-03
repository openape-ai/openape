import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    retry: 2,
    testTimeout: 15000,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/types/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 50,
        functions: 50,
        lines: 50,
      },
    },
  },
})
