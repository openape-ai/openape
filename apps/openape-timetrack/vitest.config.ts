import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Colocated server tests plus the extracted app/utils logic under tests/.
    include: ['server/**/*.test.ts', 'tests/**/*.test.ts'],
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages.
    retry: 2,
    testTimeout: 15000,
    globals: true,
    environment: 'node',
  },
})
