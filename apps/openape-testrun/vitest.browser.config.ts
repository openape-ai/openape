import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Layout tests: a real browser at a real viewport, because that is the only
// place CSS actually exists. happy-dom computes no boxes, so the node suite
// cannot see a screenshot frame push the report page off the screen.
//
// The public report page is the one place in this app whose geometry is its
// own CSS rather than Tailwind utilities: the screenshot frame and the markdown
// blocks. A browser mount brings exactly those styles along, which is why they
// are worth measuring here and the Tailwind-only chrome around them is not.
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
