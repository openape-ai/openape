import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/sp/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 92,
        functions: 96,
        lines: 93,
      },
    },
  },
})
