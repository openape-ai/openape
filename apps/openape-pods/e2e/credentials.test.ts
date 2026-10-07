import { fixtureShellIdentity } from './fixtures/shell-identity'
import { failOnKeychainDialog } from './fixtures/keychain'
import { _electron as electron } from 'playwright'
import type { Page } from 'playwright'
import { mkdtemp, realpath, rm, readFile, readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { fixtureDirectory } from '../src/main/fixture'
import { PodDatabase } from '../src/worker/storage/database'

// Geometry of the Values tab lives in test/layout/pod-tabs.test.ts. This file
// keeps what needs the packaged app: safeStorage ciphertext, a restart that
// decrypts it again, and key files erased on rotation and revocation. It uses
// Chromium's mock keychain unless OPENAPE_PODS_TEST_REAL_KEYCHAIN=1 opts into
// the login keychain, which needs a human or an unlocked dedicated keychain.
it('credentials: packaged owner flow retains assigned secrets across runs and revokes access', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-credentials-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Customer review' }); store.close()
  const shellIdentity = await fixtureShellIdentity(root)
  const realKeychain = process.env.OPENAPE_PODS_TEST_REAL_KEYCHAIN === '1'
  const launch = async () => {
    const running = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: realKeychain ? homedir() : root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test', ...(realKeychain ? { OPENAPE_PODS_TEST_REAL_KEYCHAIN: '1' } : {}) } })
    failOnKeychainDialog(running)
    expect(await running.evaluate(({ app }) => app.getPath('userData'))).toBe(root)
    expect(await running.evaluate(({ app }) => app.getPath('sessionData'))).toBe(join(root, 'chromium'))
    await shellIdentity.encrypt(running)
    console.info(`Credential flow: ${realKeychain ? 'real macOS login keychain' : 'Chromium mock keychain; macOS login keychain is NOT verified'}`)
    return running
  }
  const openPod = async (page: Page) => {
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await page.getByRole('row', { name: /Customer review/ }).click()
    await page.getByRole('button', { name: 'Open details', exact: true }).click()
  }
  let app = await launch()
  try {
    let page = await app.firstWindow(); page.setDefaultTimeout(7000); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await openPod(page)
    await page.getByRole('tab', { name: 'Variables and secrets', exact: true }).click()
    console.info('Credential flow: rendered resources, saving synthetic encrypted value')
    await page.getByLabel('Credential alias', { exact: true }).fill('crm')
    await page.getByLabel('Credential value', { exact: true }).fill('SYNTHETIC_SCRIPT_CREDENTIAL')
    expect(await page.getByLabel('Credential value', { exact: true }).getAttribute('type')).toBe('password')
    await page.getByRole('button', { name: 'Save or replace credential', exact: true }).click()
    await page.locator('.resource-row').getByText('crm', { exact: true }).waitFor()
    expect(await page.getByLabel('Credential value', { exact: true }).inputValue()).toBe('')
    const resources = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)
    expect(JSON.stringify(resources)).not.toContain('SYNTHETIC_SCRIPT_CREDENTIAL')
    const id = resources.resources[0]!.configuration.credentialId as string
    expect((await readFile(join(root, 'credentials', `${id}.encrypted`))).includes('SYNTHETIC_SCRIPT_CREDENTIAL')).toBe(false)
    const other = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Separate pod' }))).pods.find(item => item.name === 'Separate pod')!
    const otherResources = await page.evaluate(podId => window.pods.resources({ type: 'saveCredential', podId, alias: 'crm', value: 'OTHER_SYNTHETIC_VALUE', epoch: 0 }), other.id)
    const otherId = otherResources.resources[0]!.configuration.credentialId as string
    expect(otherId).not.toBe(id)
    console.info('Credential flow: saved encrypted value, preparing script')
    await page.getByRole('tab', { name: 'Script', exact: true }).click()
    const panel = () => page.getByRole('article', { name: 'Script editor' })
    const code = `import { readFile, writeFile } from 'node:fs/promises'
export async function run(context) {
  const credential = await context.credentials.get('crm')
  if (!credential) throw new Error('Credential not delivered')
  if (JSON.stringify(context.input).includes(credential)) throw new Error('Secret in automatic input')
  await writeFile(context.workspace + '/result.txt', 'Processed local data')
  const text = await readFile(context.workspace + '/result.txt', 'utf8')
  await context.progress.commit({ expectedRevision: context.input.checkpointRevision, checkpoint: { count: (context.input.checkpoint.count ?? 0) + 1, text }, sources: [], claims: [] })
  return { status: 'completed', summary: 'Credential script completed', completedInputIds: context.input.eventIds, gapIds: [] }
}
`
    await panel().getByLabel('Script source').fill(code)
    await panel().getByRole('button', { name: 'Save script', exact: true }).click()
    await panel().getByText('Draft saved. Validate it before activation.', { exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Variables and secrets', exact: true }).click()
    expect(await page.getByRole('checkbox', { name: 'crm', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Save script access', exact: true }).count()).toBe(0)
    await page.getByRole('tab', { name: 'Script', exact: true }).click()
    await panel().getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByText('Credential script completed', { exact: true }).waitFor()
    const validated = await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)
    expect(validated.source!.capabilities).toEqual([])
    expect(await page.getByRole('button', { name: 'Review credential access' }).count()).toBe(0)
    const runs = await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)
    expect(runs.runs[0]!.state).toBe('completed')
    expect(JSON.stringify(await page.evaluate(({ podId, id }) => window.pods.runs({ type: 'list', podId, runId: id }), { podId: pod.id, id: runs.runs[0]!.id }))).not.toContain('SYNTHETIC_SCRIPT_CREDENTIAL')
    expect(await readFile(join(root, 'pods', pod.id, 'workspace', 'result.txt'), 'utf8')).toBe('Processed local data')
    await app.close(); app = await launch(); page = await app.firstWindow(); page.setDefaultTimeout(7000); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    expect((await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)).source!.credentialAccessApproved).toBe(true)
    const result = await page.evaluate(podId => window.pods.runs({ type: 'start', podId }), pod.id)
    await expect.poll(async () => (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)).runs[0]?.state).toBe('completed')
    expect(result.runs.length).toBeGreaterThan(0)
    await openPod(page)
    await page.getByRole('tab', { name: 'Variables and secrets', exact: true }).click()
    const rotated = await page.evaluate(({ podId, epoch }) => window.pods.resources({ type: 'saveCredential', podId, alias: 'crm', value: 'ROTATED_SYNTHETIC_VALUE', epoch }), { podId: pod.id, epoch: resources.epoch })
    const current = rotated.resources.find(item => item.state === 'ready')!
    expect((await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)).source!.credentialAccessApproved).toBe(true)
    expect(await readdir(join(root, 'credentials'))).not.toContain(`${id}.encrypted`)
    await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await page.getByRole('tab', { name: 'Variables and secrets', exact: true }).click()
    await page.locator('.resource-row').last().getByRole('button', { name: 'Revoke access' }).click()
    await expect.poll(async () => (await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)).resources.find(item => item.id === current.id)?.state).toBe('revoked')
    expect(await readdir(join(root, 'credentials'))).not.toContain(`${id}.encrypted`)
    expect((await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)).source!.validated).toBe(false)
    expect((await page.evaluate(podId => window.pods.runs({ type: 'start', podId }), pod.id)).runs).toHaveLength(2)
    expect(await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).toMatchObject({ blocked: 0, failed: 1 })
    expect(await readdir(join(root, 'credentials'))).not.toContain(`${current.configuration.credentialId}.encrypted`)
    expect(await readdir(join(root, 'credentials'))).toContain(`${otherId}.encrypted`)
    expect((await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).enabled).toBe(false)
  }
  finally {
    const process = app.process()
    const cleanup = setTimeout(() => { process.kill('SIGKILL') }, 3000)
    try { await app.close() }
    finally { clearTimeout(cleanup) }; await shellIdentity.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
