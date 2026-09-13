import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

for (const locale of ['en', 'de']) {
  it(`handbook: renders complete ${locale} offline edition with working navigation and narrow dark layout`, async () => {
    execFileSync(process.execPath, ['scripts/handbook.mjs'], { cwd: resolve('.'), stdio: 'pipe' })
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
      const name = `openape-pods-handbook${locale === 'de' ? '.de' : ''}.html`
      await page.goto(pathToFileURL(resolve('.artifacts', name)).href)
      await page.locator('img').evaluateAll(images => images.forEach(image => (image as HTMLImageElement).loading = 'eager'))
      await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0))
      expect(await page.locator('html').getAttribute('lang')).toBe(locale)
      expect(await page.locator('section').count()).toBe(17); expect(await page.locator('img').count()).toBe(10)
      expect(await page.locator('nav a[href^="#"]').evaluateAll(links => links.every(link => document.querySelector(link.getAttribute('href')!)))).toBe(true)
      await page.locator('nav a[href="#language"]').click(); expect(new URL(page.url()).hash).toBe('#language')
      await page.screenshot({ path: resolve(`.artifacts/handbook-language-${locale}.png`) })
      await page.setViewportSize({ width: 560, height: 850 }); await page.emulateMedia({ colorScheme: 'dark' }); await page.locator('#language').scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const content = page.locator('main'); await content.evaluate(element => (element as HTMLElement).style.minWidth = '1200px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(true)
      await content.evaluate(element => (element as HTMLElement).style.removeProperty('min-width'))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(`.artifacts/handbook-language-${locale}-dark.png`) })
      await page.locator('nav a').first().click(); await page.waitForLoadState()
      expect(await page.locator('html').getAttribute('lang')).toBe(locale === 'de' ? 'en' : 'de')
      expect(await page.locator('section').count()).toBe(17)
    }
    finally { await browser.close() }
  })
}
