import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import appConfig from './app/app.config.ts'

export default defineConfig({
  plugins: [vue(), ui({ ui: appConfig.ui, autoImport: false, components: false, colorMode: false, dts: false })],
  test: {
    include: ['tests/layout/**/*.test.ts'],
    setupFiles: ['tests/layout/setup.ts'],
    browser: {
      enabled: true,
      api: { host: '127.0.0.1', port: 5483, strictPort: true },
      fileParallelism: false,
      provider: playwright({
        launchOptions: { executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
        contextOptions: { viewport: { width: 1440, height: 1000 } },
      }),
      commands: {
        async captureBriefing({ frame, page }, name: string) {
          if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid screenshot name')
          const directory = resolve('.artifacts/ui-test-migration')
          await mkdir(directory, { recursive: true })
          const bounds = await (await (await frame()).frameElement()).boundingBox()
          if (!bounds) throw new Error('Briefing test frame is not visible')
          await page.screenshot({ path: resolve(directory, `${name}.png`), clip: bounds })
        },
        async setColorScheme({ page }, colorScheme: 'light' | 'dark') {
          await page.emulateMedia({ colorScheme })
        },
      },
      headless: true,
      instances: [{ browser: 'chromium', viewport: { width: 390, height: 844 } }],
    },
  },
})
