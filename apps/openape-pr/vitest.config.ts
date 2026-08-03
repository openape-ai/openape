import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Without an explicit include, vitest's default glob also picks up
    // e2e/*.e2e.test.ts — those boot a real server and belong to
    // vitest.e2e.config.ts (5s default timeout killed them in run 3245).
    include: ['server/**/*.test.ts'],
    // CI runs the whole monorepo under load; the 5s default trips on
    // CPU-bound tests. Match the hardened packages.
    retry: 2,
    testTimeout: 15000,
    environment: 'node',
  },
})
