import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { fixtureDirectory } from '../src/main/fixture'
import { PodDatabase } from '../src/worker/storage/database'

it('terminal feedback: shows a failed preparation beside the button without launching Terminal.app', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-terminal-feedback-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); store.createPod({ name: 'Local tools' }); store.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(7000)
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await mkdir(resolve('.artifacts'), { recursive: true })
    for (const language of ['en', 'de'] as const) {
      await page.evaluate(language => window.pods.language({ type: 'set', language }), language); await page.reload()
      await page.getByRole('tab', { name: language === 'en' ? 'Permissions' : 'Berechtigungen', exact: true }).click()
      const button = page.getByRole('button', { name: language === 'en' ? 'Open Terminal.app' : 'Terminal.app öffnen', exact: true })
      await button.click()
      const alert = page.getByRole('alert')
      await alert.waitFor()
      expect(await alert.textContent()).toContain('OpenApe')
      expect(await button.isEnabled()).toBe(true)
      const position = await alert.boundingBox(); const launch = await button.boundingBox()
      expect(position!.y).toBeGreaterThan(launch!.y)
      expect(position!.y - launch!.y).toBeLessThan(90)
      await page.screenshot({ path: resolve(`.artifacts/terminal-feedback-${language}.png`), fullPage: true })
    }
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
