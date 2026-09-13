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
    let page = await app.firstWindow(); await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor(); await mkdir(resolve('.artifacts'), { recursive: true })
    await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Work'); await page.getByRole('button', { name: 'Create group', exact: true }).click()
    await page.getByRole('region', { name: 'Work group' }).waitFor(); const groupId = (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).organization.groups[0]!.id
    await page.getByLabel('Group for Order review', { exact: true }).selectOption(groupId)
    await page.getByRole('button', { name: 'Run once', exact: true }).click(); await page.getByRole('button', { name: 'Local example completed (1)', exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Edit as draft', exact: true }).click()
    const code = '// Knowledge must stay literal\nexport async function run(context) { return { status: "completed", summary: "My text", completedInputIds: [], gapIds: [] } }'
    await page.getByLabel('Script source', { exact: true }).fill(code)
    await page.getByLabel('Language', { exact: true }).selectOption('de'); await page.getByRole('tab', { name: 'Einstellungen', exact: true }).waitFor()
    expect(await page.getByLabel('Skriptquelltext', { exact: true }).inputValue()).toBe(code)
    expect(await page.getByRole('tab', { name: 'Einstellungen', exact: true }).getAttribute('aria-selected')).toBe('true')
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => item.label))).toEqual(['OpenApe Pods', 'Bearbeiten', 'Fenster'])
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0]!.submenu!.items.map(item => item.label))).toContain('Pods beenden')
    await page.getByRole('button', { name: 'Entwurf speichern', exact: true }).click(); await page.getByText('Entwurf gespeichert. Vor der Aktivierung validieren.', { exact: true }).waitFor()
    await page.getByLabel('Sprache', { exact: true }).selectOption('en'); await page.getByText('Draft saved. Validate it before activation.', { exact: true }).waitFor()
    expect(await page.getByLabel('Script source', { exact: true }).inputValue()).toBe(code)
    const drafts = await page.evaluate(id => window.pods.scripts({ type: 'list', podId: id }), pod.id)
    await page.getByLabel('Versions and drafts').selectOption(`version:${original.activeScript}`)
    for (const locale of ['de', 'en'] as const) {
      await page.locator('.language-control select').selectOption(locale)
      await expect.poll(() => page.locator('html').getAttribute('lang')).toBe(locale)
      const suffix = locale === 'de' ? '-de' : '-en'
      for (const [tab, title, ready] of [['Overview', 'Übersicht', 'Aufgabe dieses Pods'], ['Knowledge', 'Wissen', 'Belegte Erkenntnisse'], ['Resources', 'Ressourcen', 'Ausdrückliche Pod-Zugriffe'], ['Runs', 'Läufe', 'Manuelle Ausführung'], ['Settings', 'Einstellungen', 'Lokale Pods']]) {
        await page.getByRole('tab', { name: locale === 'de' ? title : tab, exact: true }).click()
        if (locale === 'de') await page.getByText(ready!, { exact: true }).waitFor()
        if (tab === 'Knowledge') await page.getByText('Delivery is confirmed for Tuesday.', { exact: true }).waitFor()
        if (tab === 'Settings') await page.getByLabel(locale === 'de' ? 'Skriptquelltext' : 'Script source', { exact: true }).waitFor()
        await page.locator('.content').evaluate(element => element.scrollTop = 0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(`.artifacts/handbook-${tab!.toLowerCase()}${suffix}.png`) })
      }
      const panel = page.getByRole('article', { name: locale === 'de' ? 'Skripteditor' : 'Script editor', exact: true })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 1250)); await panel.screenshot({ path: resolve(`.artifacts/handbook-script${suffix}.png`) })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 840))
      for (const [button, german, name, heading] of [['Connections & setup', 'Verbindungen & Einrichtung', 'setup', 'Verbindungen & Einrichtung'], ['Master chat', 'Master-Chat', 'master', 'Master-Chat'], ['Data & backups', 'Daten & Sicherungen', 'data', 'Daten & Sicherungen']]) {
        await page.locator('.sidebar').getByRole('button', { name: locale === 'de' ? german : button, exact: false }).first().click()
        await page.getByRole('heading', { name: locale === 'de' ? heading : button, exact: true }).first().waitFor()
        await page.locator('.content').evaluate(element => element.scrollTop = 0); await page.screenshot({ path: resolve(`.artifacts/handbook-${name}${suffix}.png`) })
      }
      await page.getByRole('tab', { name: locale === 'de' ? 'Übersicht' : 'Overview', exact: true }).click()
      await page.screenshot({ path: resolve(`.artifacts/handbook-groups${suffix}.png`) })
    }
    await page.getByLabel('Language', { exact: true }).selectOption('de')
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await page.locator('.sidebar').getByRole('button', { name: 'Daten & Sicherungen', exact: true }).click()
    await page.getByRole('button', { name: 'Sicherung exportieren …', exact: true }).click()
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (first: unknown, second?: import('electron').MessageBoxOptions) => { const options = second ?? first as import('electron').MessageBoxOptions; if (options.title !== 'Lokalen Pod löschen' || options.buttons?.[0] !== 'Abbrechen' || !options.message.startsWith('Order review')) throw new Error('Native dialog was not German'); return { response: 0, checkboxChecked: false } }
    })
    await page.evaluate(id => window.pods.data({ type: 'deletePod', podId: id, revision: 1, name: 'Order review' }), pod.id)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('tab', { name: 'Einstellungen', exact: true }).click(); await page.getByLabel('Skriptquelltext', { exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const switcher = page.locator('.language-control select')
    const bounds = () => switcher.evaluate(element => element.getBoundingClientRect().right <= innerWidth)
    expect(await bounds()).toBe(true)
    await switcher.evaluate((element) => { (element as HTMLElement).style.minWidth = '1200px' })
    expect(await bounds()).toBe(false)
    await switcher.evaluate(element => (element as HTMLElement).style.removeProperty('min-width'))
    expect(await bounds()).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/language-narrow-dark.png') })
    await app.close(); app = await launch(); page = await app.firstWindow(); await page.getByRole('status').filter({ hasText: 'Bereit' }).waitFor()
    expect(await page.locator('.language-control select').inputValue()).toBe('de')
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods[0]).toEqual(original)
    await page.getByRole('tab', { name: 'Einstellungen', exact: true }).click(); await page.getByLabel('Versionen und Entwürfe').selectOption(`draft:${drafts.drafts[0]!.id}`)
    expect(await page.getByLabel('Skriptquelltext', { exact: true }).inputValue()).toBe(code)
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pod.id)).enabled).toBe(false)
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
