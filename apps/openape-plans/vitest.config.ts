import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Match the other apps: CI runs the monorepo under load, the 5s default trips.
    retry: 2,
    testTimeout: 15000,
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
})
