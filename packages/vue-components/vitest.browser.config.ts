import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Browser-mode run of the FULL suite (the happy-dom tests unchanged, plus the
 * *.browser.test.ts layout tests that need a real rendering engine).
 *
 * Local-only (`pnpm run test:browser`); one-time setup:
 *   pnpm exec playwright install chromium
 *
 * Not a CI gate: the docker runner boots a fresh node:22-bookworm container
 * per job with no persistent volumes, so Chromium's apt system deps would
 * reinstall on every run — see the PR that introduced this config for the
 * measured trade-off.
 *
 * The vite devDependency of this package is pinned to >=8.1.5: the vite
 * 8.0.x dep optimizer (rolldown <1.1.2) emits a broken @vue/test-utils
 * chunk that calls init_shared_esm_bundler() without importing it
 * (rolldown/rolldown#9502) — every test file import then fails with a
 * ReferenceError in the browser.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    retry: 2,
    testTimeout: 15000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
