import '../../app/assets/main.css'
import { commands, page } from 'vitest/browser'
import { beforeEach } from 'vitest'

declare module 'vitest/browser' {
  interface BrowserCommands {
    captureBriefing: (name: string) => Promise<void>
    setColorScheme: (colorScheme: 'light' | 'dark') => Promise<void>
  }
}

beforeEach(async () => {
  await commands.setColorScheme('light')
  await page.viewport(390, 844)
})
