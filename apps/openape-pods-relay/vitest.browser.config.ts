import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5482, strictPort: true, hmr: { port: 5492 } },
  test: {
    include: ['test/layout/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    browser: {
      enabled: true,
      api: { host: '127.0.0.1', port: 5482, strictPort: true },
      headless: true,
      commands: {
        async captureInbox({ frame, page }, name: string) {
          if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid screenshot name')
          const directory = resolve(process.env.PODS_INBOX_SCREENSHOTS ?? '.artifacts/layout')
          await mkdir(directory, { recursive: true })
          const bounds = await (await (await frame()).frameElement()).boundingBox()
          if (!bounds) throw new Error('Inbox test frame is not visible')
          // Capture the visible iframe, including fixed navigation. A full-body
          // element capture produces blank areas beyond Vitest's iframe viewport.
          await page.screenshot({ path: resolve(directory, `${name}.png`), clip: bounds })
        },
      },
      instances: (['light', 'dark'] as const).map(colorScheme => ({
        browser: 'chromium', name: colorScheme, viewport: { width: 390, height: 844 },
        provider: playwright({
          launchOptions: { executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
          contextOptions: { viewport: { width: 1440, height: 1000 }, colorScheme, locale: 'de-AT' },
        }),
      })),
    },
  },
})
