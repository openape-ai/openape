import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { fixtureDirectory } from '../src/main/fixture'

it('groups: organizes pods through the packaged sidebar and retains grouping across restart', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-groups-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Order review' }); const other = store.createPod({ name: 'Reading notes' })
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  installExample(store, new ResourceRegistry(store, () => {}), pod.id, 'deterministic', runtime.dependencyLockHash)
  const original = store.getPod(pod.id); store.close()
  const launch = () => electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  let app = await launch()
  try {
    let page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Clients'); await page.getByRole('button', { name: 'Create group', exact: true }).click()
    await page.getByRole('region', { name: 'Clients group', exact: true }).waitFor()
    const groups = await page.evaluate(() => window.pods.workspace({ type: 'list' })); const groupId = groups.organization.groups[0]!.id
    await page.getByRole('tab', { name: 'Settings', exact: true }).click(); await page.getByLabel('Group', { exact: true }).selectOption(groupId)
    await page.getByRole('region', { name: 'Clients group' }).getByRole('button', { name: 'Order review paused', exact: true }).waitFor()
    const source = page.getByRole('button', { name: 'Reading notes paused', exact: true })
    await expect.poll(() => source.getAttribute('draggable')).toBe('true')
    const transfer = await page.evaluateHandle(() => new DataTransfer())
    await source.dispatchEvent('dragstart', { dataTransfer: transfer })
    const target = page.getByRole('region', { name: 'Clients group' })
    await target.dispatchEvent('dragover', { dataTransfer: transfer })
    await target.dispatchEvent('drop', { dataTransfer: transfer })
    await source.dispatchEvent('dragend', { dataTransfer: transfer })
    await transfer.dispose()
    await expect.poll(async () => (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).organization.groups[0]!.podIds.length).toBe(2)
    await page.getByRole('button', { name: 'Edit Clients group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Work'); await page.getByRole('button', { name: 'Save group', exact: true }).click()
    await page.getByRole('region', { name: 'Work group' }).waitFor()
    await mkdir(resolve('.artifacts'), { recursive: true }); await page.screenshot({ path: resolve('.artifacts/handbook-groups.png') })
    await page.getByRole('region', { name: 'Work group' }).locator('.group-toggle').click()
    await expect.poll(() => page.getByRole('region', { name: 'Work group' }).getByRole('button', { name: 'Order review paused', exact: true }).isVisible()).toBe(false)
    await app.close(); app = await launch(); page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    const state = await page.evaluate(() => window.pods.workspace({ type: 'list' })); expect(state.organization.groups[0]).toMatchObject({ id: groupId, name: 'Work', collapsed: true }); expect(state.organization.groups[0]!.podIds.sort()).toEqual([pod.id, other.id].sort()); expect(state.pods[0]).toEqual(original)
    await page.getByRole('region', { name: 'Work group' }).locator('.group-toggle').click()
    await page.getByRole('button', { name: 'Edit Work group', exact: true }).click(); const longName = 'LongGroupName'.repeat(7)
    await page.getByLabel('Group name', { exact: true }).fill(longName); await page.getByRole('button', { name: 'Save group', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    const label = page.getByRole('region', { name: `${longName} group` }).locator('.group-name')
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await label.evaluate(element => (element as HTMLElement).style.overflowWrap = 'normal')
    expect(await label.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    await label.evaluate(element => (element as HTMLElement).style.removeProperty('overflow-wrap'))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/groups-narrow-dark.png') })
    await page.getByRole('button', { name: `Edit ${longName} group`, exact: true }).click(); await page.getByRole('button', { name: 'Remove group', exact: true }).click(); await page.getByText('Remove this group? Its pods will move to Ungrouped.', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Confirm removal', exact: true }).click()
    await page.getByRole('region', { name: 'Ungrouped group', exact: true }).getByRole('button', { name: 'Order review paused', exact: true }).waitFor()
    const final = await page.evaluate(() => window.pods.workspace({ type: 'list' })); expect(final.organization.groups).toEqual([]); expect(final.pods).toHaveLength(2); expect(final.pods[0]).toEqual(original)
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pod.id)).enabled).toBe(false)
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
