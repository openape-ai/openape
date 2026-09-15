import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { fixtureDirectory } from '../src/main/fixture'

const active: { app: ElectronApplication, child: ChildProcess, root: string }[] = []
afterEach(async () => { for (const { app, child, root } of active.splice(0)) { if (child.exitCode === null && child.signalCode === null) await app.close(); await rm(root, { recursive: true, force: true }) } })
async function launch() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-workspace-'))); fixtureDirectory(root)
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Mail knowledge' })
  const other = store.createPod({ name: 'Archived research' }); store.updatePod(other.id, 1, { name: other.name, lifecycle: 'archived' })
  const registry = new ResourceRegistry(store, () => {})
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8')); installExample(store, registry, pod.id, 'deterministic', runtime.dependencyLockHash)
  for (const revision of [0, 1]) store.commitProgress({ podId: pod.id, expectedRevision: revision, checkpoint: { fixture: true }, sources: [{ id: `order-mail-${revision}`, version: String(revision), locator: 'fixture:Northwind/order-42', content: revision ? 'Sent reply confirms Tuesday delivery.' : 'Incoming request asks for Monday delivery.' }], claims: [{ id: `delivery-${revision}`, matter: 'Northwind · Order 42', kind: 'finding', text: revision ? 'Delivery is confirmed for Tuesday.' : 'Delivery was requested for Monday.', sourceIds: [`order-mail-${revision}`], ...(revision ? { supersedes: 'delivery-0' } : {}) }, ...(revision ? [{ id: 'question', matter: 'Northwind · Order 42', kind: 'question' as const, text: 'Who will accept delivery?', sourceIds: [`order-mail-${revision}`] }, { id: 'gap', matter: 'Attachment verification', kind: 'gap' as const, text: 'The encrypted attachment could not be inspected.', sourceIds: [`order-mail-${revision}`] }] : [])] })
  const rawHash = store.putBlob(JSON.stringify({ provider: 'synthetic-mail', body: 'Sent reply confirms Tuesday delivery.' }))
  store.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?)').run(pod.id, 'raw-order-mail', '1', 'fixture:Northwind/order-42/raw', rawHash)
  store.db.prepare('INSERT INTO source_derivations VALUES(?,?,?,?)').run(pod.id, 'order-mail-1', 'raw-order-mail', 'synthetic-extraction-v1')
  const reference = join(root, 'reference.txt'); await writeFile(reference, 'SYNTHETIC_REFERENCE'); registry.assignReference(pod.id, 'Reference', reference)
  installExample(store, registry, pod.id, 'deterministic', runtime.dependencyLockHash)
  for (const [kind, state, name] of [['connection', 'expired', 'Microsoft fixture'], ['tool', 'missing', 'o365-cli fixture']] as const) store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), pod.id, kind, state, name, JSON.stringify({ account: 'fixture@example.invalid', scope: 'Read-only selected folders' }))
  store.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  active.push({ app, child: app.process(), root }); const page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
  return { app, page, pod }
}
describe('pod-workspace concept B', () => {
  it('uses persisted pods, separates knowledge states, expands sources and opens contextual master chat', async () => {
    const { app, page } = await launch()
    await page.getByRole('heading', { name: 'Mail knowledge', exact: true }).waitFor()
    expect(await page.locator('.pod-button').count()).toBe(2)
    await page.getByRole('button', { name: 'Results and sources', exact: true }).click()
    await page.getByText('Delivery is confirmed for Tuesday.', { exact: true }).waitFor()
    expect(await page.getByText('Delivery was requested for Monday.', { exact: true }).count()).toBe(0)
    await page.getByLabel('Include superseded history').check()
    await page.getByText('Delivery was requested for Monday.', { exact: true }).waitFor()
    const current = page.locator('.knowledge-entry').filter({ hasText: 'Delivery is confirmed for Tuesday.' })
    await current.locator('summary').click(); await current.getByRole('button').click()
    await page.locator('pre').filter({ hasText: 'Sent reply confirms Tuesday delivery.' }).waitFor()
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.locator('.source-content').screenshot({ path: resolve('.artifacts/workspace-source.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(560, 700))
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('.source-content').screenshot({ path: resolve('.artifacts/mail-source-narrow-dark.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1060, 850))
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: 'Inspect original retained source' }).click()
    await page.locator('pre').filter({ hasText: 'synthetic-mail' }).waitFor()
    await page.locator('.source-content').screenshot({ path: resolve('.artifacts/mail-original-source.png') })
    await page.getByRole('button', { name: 'Discuss knowledge' }).click()
    await page.getByRole('log', { name: 'Pod conversation' }).waitFor()
    await page.screenshot({ path: resolve('.artifacts/workspace-master.png') })
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click()
    await page.getByRole('heading', { name: 'Executable applications', exact: true }).waitFor(); expect(await page.getByText('Microsoft fixture', { exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Preview next snapshot' }).click(); await page.getByRole('heading', { name: 'Snapshot ready' }).waitFor()
    await page.locator('.resource-row').filter({ hasText: 'Reference' }).getByRole('button', { name: 'Revoke access' }).click()
    await page.getByText('revoked · revision 2', { exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click(); await page.getByText('More options', { exact: true }).click()
    expect(await page.getByLabel('Assignment', { exact: true }).count()).toBe(0)
    expect(await page.getByText('Execution assignment', { exact: true }).count()).toBe(0)
    await page.getByLabel('Pod name').fill('Renamed research')
    await page.getByRole('button', { name: 'Save pod', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Settings saved' }).waitFor()
    await page.getByRole('heading', { name: 'Renamed research', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/script-authority-settings.png') })
    await page.locator('.lifecycle-panel').screenshot({ path: resolve('.artifacts/script-authority-options.png') })
    await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await page.getByText('Describe this pod in Chat to create its description.', { exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Resume automatic execution', exact: true }).click(); await expect.poll(async () => (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods[0]!.lifecycle).toBe('active')
    await page.getByRole('button', { name: 'Pause automatic execution', exact: true }).click()
    await page.getByRole('tab', { name: 'History', exact: true }).click(); await page.getByRole('button', { name: 'Use local example', exact: true }).click(); await page.getByRole('button', { name: 'Start run', exact: true }).click()
    await page.getByRole('button', { name: 'Local example completed (1)', exact: true }).waitFor()
    await page.getByText('Persisted events', { exact: true }).click(); await page.getByText('checkpoint', { exact: false }).first().waitFor()
    await page.locator('.pod-button').filter({ hasText: 'Archived research' }).click(); await page.getByRole('heading', { name: 'Archived research', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Run now', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: 'New pod', exact: false }).click(); await page.getByRole('heading', { name: 'New pod', exact: true }).waitFor()
  })
  it('fits all seven views at desktop, compact and narrow widths in light and dark appearance', async () => {
    const { app, page } = await launch(); await mkdir(resolve('.artifacts'), { recursive: true })
    for (const [width, height] of [[1280, 800], [1060, 850], [760, 700], [560, 700], [560, 560]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0]!, size[1]!), [width!, height!])
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme })
        for (const tab of ['Overview', 'Chat', 'Script', 'Variables and secrets', 'Permissions', 'Settings', 'History']) {
          await page.getByRole('tab', { name: tab, exact: true }).click()
          if (tab === 'Settings') await expect.poll(() => page.getByLabel('Pod name', { exact: true }).inputValue(), { timeout: 5000 }).toBe('Mail knowledge')
          if (tab === 'Knowledge') await page.getByText('Delivery is confirmed for Tuesday.', { exact: true }).waitFor()
          if (tab === 'Permissions') await page.getByRole('heading', { name: 'Executable applications', exact: true }).waitFor()
          await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
          const fit = await page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth, content: document.querySelector('.content')!.scrollWidth, contentWidth: document.querySelector('.content')!.clientWidth, footer: document.querySelector('.workspace')!.getBoundingClientRect().bottom, height: innerHeight }))
          expect(fit.root).toBeLessThanOrEqual(fit.width); expect(fit.content).toBeLessThanOrEqual(fit.contentWidth + 1); expect(fit.footer).toBeLessThanOrEqual(fit.height + 1)
          await page.screenshot({ path: resolve(`.artifacts/workspace-${width}${height === 560 ? '-min' : ''}-${theme}-${tab.toLowerCase()}.png`) })
        }
      }
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus(); await page.keyboard.press('ArrowRight')
    expect(await page.getByRole('tab', { name: 'Chat', exact: true }).getAttribute('aria-selected')).toBe('true')
  })
})
