import { defineConfig } from 'vitest/config'

// E2E track: each test boots a real `nuxt dev` server and drives it over HTTP.
// Slow and load-sensitive, so it lives in its own config + `test:e2e` script and
// runs in the dedicated e2e CI job — NOT in the fast per-PR `ci` wave, where
// running three concurrent nuxt-dev boots on the shared runner timed out the
// setup hooks (60/90s) once a dependency change widened `--affected` to include
// this app. Long timeouts + a retry absorb the remaining boot-time variance.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One nuxt-dev boot at a time: the default parallel file execution boots
    // all three e2e servers at once and starves one of them on a loaded/shared
    // runner — the actual root cause behind the #991 flake class.
    fileParallelism: false,
    environment: 'node',
    retry: 1,
  },
})
