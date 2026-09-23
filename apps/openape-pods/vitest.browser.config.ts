import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Geometry tests: happy-dom computes no boxes and evaluates no media queries.
// Pods ships its own CSS (no Tailwind), so a mounted component here carries the
// same stylesheet the packaged app loads. Runs inside `test:layout`, which the
// layout suite already executes on the mac runner with Google Chrome installed.
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['test/layout/**/*.test.ts'],
    setupFiles: ['test/layout/setup.ts'],
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: { executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
        // Larger than any tested size, so screenshots are not scaled down to fit.
        contextOptions: { viewport: { width: 1700, height: 1400 } },
      }),
      headless: true,
      instances: [{ browser: 'chromium', viewport: { width: 1060, height: 850 } }],
    },
  },
})
