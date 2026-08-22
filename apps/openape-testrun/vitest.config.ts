import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Component tests (tests/guide-shell.test.ts) mount .vue files; the plugin
  // compiles them. Server-side tests are unaffected.
  plugins: [vue()],
  test: {
    // CI runs the whole monorepo under load; the 5s default trips on CPU-
    // bound tests. Match the hardened packages (apes/shapes/agent-runtime).
    retry: 2,
    testTimeout: 15000,
    include: ['tests/**/*.test.ts'],
    // tests/layout/ needs a real browser and runs from vitest.browser.config.ts.
    exclude: ['tests/layout/**'],
    globals: true,
    environment: 'node',
  },
})
