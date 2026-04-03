import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/types/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 93,
        branches: 82,
        functions: 83,
        lines: 92,
      },
    },
  },
})
