import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60_000,
    // Every file boots a fresh `nuxt dev` IdP and SP in beforeAll.
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
