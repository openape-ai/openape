import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#imports': resolve(__dirname, 'test/mocks/nuxt-imports.ts'),
    },
  },
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    environment: 'happy-dom',
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/types/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 19,
        functions: 16,
        lines: 19,
      },
    },
  },
})
