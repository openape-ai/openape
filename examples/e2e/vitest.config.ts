import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60_000,
    // Every file boots a fresh `nuxt dev` IdP and SP in beforeAll.
    // Must exceed BOOT_TIMEOUT_MS (300s) in the helpers.
    hookTimeout: 360_000,
    fileParallelism: false,
  },
})
