import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Layout tests: a real browser at a real viewport, because that is the only
// place CSS actually exists. happy-dom computes no boxes and evaluates no
// media queries, so the node suite cannot see a card overflowing its screen.
// Separate config — these need a browser binary, the node suite does not.
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['tests/layout/**/*.test.ts'],
    setupFiles: ['tests/layout/setup.ts'],
    browser: {
      enabled: true,
      // Drive the installed Google Chrome instead of a downloaded build: no
      // browser binary to ship, and it is the engine the app runs in anyway.
      provider: playwright({
        launchOptions: { executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      }),
      headless: true,
      instances: [{ browser: 'chromium', viewport: { width: 390, height: 844 } }],
    },
  },
})
