import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Layout tests: a real browser at a real viewport, because that is the only
// place CSS actually exists. happy-dom computes no boxes, so the node suite
// cannot see the login card overflow the screen it is embedded in.
//
// This module ships the ONE component in the repo that has to carry its whole
// look itself: OpenApeAuth is mounted on foreign hosts, where no Nuxt build and
// no Tailwind preflight arrive to rescue it. Its geometry lives entirely in its
// own <style> block, which is exactly what a browser mount brings along.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // The component reaches for Nuxt's auto-imports. Outside a Nuxt build
      // that specifier resolves to nothing, so the tests point it at a hand
      // written double that lets them drive `loading` and `user`.
      '#imports': fileURLToPath(new URL('./tests/layout/nuxt-imports.ts', import.meta.url)),
    },
  },
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
