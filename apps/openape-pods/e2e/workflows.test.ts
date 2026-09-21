import { _electron as electron } from 'playwright'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { WorkflowEngine } from '../src/worker/workflows/engine'
import { fixtureDirectory } from '../src/main/fixture'
import { fixtureShellIdentity } from './fixtures/shell-identity'

it('workflow graph: runs unchanged pods through the real worker and renders dependencies at every supported width', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-workflow-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); const resources = new ResourceRegistry(store, () => {})
  const manifest = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const pods = ['Inbox filter', 'Important mail summary with a deliberately long name', 'Archive audit', 'Delivery confirmation'].map(name => store.createPod({ name }))
  for (const pod of pods) installExample(store, resources, pod.id, 'deterministic', manifest.dependencyLockHash)
  const id = randomUUID()
  new WorkflowEngine(store, { start: () => { throw new Error('Setup must not execute pods') }, cancelPod: () => {} }, { inspect: async () => {} }).save({ type: 'save', id, revision: 0, name: 'Synthetic inbox workflow', nodes: pods.map((pod, index) => ({ podId: pod.id, after: index === 0 ? [] : index === 3 ? [pods[1]!.id, pods[2]!.id] : [pods[0]!.id], handoff: false })), schedule: { kind: 'cron', expression: '0 9 * * 1-5', timezone: 'Europe/Vienna' }, enabled: false })
  const before = store.listPods(); store.close()
  const identity = await fixtureShellIdentity(root)
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    await identity.encrypt(app, true)
    const page = await app.firstWindow(); page.setDefaultTimeout(10000)
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('button', { name: 'Synthetic inbox workflow', exact: true }).click()
    await page.getByRole('heading', { name: 'Synthetic inbox workflow', exact: true }).waitFor()
    expect(await page.locator('.workflow-layer').count()).toBe(3)
    expect(await page.locator('.workflow-layer').nth(1).locator('.workflow-node').count()).toBe(2)
    await mkdir(resolve('.artifacts'), { recursive: true })
    for (const width of [1060, 760, 560]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 900), width)
      await page.emulateMedia({ colorScheme: width === 560 ? 'dark' : 'light' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('.workflow-node').evaluateAll(nodes => nodes.every((node) => { const box = node.getBoundingClientRect(); return box.width >= 170 && box.right <= innerWidth }))).toBe(true)
      await page.screenshot({ path: resolve(`.artifacts/workflows-${width}.png`), fullPage: true })
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1060, 950))
    await page.getByRole('button', { name: 'Edit workflow', exact: true }).click()
    await page.locator('.workflow-dependencies').first().getByRole('checkbox').first().focus()
    await page.keyboard.press('Space')
    await page.getByRole('alert').filter({ hasText: 'cycle' }).waitFor()
    expect(await page.getByRole('button', { name: 'Save workflow', exact: true }).isDisabled()).toBe(true)
    await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Run workflow once', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pods.workflows({ type: 'list' }))).runs[0]?.state, { timeout: 30000 }).toBe('completed')
    const state = await page.evaluate(() => window.pods.workflows({ type: 'list' }))
    const run = state.runs[0]!
    expect(run.nodes.map(node => node.state)).toEqual(['completed', 'completed', 'completed', 'completed'])
    const after = await page.evaluate(() => window.pods.workspace({ type: 'list' }))
    expect(after.pods.map(pod => ({ id: pod.id, lifecycle: pod.lifecycle, activeScript: pod.activeScript }))).toEqual(before.map(pod => ({ id: pod.id, lifecycle: pod.lifecycle, activeScript: pod.activeScript })))
    expect(state.workflows[0]).toMatchObject({ enabled: false, paused: true })
    const records = await Promise.all(pods.map(pod => page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)))
    expect(records[1]!.runs[0]!.startedAt).toBeGreaterThanOrEqual(records[0]!.runs[0]!.finishedAt!)
    expect(records[2]!.runs[0]!.startedAt).toBeGreaterThanOrEqual(records[0]!.runs[0]!.finishedAt!)
    expect(records[3]!.runs[0]!.startedAt).toBeGreaterThanOrEqual(Math.max(records[1]!.runs[0]!.finishedAt!, records[2]!.runs[0]!.finishedAt!))
    await page.screenshot({ path: resolve('.artifacts/workflows-completed.png'), fullPage: true })
    await page.evaluate(() => window.pods.language({ type: 'set', language: 'de' })); await page.reload()
    await page.getByRole('button', { name: 'Synthetic inbox workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Workflow bearbeiten', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Mail-Filterung und Benachrichtigung konfigurieren' }).check()
    await page.getByText('Geschützte Kommunikationspartner', { exact: true }).waitFor()
    await page.locator('.mail-workflow-settings').scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/workflows-mail-policy-de.png'), fullPage: true })
  }
  finally { await app.close(); await identity.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
