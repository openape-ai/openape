import { randomBytes } from 'node:crypto'
import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, readFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { fixtureDirectory } from '../src/main/fixture'
import { PodDatabase } from '../src/worker/storage/database'

it('credentials: packaged owner flow protects exact source, persists encrypted values and revokes access', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-credentials-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Customer review', assignment: 'Process local files with explicitly assigned credentials.' }); store.close()
  const syntheticCipher = process.env.OPENAPE_PODS_TEST_SYNTHETIC_CIPHER === '1'
  const key = randomBytes(32).toString('hex')
  const launch = async () => {
    const running = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
    if (syntheticCipher) {
      await running.evaluate(({ safeStorage }, key) => {
        const { createCipheriv, createDecipheriv, randomBytes } = process.getBuiltinModule('node:crypto') as typeof import('node:crypto')
        safeStorage.isEncryptionAvailable = () => true
        safeStorage.encryptString = (value) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]) }
        safeStorage.decryptString = (bytes) => { const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString() }
      }, key)
    }
    console.info(`Credential flow: ${syntheticCipher ? 'isolated synthetic cipher; macOS keychain is NOT verified' : 'real macOS safeStorage'}`)
    return running
  }
  let app = await launch()
  try {
    let page = await app.firstWindow(); page.setDefaultTimeout(7000); await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    await page.getByRole('tab', { name: 'Resources', exact: true }).click()
    await mkdir(resolve('.artifacts'), { recursive: true })
    for (const locale of ['en', 'de']) {
      await page.locator('.language-control select').selectOption(locale)
      await page.locator('.credential-form').screenshot({ path: resolve(`.artifacts/handbook-credentials${locale === 'de' ? '-de' : '-en'}.png`) })
    }
    await page.locator('.language-control select').selectOption('en')
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
    const other = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Separate pod', assignment: 'Independent synthetic credential' }))).pods.find(item => item.name === 'Separate pod')!
    const otherResources = await page.evaluate(podId => window.pods.resources({ type: 'saveCredential', podId, alias: 'crm', value: 'OTHER_SYNTHETIC_VALUE', epoch: 0 }), other.id)
    const otherId = otherResources.resources[0]!.configuration.credentialId as string
    expect(otherId).not.toBe(id)
    console.info('Credential flow: saved encrypted value, preparing script')
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    const panel = () => page.getByRole('article', { name: 'Script editor' })
    await panel().getByRole('button', { name: 'New script', exact: true }).click()
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
    await panel().getByLabel('Script source').fill(code); await panel().getByRole('checkbox', { name: 'crm', exact: true }).check()
    await panel().getByRole('button', { name: 'Save draft', exact: true }).click(); await panel().getByText('Draft saved. Validate it before activation.', { exact: true }).waitFor()
    await panel().getByRole('button', { name: 'Validate draft', exact: true }).click(); await panel().getByText('Synthetic sandbox check passed. Review the validated source, then activate it.', { exact: true }).waitFor()
    expect(await panel().getByRole('button', { name: 'Activate for next run' }).isDisabled()).toBe(true)
    const validated = await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)
    const hash = validated.source!.hash!
    await expect(page.evaluate(({ podId, hash }) => window.pods.scripts({ type: 'activate', podId, revision: 1, hash, expectedActive: null }), { podId: pod.id, hash })).rejects.toThrow('Approve credential access')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await panel().getByRole('button', { name: 'Review credential access' }).click()
    await expect.poll(() => panel().getByRole('button', { name: 'Review credential access' }).isEnabled()).toBe(true)
    expect(await panel().getByRole('button', { name: 'Activate for next run' }).isDisabled()).toBe(true)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async (_window: unknown, options?: unknown) => { (globalThis as unknown as { credentialDialog: unknown }).credentialDialog = options; return { response: 1, checkboxChecked: false } } })
    await panel().getByRole('button', { name: 'Review credential access' }).click()
    await panel().getByText('Credential access approved for this version and current resources.', { exact: true }).waitFor()
    const dialog = await app.evaluate(() => (globalThis as unknown as { credentialDialog: unknown }).credentialDialog)
    expect(JSON.stringify(dialog)).toContain(hash); expect(JSON.stringify(dialog)).toContain('AI prompts'); expect(JSON.stringify(dialog)).not.toContain('SYNTHETIC_SCRIPT_CREDENTIAL')
    await panel().getByRole('button', { name: 'Activate for next run' }).click(); await panel().getByText('Activated for the next run. Existing runs retain their pinned version.', { exact: true }).waitFor()
    await panel().locator('fieldset').screenshot({ path: resolve('.artifacts/credentials-approved.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await panel().locator('fieldset').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/credentials-narrow-dark.png') })
    await page.getByRole('button', { name: 'Run once', exact: true }).click(); await page.getByRole('button', { name: 'Credential script completed', exact: true }).waitFor()
    const runs = await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)
    expect(runs.runs[0]!.state).toBe('completed')
    expect(JSON.stringify(await page.evaluate(({ podId, id }) => window.pods.runs({ type: 'list', podId, runId: id }), { podId: pod.id, id: runs.runs[0]!.id }))).not.toContain('SYNTHETIC_SCRIPT_CREDENTIAL')
    expect(await readFile(join(root, 'pods', pod.id, 'workspace', 'result.txt'), 'utf8')).toBe('Processed local data')
    await app.close(); app = await launch(); page = await app.firstWindow(); page.setDefaultTimeout(7000); await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    expect((await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)).source!.credentialAccessApproved).toBe(true)
    const result = await page.evaluate(podId => window.pods.runs({ type: 'start', podId }), pod.id)
    await expect.poll(async () => (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)).runs[0]?.state).toBe('completed')
    expect(result.runs.length).toBeGreaterThan(0)
    await page.getByRole('tab', { name: 'Resources', exact: true }).click()
    const rotated = await page.evaluate(({ podId, epoch }) => window.pods.resources({ type: 'saveCredential', podId, alias: 'crm', value: 'ROTATED_SYNTHETIC_VALUE', epoch }), { podId: pod.id, epoch: resources.epoch })
    const current = rotated.resources.find(item => item.state === 'ready')!
    expect((await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)).source!.credentialAccessApproved).toBe(false)
    expect(await readdir(join(root, 'credentials'))).not.toContain(`${id}.encrypted`)
    await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await page.getByRole('tab', { name: 'Resources', exact: true }).click()
    await page.locator('.resource-row').last().getByRole('button', { name: 'Revoke access' }).click()
    await expect.poll(async () => (await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)).resources.find(item => item.id === current.id)?.state).toBe('revoked')
    expect(await readdir(join(root, 'credentials'))).not.toContain(`${id}.encrypted`)
    expect((await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)).source!.credentialAccessApproved).toBe(false)
    expect((await page.evaluate(podId => window.pods.runs({ type: 'start', podId }), pod.id)).runs).toHaveLength(2)
    expect(await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).toMatchObject({ blocked: 1, error: expect.stringContaining('validation') })
    expect(await readdir(join(root, 'credentials'))).not.toContain(`${current.configuration.credentialId}.encrypted`)
    expect(await readdir(join(root, 'credentials'))).toContain(`${otherId}.encrypted`)
    expect((await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).enabled).toBe(false)
    const epoch = (await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)).epoch
    await page.evaluate(({ podId, epoch }) => window.pods.resources({ type: 'saveCredential', podId, alias: 'a'.repeat(64), value: 'SYNTHETIC_LONG_ALIAS', epoch }), { podId: pod.id, epoch })
    await page.getByRole('tab', { name: 'Settings', exact: true }).click(); await panel().getByRole('button', { name: 'Refresh history' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    const content = page.locator('.content'); const fieldset = panel().locator('fieldset')
    await fieldset.scrollIntoViewIfNeeded()
    expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await fieldset.evaluate(element => element.style.minWidth = '1200px')
    expect(await content.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    await fieldset.evaluate(element => element.style.removeProperty('min-width'))
    expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/credentials-long-alias-dark.png') })
  }
  finally {
    const process = app.process()
    const cleanup = setTimeout(() => { process.kill('SIGKILL') }, 3000)
    try { await app.close() }
    finally { clearTimeout(cleanup) }; await rm(root, { recursive: true, force: true })
  }
})
