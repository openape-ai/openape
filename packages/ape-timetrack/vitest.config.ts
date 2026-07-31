import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The black-box suite spawns the built CLI as a real subprocess; the
    // first run may additionally trigger a fallback `pnpm build` when dist/
    // is missing. Both can blow the 5s default on a loaded CI runner.
    testTimeout: 30_000,
  },
})
