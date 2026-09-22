import { chromium, _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { RunStore } from '../src/worker/runs/store'
import { SetupControl } from '../src/worker/onboarding/control'
import { MasterConversations } from '../src/worker/master/conversations'
import { fixtureDirectory } from '../src/main/fixture'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
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
      expect(await page.locator('section').count()).toBe(25); expect(await page.locator('img').count()).toBe(12)
      expect(await page.locator('nav a[href^="#"]').evaluateAll(links => links.every(link => document.querySelector(link.getAttribute('href')!)))).toBe(true)
      await page.addStyleTag({ content: 'html { scroll-behavior: auto; }' })
      await page.locator('nav a[href="#credentials"]').click(); expect(new URL(page.url()).hash).toBe('#credentials')
      await page.screenshot({ path: resolve(`.artifacts/handbook-credential-chapter-${locale}.png`) })
      await page.setViewportSize({ width: 560, height: 850 }); await page.emulateMedia({ colorScheme: 'dark' }); await page.locator('#credentials').scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const content = page.locator('main'); await content.evaluate(element => (element as HTMLElement).style.minWidth = '1200px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(true)
      await content.evaluate(element => (element as HTMLElement).style.removeProperty('min-width'))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(`.artifacts/handbook-credential-chapter-${locale}-dark.png`) })
      await page.locator('nav a').first().click(); await page.waitForLoadState()
      expect(await page.locator('html').getAttribute('lang')).toBe(locale === 'de' ? 'en' : 'de')
      expect(await page.locator('section').count()).toBe(25)
    }
    finally { await browser.close() }
  })
}

it('handbook: captures current native screens from isolated synthetic data without executing tasks', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-handbook-')))
  fixtureDirectory(root)
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Sample folder review' })
  const resources = new ResourceRegistry(store, () => {})
  const reference = join(root, 'sample-notes.txt')
  await writeFile(reference, 'Synthetic reference: three sample files are ready for review.')
  resources.assignReference(pod.id, 'Sample notes', reference)
  store.commitProgress({ podId: pod.id, expectedRevision: 0, checkpoint: { reviewed: 3 }, sources: [{ id: 'sample-files', locator: 'fixture:sample-folder', version: '1', content: 'Synthetic fixture: notes.txt, order.txt, delivery.txt.' }], claims: [{ id: 'file-count', matter: 'Sample folder', kind: 'finding', text: 'Three sample files are available. No files were changed.', sourceIds: ['sample-files'] }] })
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
  const runs = new RunStore(store)
  const activeScript = store.getPod(pod.id).activeScript
  if (!activeScript) throw new Error('Synthetic script was not saved')
  const { run } = runs.reserve(pod.id, activeScript, resources.epoch(pod.id))
  runs.finish(run.id, 'completed', 'Synthetic example completed. Review the retained sample findings.', null)
  for (const [index, role, body] of [
    [0, 'user', 'Prepare a local example for my sample folder review. Leave automatic execution disabled.'],
    [1, 'assistant', 'A local example script is saved. Open Script to inspect it and Permissions to review access before your first manual run.'],
  ] as const) {
    const id = randomUUID()
    store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(id, role, body, role === 'user' ? 'sent' : 'completed', Date.now() + index)
    new MasterConversations(store).assign(id, pod.id)
  }
  const setup = new SetupControl(store, resources)
  const owner = randomUUID()
  setup.execute({ type: 'save', connection: { id: owner, provider: 'openape', account: 'reader@example.invalid', state: 'ready', error: null }, metadata: { issuer: 'https://id.example.invalid' } })
  setup.execute({ type: 'save', connection: { id: randomUUID(), provider: 'chatgpt', account: 'reader@example.invalid', state: 'ready', error: null }, metadata: {} })
  store.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow()
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.locator('.pod-button').first().waitFor()
    await expect.poll(() => page.getByRole('button', { name: 'OpenApe account', exact: true }).textContent()).toContain('reader@example.invalid')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1180, 1000))
    await mkdir(resolve('.artifacts'), { recursive: true })
    for (const locale of ['en', 'de'] as const) {
      const title = (en: string, de: string) => locale === 'en' ? en : de
      const shot = async (name: string, locator = page.locator('body')) => {
        await locator.screenshot({ path: resolve(`.artifacts/handbook-${name}-${locale}.png`) })
      }
      await page.getByRole('button', { name: /^(App settings|App-Einstellungen)$/ }).click()
      await page.locator('.language-control select').selectOption(locale)
      await page.getByRole('button', { name: title('Your accounts', 'Deine Konten'), exact: true }).click()
      await page.getByText(`reader@example.invalid · ${title('Signed in', 'Angemeldet')}`, { exact: true }).first().waitFor()
      await shot('setup')
      await page.locator('.pod-button').first().click()
      for (const [en, de, name] of [
        ['Overview', 'Übersicht', 'overview'], ['Chat', 'Chat', 'chat'], ['Script', 'Skript', 'script'],
        ['Permissions', 'Berechtigungen', 'permissions'], ['History', 'Historie', 'history'],
      ]) {
        await page.getByRole('tab', { name: title(en!, de!), exact: true }).click()
        await page.getByRole('tabpanel').waitFor()
        if (name === 'chat') await page.getByText('A local example script is saved.', { exact: false }).waitFor()
        if (name === 'script') await expect.poll(() => page.getByLabel(title('Script source', 'Skriptquelltext'), { exact: true }).inputValue()).toContain('Local example completed')
        await shot(name!)
      }
      await page.getByRole('tab', { name: title('Variables and secrets', 'Variablen und Geheimnisse'), exact: true }).click()
      expect(await page.locator('input[type="password"]').inputValue()).toBe('')
      await shot('credentials', page.locator('.credential-form'))
      await page.getByRole('tab', { name: title('Settings', 'Einstellungen'), exact: true }).click()
      const identity = page.locator('.pod-identity')
      await identity.getByRole('button', { name: title('Allow requests from this provider', 'Anfragen von diesem Anbieter erlauben'), exact: true }).click()
      await identity.getByRole('button', { name: title('Confirm permission', 'Erlaubnis bestätigen'), exact: true }).waitFor()
      await shot('identity', identity)
      await shot('settings', page.locator('.schedule-panel'))
      await page.getByRole('tab', { name: title('Overview', 'Übersicht'), exact: true }).click()
      await shot('groups')
      await page.getByRole('button', { name: title('Results and sources', 'Ergebnisse und Quellen'), exact: true }).click()
      await page.getByText('Three sample files are available. No files were changed.', { exact: true }).waitFor()
      await shot('knowledge')
      await page.getByRole('button', { name: title('App settings', 'App-Einstellungen'), exact: true }).click()
      await page.getByRole('button', { name: title('Data & backups', 'Daten & Sicherungen'), exact: true }).click()
      await page.getByRole('heading', { name: title('Data & backups', 'Daten & Sicherungen'), exact: true }).first().waitFor()
      await shot('data')
    }
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pod.id)).enabled).toBe(false)
    expect((await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).connections.every(connection => !connection.broker)).toBe(true)
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' })))).toMatchObject({ pods: [{ id: pod.id, activeScript }] })
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
