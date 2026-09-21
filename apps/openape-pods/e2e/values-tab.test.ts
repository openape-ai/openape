import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { fixtureDirectory } from '../src/main/fixture'
import { PodDatabase } from '../src/worker/storage/database'

it('values tab: exposes empty variables and missing secrets in both languages without assigning access', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-values-tab-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Notification example' }); store.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(7000)
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.evaluate(async (podId) => {
      for (const name of ['application_id', 'chat_id']) await window.pods.resources({ type: 'saveVariable', podId, name, value: '', revision: 0 })
      await window.pods.scripts({ type: 'save', podId, revision: 1, draftId: null, draftRevision: 0, code: 'export async function run(context) { return { status: "completed", summary: "Example", completedInputIds: [], gapIds: [] } }', capabilities: ['credential.notification_token'] })
    }, pod.id)
    await mkdir(resolve('.artifacts'), { recursive: true })
    for (const language of ['en', 'de'] as const) {
      await page.evaluate(language => window.pods.language({ type: 'set', language }), language); await page.reload()
      const tabName = language === 'en' ? 'Variables and secrets' : 'Variablen und Geheimnisse'
      await page.getByRole('tab', { name: tabName, exact: true }).click()
      await expect.poll(() => page.locator('.value-row').count()).toBe(2)
      expect(await page.locator('.value-row').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining(language === 'en' ? 'Not set' : 'Nicht hinterlegt')]))
      const secret = page.locator('.resource-row').filter({ hasText: 'notification_token' })
      await secret.getByRole('button', { name: language === 'en' ? 'Set secret' : 'Geheimnis hinterlegen', exact: true }).click()
      await expect.poll(() => page.locator('[name="credential-alias"]').inputValue()).toBe('notification_token')
      expect(await page.locator('[name="credential-value"]').inputValue()).toBe('')
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 1050))
      await page.screenshot({ path: resolve(`.artifacts/values-tab-${language}.png`), fullPage: true })
      await page.getByRole('tab', { name: language === 'en' ? 'Settings' : 'Einstellungen', exact: true }).click()
      await page.locator('#panel-Settings').waitFor()
      expect(await page.locator('.credential-form').count()).toBe(0)
    }
    await page.getByRole('tab', { name: 'Variablen und Geheimnisse', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(560, 850)); await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.value-row > div').first().evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(160)
    await page.screenshot({ path: resolve('.artifacts/values-tab-de-dark.png'), fullPage: true })
    const resources = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)
    expect(resources.resources).toEqual([])
    expect(resources.variables?.every(variable => variable.value === '')).toBe(true)
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
