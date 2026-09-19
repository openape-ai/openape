import { fixtureShellIdentity } from './fixtures/shell-identity'
import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { fixtureDirectory } from '../src/main/fixture'

it('script-editor: edits exact source, preserves navigation, validates and runs the visible script in the packaged app', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-script-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Order review' })
  const resources = new ResourceRegistry(store, () => {})
  const reference = join(root, 'order-notes.txt'); await writeFile(reference, 'Synthetic reference: inspect delivery confirmations and keep sources.')
  resources.assignReference(pod.id, 'Order notes', reference)
  store.commitProgress({ podId: pod.id, expectedRevision: 0, checkpoint: { reviewed: 1 }, sources: [{ id: 'order-42', locator: 'fixture:Northwind/order-42', version: '1', content: 'Synthetic sent reply: delivery confirmed for Tuesday. Receiving contact is not yet specified.' }], claims: [{ id: 'delivery', matter: 'Northwind · Order 42', kind: 'finding', text: 'Delivery is confirmed for Tuesday.', sourceIds: ['order-42'] }, { id: 'receiver', matter: 'Northwind · Order 42', kind: 'question', text: 'Who will accept delivery?', sourceIds: ['order-42'] }] })
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
  const original = store.getPod(pod.id).activeScript!; const originalCode = store.readBlob(original).toString('utf8'); store.close()
  const shellIdentity = await fixtureShellIdentity(root)
  const launch = async () => { const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } }); await shellIdentity.encrypt(app, true); return app }
  let app = await launch()
  try {
    let page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.getByRole('tab', { name: 'Script', exact: true }).click()
    let panel = page.getByRole('article', { name: 'Script editor' })
    const editor = () => panel.getByLabel('Script source')
    await expect.poll(() => editor().inputValue()).toBe(originalCode)
    expect(await editor().getAttribute('readonly')).toBeNull()
    const divider = page.getByRole('separator', { name: 'Sidebar width' }); await divider.focus(); await page.keyboard.press('ArrowRight')
    expect(await divider.getAttribute('aria-valuenow')).toBe('240')
    await divider.hover({ position: { x: 3, y: 100 } })
    const position = (await divider.boundingBox())!
    await page.mouse.down(); await page.mouse.move(position.x + 35, position.y + 100, { steps: 4 }); await page.mouse.up()
    await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('272')
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click(); expect(await page.locator('.pod-navigation').isVisible()).toBe(false)
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await panel.getByText('Available variables and secrets', { exact: true }).click(); await panel.getByRole('button', { name: 'Manage variables and secrets' }).click()
    await page.getByLabel('Variable name', { exact: true }).fill('topic'); await page.getByLabel('Variable value', { exact: true }).fill('Orders')
    await page.getByRole('button', { name: 'Save variable', exact: true }).click(); await page.locator('.value-row').getByText('Orders', { exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Script', exact: true }).click(); await panel.getByText('Available variables and secrets', { exact: true }).click()
    expect(await panel.getByLabel('topic', { exact: true }).inputValue()).toBe('context.variables["topic"]')
    await editor().fill('// long script line\n'.repeat(1000))
    const box = panel.locator('.code-editor')
    expect((await box.boundingBox())!.height).toBeLessThan(500)
    const invalid = 'export async function run( { syntax error'
    await editor().fill(invalid)
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await page.getByRole('tab', { name: 'Script', exact: true }).click()
    await expect.poll(() => editor().inputValue()).toBe(invalid)
    await panel.getByRole('button', { name: 'Reload script', exact: true }).click()
    await panel.getByText('Discard unsaved edits and load the current script?', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await panel.getByRole('button', { name: 'Save script', exact: true }).click()
    await panel.getByText('Draft saved. Validate it before activation.', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Run', exact: true }).click()
    await panel.getByRole('alert').waitFor()
    expect((await page.evaluate(id => window.pods.scripts({ type: 'list', podId: id }), pod.id)).pod.activeScript).toBe(original)
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/editor-validation-error.png') })
    const code = `export async function run(context) {
  if (context.variables.topic !== 'Orders') throw new Error('Missing configured variable')
  context.log('Reviewing this pod’s saved progress')
  await context.progress.commit({
    expectedRevision: context.input.checkpointRevision,
    checkpoint: { ...context.input.checkpoint, editorRun: true },
    sources: [],
    claims: [],
  })
  return {
    status: 'completed',
    summary: 'Edited script completed successfully',
    completedInputIds: context.input.eventIds,
    gapIds: [],
  }
}
`
    await editor().fill(code); await editor().press('Meta+s')
    await panel.getByText('Draft saved. Validate it before activation.', { exact: true }).waitFor()
    await app.close(); app = await launch(); page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    expect(await page.getByRole('separator', { name: 'Sidebar width' }).getAttribute('aria-valuenow')).toBe('272')
    await page.getByRole('tab', { name: 'Script', exact: true }).click(); panel = page.getByRole('article', { name: 'Script editor' })
    await expect.poll(() => editor().inputValue()).toBe(code)
    await panel.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByText('Edited script completed successfully', { exact: true }).first().waitFor()
    const active = await page.evaluate(id => window.pods.scripts({ type: 'list', podId: id }), pod.id)
    expect(active.source?.code).toContain(code); expect(digest(active.source!.code)).toBe(active.pod.activeScript); expect(active.pod.activeScript).not.toBe(original)
    await page.getByRole('tab', { name: 'Script', exact: true }).click(); await expect.poll(() => editor().inputValue()).toBe(active.source?.code)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 1250))
    await panel.scrollIntoViewIfNeeded(); await panel.screenshot({ path: resolve('.artifacts/handbook-script.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    await editor().scrollIntoViewIfNeeded(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/editor-narrow-dark.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 950)); await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await page.getByText('Edited script completed successfully', { exact: true }).first().waitFor()
    await expect.poll(async () => (await page.evaluate(id => window.pods.runs({ type: 'list', podId: id }), pod.id)).runs[0]?.state).toBe('completed')
    const latest = await page.evaluate(id => window.pods.runs({ type: 'list', podId: id }), pod.id)
    expect(latest.runs[0]?.scriptHash).toBe(active.pod.activeScript); expect(latest.runs[0]?.state).toBe('completed')
    for (const tab of ['Overview', 'Chat', 'Script', 'Variables and secrets', 'Permissions', 'Settings', 'History']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      if (tab === 'Knowledge') await page.getByText('Delivery is confirmed for Tuesday.', { exact: true }).waitFor()
      if (tab === 'Permissions') await page.getByText('Order notes', { exact: true }).waitFor()
      if (tab === 'History') await page.getByText('Edited script completed successfully', { exact: true }).first().waitFor()
      if (tab === 'Script') await page.getByLabel('Script source').waitFor()
      await page.locator('.content').evaluate(element => element.scrollTop = 0)
      await page.screenshot({ path: resolve(`.artifacts/handbook-${tab.toLowerCase()}.png`) })
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await page.getByRole('button', { name: 'Results and sources', exact: true }).click()
    await page.screenshot({ path: resolve('.artifacts/handbook-knowledge.png') })
    for (const [button, name] of [['Your accounts', 'setup'], ['Workspace chat', 'master'], ['Data & backups', 'data']]) {
      await page.getByRole('button', { name: 'App settings', exact: true }).click(); await page.getByRole('button', { name: button!, exact: true }).click()
      await page.getByRole('heading', { name: name === 'setup' ? 'Your accounts' : button!, exact: true }).first().waitFor()
      await page.screenshot({ path: resolve(`.artifacts/handbook-${name}.png`) })
    }
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pod.id)).enabled).toBe(false)
  }
  finally { await app.close(); await shellIdentity.close(); await rm(root, { recursive: true, force: true }) }
})
