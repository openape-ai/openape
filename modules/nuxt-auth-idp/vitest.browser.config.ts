import { fileURLToPath } from 'node:url'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Screenshot checks of the grant approval card: a real browser with the real
// Tailwind and Nuxt UI styles, which happy-dom cannot evaluate. The Nuxt UI
// Vite plugin compiles the same stylesheet and components the IdP app loads;
// `#imports` combines Nuxt UI's Vue stubs with the node suite's test double.
export default defineConfig({
  plugins: [
    vue(),
    ui({ router: false, autoImport: { dts: false }, components: { dts: false } }),
  ],
  resolve: {
    alias: {
      '#imports': fileURLToPath(new URL('./test/browser/imports.ts', import.meta.url)),
      '#nuxt-ui-vue-stubs': fileURLToPath(new URL('./node_modules/@nuxt/ui/dist/runtime/vue/stubs/none.js', import.meta.url)),
    },
  },
  test: {
    include: ['test/browser/**/*.test.ts'],
    setupFiles: ['test/browser/setup.ts'],
    browser: {
      enabled: true,
      // Drive the installed Google Chrome instead of a downloaded build.
      provider: playwright({
        launchOptions: { executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
        // Larger than any tested size, so screenshots are not scaled down to fit.
        contextOptions: { viewport: { width: 1400, height: 2400 } },
      }),
      headless: true,
      instances: [{ browser: 'chromium', viewport: { width: 1280, height: 900 } }],
    },
  },
})
