import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    environment: 'happy-dom',
    // *.browser.test.ts needs a real layout engine — runs via `test:browser`
    // (vitest.browser.config.ts, Playwright Chromium), local-only. The CI
    // docker runner is a fresh node:22-bookworm container per job; Chromium's
    // apt deps would reinstall on every run, so browser mode stays off CI.
    exclude: [...configDefaults.exclude, '**/*.browser.test.ts'],
  },
})
