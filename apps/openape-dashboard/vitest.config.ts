import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    retry: 2,
    testTimeout: 15000,
    globals: true,
    environment: 'node',
  },
})
