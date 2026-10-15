import { fileURLToPath } from 'node:url'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { uiTheme } from './app/theme.ts'

export default defineConfig({
  plugins: [vue(), ui({
    ui: uiTheme,
    router: false,
    colorMode: false,
    dts: false,
    autoImport: { imports: ['vue'], dts: false },
    components: { dirs: ['app/components'], dts: false },
  })],
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  server: { port: 5481, strictPort: true, hmr: { port: 5491 } },
  test: {
    include: ['tests/layout/**/*.test.ts'],
    setupFiles: ['tests/layout/setup.ts'],
    maxWorkers: 1,
    browser: {
      enabled: true,
      api: { port: 5481, strictPort: true },
      provider: playwright({ launchOptions: { executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } }),
      headless: true,
      screenshotDirectory: fileURLToPath(new URL('./.artifacts/ui-test-migration/failures', import.meta.url)),
      instances: [{ browser: 'chromium', viewport: { width: 390, height: 844 } }],
    },
  },
})
