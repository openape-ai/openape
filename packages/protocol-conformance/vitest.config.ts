import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    globals: true,
  },
})
