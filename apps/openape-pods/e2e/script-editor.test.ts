import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { fixtureDirectory } from '../src/main/fixture'

it('script-editor: edits exact source, preserves navigation, validates, activates, runs and rolls back in the packaged app', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-script-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Order review', assignment: 'Review assigned order information, keep supported findings and record questions that need an answer.' })
  const resources = new ResourceRegistry(store, () => {})
  const reference = join(root, 'order-notes.txt'); await writeFile(reference, 'Synthetic reference: inspect delivery confirmations and keep sources.')
  resources.assignReference(pod.id, 'Order notes', reference)
  store.commitProgress({ podId: pod.id, expectedRevision: 0, checkpoint: { reviewed: 1 }, sources: [{ id: 'order-42', locator: 'fixture:Northwind/order-42', version: '1', content: 'Synthetic sent reply: delivery confirmed for Tuesday. Receiving contact is not yet specified.' }], claims: [{ id: 'delivery', matter: 'Northwind · Order 42', kind: 'finding', text: 'Delivery is confirmed for Tuesday.', sourceIds: ['order-42'] }, { id: 'receiver', matter: 'Northwind · Order 42', kind: 'question', text: 'Who will accept delivery?', sourceIds: ['order-42'] }] })
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
  const original = store.getPod(pod.id).activeScript!; const originalCode = store.readBlob(original).toString('utf8'); store.close()
  const launch = () => electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  let app = await launch()
  try {
    let page = await app.firstWindow(); await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    let panel = page.getByRole('article', { name: 'Script editor' })
    const editor = () => panel.getByLabel('Script source')
    await expect.poll(() => editor().inputValue()).toBe(originalCode)
    expect(await editor().getAttribute('readonly')).not.toBeNull()
    await panel.getByRole('button', { name: 'Edit as draft', exact: true }).click()
    await editor().fill('// long script line\n'.repeat(1000))
    const box = panel.locator('.code-editor')
    expect((await box.boundingBox())!.height).toBeLessThan(500)
    await box.evaluate((element) => { const style = (element as HTMLElement).style; style.height = 'auto'; style.maxHeight = 'none' })
    expect((await box.boundingBox())!.height).toBeGreaterThan(500)
    await box.evaluate((element) => { const style = (element as HTMLElement).style; style.removeProperty('height'); style.removeProperty('max-height') })
    const invalid = 'export async function run( { syntax error'
    await editor().fill(invalid)
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    await expect.poll(() => editor().inputValue()).toBe(invalid)
    await panel.getByRole('button', { name: 'New script', exact: true }).click()
    await panel.getByText('Discard unsaved edits and open the selected script?', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await panel.getByRole('button', { name: 'Save draft', exact: true }).click()
    await panel.getByText('Draft saved. Validate it before activation.', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Validate draft', exact: true }).click()
    await panel.getByRole('alert').waitFor()
    expect(await panel.getByRole('button', { name: 'Activate for next run' }).isDisabled()).toBe(true)
    expect((await page.evaluate(id => window.pods.scripts({ type: 'list', podId: id }), pod.id)).pod.activeScript).toBe(original)
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/editor-validation-error.png') })
    const code = `export async function run(context) {
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
    const drafts = await page.evaluate(id => window.pods.scripts({ type: 'list', podId: id }), pod.id); const draft = drafts.drafts[0]!
    await app.close(); app = await launch(); page = await app.firstWindow(); await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click(); panel = page.getByRole('article', { name: 'Script editor' })
    await panel.getByLabel('Versions and drafts').selectOption(`draft:${draft.id}`)
    await expect.poll(() => editor().inputValue()).toBe(code)
    await panel.getByRole('button', { name: 'Validate draft', exact: true }).click()
    await panel.getByText('Synthetic sandbox check passed. Review the validated source, then activate it.', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Compare with active version' }).click()
    await panel.getByText('Active version for comparison', { exact: true }).waitFor()
    expect(await panel.locator('.source-preview').last().textContent()).toBe(originalCode)
    await panel.getByRole('button', { name: 'Activate for next run' }).click()
    await panel.getByText('Activated for the next run. Existing runs retain their pinned version.', { exact: true }).waitFor()
    const active = await page.evaluate(id => window.pods.scripts({ type: 'list', podId: id }), pod.id)
    expect(active.source?.code).toContain(code); expect(digest(active.source!.code)).toBe(active.pod.activeScript); expect(active.pod.activeScript).not.toBe(original)
    expect(await editor().inputValue()).toBe(active.source?.code)
    await panel.getByRole('button', { name: 'Edit as draft' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 1250))
    await panel.scrollIntoViewIfNeeded(); await panel.screenshot({ path: resolve('.artifacts/handbook-script.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    await editor().scrollIntoViewIfNeeded(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/editor-narrow-dark.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 950)); await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: 'Run once', exact: true }).click()
    await page.getByRole('button', { name: 'Edited script completed successfully', exact: true }).waitFor()
    const latest = await page.evaluate(id => window.pods.runs({ type: 'list', podId: id }), pod.id)
    expect(latest.runs[0]?.scriptHash).toBe(active.pod.activeScript); expect(latest.runs[0]?.state).toBe('completed')
    for (const tab of ['Overview', 'Knowledge', 'Resources', 'Runs', 'Settings']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      if (tab === 'Knowledge') await page.getByText('Delivery is confirmed for Tuesday.', { exact: true }).waitFor()
      if (tab === 'Resources') await page.getByText('Order notes', { exact: true }).waitFor()
      if (tab === 'Runs') await page.getByRole('button', { name: 'Edited script completed successfully', exact: true }).waitFor()
      if (tab === 'Settings') await page.getByLabel('Script source').waitFor()
      await page.locator('.content').evaluate(element => element.scrollTop = 0)
      await page.screenshot({ path: resolve(`.artifacts/handbook-${tab.toLowerCase()}.png`) })
    }
    await panel.getByLabel('Versions and drafts').selectOption(`version:${original}`)
    await expect.poll(() => editor().inputValue()).toBe(originalCode)
    await panel.getByRole('button', { name: 'Activate for next run' }).click()
    await expect.poll(async () => (await page.evaluate(id => window.pods.scripts({ type: 'list', podId: id }), pod.id)).pod.activeScript).toBe(original)
    for (const [button, name] of [['Connections & setup', 'setup'], ['Master chat', 'master'], ['Data & backups', 'data']]) {
      await page.getByRole('button', { name: button!, exact: false }).first().click()
      await page.getByRole('heading', { name: button!, exact: true }).first().waitFor()
      if (name === 'data') await page.getByText('Application data', { exact: true }).waitFor()
      await page.locator('.content').evaluate(element => element.scrollTop = 0)
      await page.screenshot({ path: resolve(`.artifacts/handbook-${name}.png`) })
    }
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pod.id)).enabled).toBe(false)
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
