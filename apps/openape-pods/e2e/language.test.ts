import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { fixtureDirectory } from '../src/main/fixture'

it('language: switches every packaged view and native menus, preserves edits and persists across restart', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-language-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Order review', assignment: 'Review assigned order information and retain sourced findings.' })
  const resources = new ResourceRegistry(store, () => {})
  const reference = join(root, 'order-notes.txt'); await writeFile(reference, 'Synthetic reference: delivery on Tuesday.')
  resources.assignReference(pod.id, 'Order notes', reference)
  store.commitProgress({ podId: pod.id, expectedRevision: 0, checkpoint: { reviewed: 1 }, sources: [{ id: 'order-42', locator: 'fixture:Northwind/order-42', version: '1', content: 'Synthetic reply: delivery confirmed for Tuesday.' }], claims: [{ id: 'delivery', matter: 'Northwind · Order 42', kind: 'finding', text: 'Delivery is confirmed for Tuesday.', sourceIds: ['order-42'] }] })
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
  const original = store.getPod(pod.id); store.close()
  const launch = () => electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  let app = await launch()
  try {
    let page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready'); await mkdir(resolve('.artifacts'), { recursive: true })
    const code = '// Saved editor text stays literal\nexport async function run(context) { return { status: "completed", summary: "My text", completedInputIds: [], gapIds: [] } }'
    await page.getByRole('tab', { name: 'Script', exact: true }).click(); await page.getByLabel('Script source', { exact: true }).fill(code)
    await page.getByRole('button', { name: 'App settings', exact: true }).click(); await page.getByLabel('Language', { exact: true }).selectOption('de')
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => item.label))).toEqual(['OpenApe Pods', 'Bearbeiten', 'Fenster'])
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0]!.submenu!.items.map(item => item.label))).toContain('Pods beenden')
    await page.locator('.pod-button').first().click(); await page.getByRole('tab', { name: 'Skript', exact: true }).click()
    expect(await page.getByLabel('Skriptquelltext', { exact: true }).inputValue()).toBe(code)
    await page.getByRole('button', { name: 'Skript speichern', exact: true }).click(); await page.getByRole('status').waitFor()
    for (const locale of ['de', 'en'] as const) {
      await page.locator('.nav-button').click(); await page.locator('.language-control select').selectOption(locale)
      await expect.poll(() => page.locator('html').getAttribute('lang')).toBe(locale)
      await page.locator('.pod-button').first().click()
      const suffix = locale === 'de' ? '-de' : '-en'
      for (const [tab, german] of [['Overview', 'Übersicht'], ['Chat', 'Chat'], ['Script', 'Skript'], ['Permissions', 'Berechtigungen'], ['Settings', 'Einstellungen'], ['History', 'Historie']]) {
        await page.getByRole('tab', { name: locale === 'de' ? german : tab, exact: true }).click()
        await page.getByRole('tabpanel').waitFor()
        if (tab === 'Script') await expect.poll(() => page.getByLabel(locale === 'de' ? 'Skriptquelltext' : 'Script source', { exact: true }).inputValue()).toBe(code)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(`.artifacts/handbook-${tab!.toLowerCase()}${suffix}.png`) })
      }
      await page.getByRole('tab', { name: locale === 'de' ? 'Übersicht' : 'Overview', exact: true }).click()
      await page.getByRole('button', { name: locale === 'de' ? 'Ergebnisse und Quellen' : 'Results and sources', exact: true }).click()
      await page.getByText('Delivery is confirmed for Tuesday.', { exact: true }).waitFor()
      expect(await page.getByRole('tab', { name: locale === 'de' ? 'Übersicht' : 'Overview', exact: true }).getAttribute('tabindex')).toBe('0')
      await page.screenshot({ path: resolve(`.artifacts/handbook-knowledge${suffix}.png`) })
      await page.getByRole('tab', { name: locale === 'de' ? 'Einstellungen' : 'Settings', exact: true }).click()
      await page.getByText(locale === 'de' ? 'Variablen und Geheimnisse' : 'Variables and secrets', { exact: true }).click()
      await page.locator('.credential-form').screenshot({ path: resolve(`.artifacts/handbook-credentials${suffix}.png`) })
      for (const [button, german, name] of [['Connections & setup', 'Verbindungen & Einrichtung', 'setup'], ['Workspace chat', 'Arbeitsbereich-Chat', 'master'], ['Data & backups', 'Daten & Sicherungen', 'data']]) {
        await page.locator('.nav-button').click(); await page.getByRole('button', { name: locale === 'de' ? german : button, exact: true }).click()
        await page.getByRole('heading', { name: locale === 'de' ? german : button, exact: true }).first().waitFor()
        await page.screenshot({ path: resolve(`.artifacts/handbook-${name}${suffix}.png`) })
      }
      await page.locator('.pod-button').first().click(); await page.screenshot({ path: resolve(`.artifacts/handbook-groups${suffix}.png`) })
    }
    await page.locator('.nav-button').click(); await page.getByLabel('Language', { exact: true }).selectOption('de')
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (first: unknown, second?: import('electron').MessageBoxOptions) => { const options = second ?? first as import('electron').MessageBoxOptions; if (options.title !== 'Lokalen Pod löschen' || options.buttons?.[0] !== 'Abbrechen' || !options.message.startsWith('Order review')) throw new Error('Native dialog was not German'); return { response: 0, checkboxChecked: false } }
    })
    await page.evaluate(id => window.pods.data({ type: 'deletePod', podId: id, revision: 1, name: 'Order review' }), pod.id)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    const switcher = page.locator('.language-control select'); const bounds = () => switcher.evaluate(element => element.getBoundingClientRect().right <= innerWidth)
    expect(await bounds()).toBe(true); await switcher.evaluate(element => (element as HTMLElement).style.minWidth = '1200px'); expect(await bounds()).toBe(false); await switcher.evaluate(element => (element as HTMLElement).style.removeProperty('min-width'))
    await page.screenshot({ path: resolve('.artifacts/language-narrow-dark.png') })
    await app.close(); app = await launch(); page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.locator('.nav-button').click(); expect(await page.locator('.language-control select').inputValue()).toBe('de')
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods[0]).toEqual(original)
    await page.locator('.pod-button').first().click(); await page.getByRole('tab', { name: 'Skript', exact: true }).click()
    await expect.poll(() => page.getByLabel('Skriptquelltext', { exact: true }).inputValue()).toBe(code)
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pod.id)).enabled).toBe(false)
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
