import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { fixtureShellIdentity } from './fixtures/shell-identity'
import type { SetupRequest } from '../src/contracts/setup'

it('packaged chat setup: reviews real persisted permissions and missing values without executing providers', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-chat-review-')))
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'pods-chat-invoices-')))
  const executable = join(root, 'invoice-cli'); const adapter = join(root, 'invoice-cli.toml')
  await writeFile(executable, '#!/bin/sh\necho DO_NOT_EXECUTE\nexit 1\n', { mode: 0o700 })
  await writeFile(adapter, 'schema="openape-shapes/v1"\n[cli]\nid="invoice-cli"\nexecutable="invoice-cli"\naudience="shapes"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read fixture mail"\naction="read"\nrisk="low"\nresource_chain=["fixture:*"]\n')
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Invoice filing' })
  const requests: SetupRequest[] = [
    { provider: 'http', origin: 'https://api.telegram.org', methods: ['POST'], description: 'Notify after filing' },
    { provider: 'directory', path: folder, access: 'readWrite', description: 'Save invoice files' },
    { provider: 'application', application: 'invoice-cli', argv: ['read'], networkHosts: ['api.example.com'], description: 'Read invoice mail' },
    { provider: 'variable', alias: 'telegram_chat_id', description: 'Which Telegram chat receives notifications?', instructions: 'Enter the destination chat ID. This is not the bot token.' },
    { provider: 'credential', alias: 'telegram_bot_token', description: 'Store the bot token securely' },
  ]
  for (const request of requests) store.db.prepare('INSERT INTO access_proposals VALUES(?,?,?,?)').run(randomUUID(), pod.id, JSON.stringify(request), 'pending')
  store.db.prepare('INSERT INTO master_contexts VALUES(?,?,?,?)').run(pod.id, null, 'interrupted', 'Master turn exceeded two minutes')
  const messageId = randomUUID()
  store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(messageId, 'user', 'File invoice attachments in the selected folder and send a Telegram notification.', 'completed', Date.now())
  store.db.prepare('INSERT INTO master_message_scopes VALUES(?,?)').run(messageId, pod.id)
  store.close()
  const identity = await fixtureShellIdentity(root, ['pod-http', 'invoice-cli'])
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    await identity.encrypt(app, true)
    const page = await app.firstWindow(); page.setDefaultTimeout(7000)
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setFocusable(false); BrowserWindow.getAllWindows()[0]!.webContents.setBackgroundThrottling(false) })
    await page.getByRole('tab', { name: 'Script', exact: true }).click()
    expect(await page.getByLabel('Script source', { exact: true }).inputValue()).toBe('')
    expect(await page.getByRole('button', { name: 'Run', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByText('No script has been saved for this pod yet.', { exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Continue setup', exact: true }).isDisabled()).toBe(true)
    const card = (description: string) => page.locator('.chat-access').filter({ has: page.locator('summary').filter({ hasText: description }) })
    const http = card('Notify after filing')
    await http.getByRole('button', { name: 'Review resources', exact: true }).click()
    expect(await http.getByLabel('HTTPS origin', { exact: true }).inputValue()).toBe('https://api.telegram.org')
    expect(await http.getByLabel('POST', { exact: true }).isChecked()).toBe(true)
    await mkdir(resolve('.artifacts'), { recursive: true })
    await http.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/chat-setup-http.png') })
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await http.getByRole('button', { name: 'Review and allow', exact: true }).click()
    await expect.poll(async () => (await http.locator('[role="status"], [role="alert"]').allTextContents()).join(' ').trim()).toBe('Nothing was granted. You can review this request again.')
    expect((await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)).resources).toHaveLength(0)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
    await http.getByRole('button', { name: 'Review and allow', exact: true }).click()
    await expect.poll(async () => ({ error: await http.locator('[role="alert"]').allTextContents(), summary: await http.locator('summary').textContent() })).toEqual({ error: [], summary: expect.stringContaining('approved') })
    const directory = card('Save invoice files')
    await directory.getByRole('button', { name: 'Review resources', exact: true }).click()
    expect(await directory.getByLabel('Folder path', { exact: true }).inputValue()).toBe(folder)
    expect(await directory.getByLabel('Directory permissions', { exact: true }).inputValue()).toBe('readWrite')
    await directory.getByRole('button', { name: 'Review and allow', exact: true }).click()
    await directory.getByText('approved', { exact: false }).waitFor()
    const program = card('Read invoice mail')
    await program.getByRole('button', { name: 'Review resources', exact: true }).click()
    await app.evaluate(({ dialog }, paths) => {
      let index = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[index++]!], bookmarks: [] })
    }, [executable, adapter])
    await program.getByRole('button', { name: 'Add installed application…', exact: true }).click()
    await expect.poll(() => program.getByLabel('Application', { exact: true }).inputValue()).not.toBe('')
    await program.getByRole('button', { name: 'Review and allow', exact: true }).click()
    await program.getByText('approved', { exact: false }).waitFor()
    const question = card('Which Telegram chat receives notifications?')
    await question.getByRole('button', { name: 'Answer question', exact: true }).click()
    await question.getByLabel('telegram_chat_id', { exact: true }).fill('123456789')
    await question.getByRole('button', { name: 'Save answer', exact: true }).click()
    await question.getByText('approved', { exact: false }).waitFor()
    const credential = card('Store the bot token securely')
    await credential.getByText('In Telegram, open @BotFather.', { exact: false }).waitFor()
    await credential.getByRole('button', { name: 'Variables and secrets', exact: true }).click()
    expect(await page.getByLabel('Credential alias', { exact: true }).inputValue()).toBe('telegram_bot_token')
    await page.getByLabel('Credential value', { exact: true }).fill('SYNTHETIC_TEST_SECRET')
    await page.getByRole('button', { name: 'Save or replace credential', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)).resources.filter(resource => resource.kind === 'credential').length).toBe(1)
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    const view = await page.evaluate(podId => window.pods.master({ type: 'list', podId }), pod.id)
    expect(view.proposals.every(proposal => proposal.state === 'approved')).toBe(true)
    expect(JSON.stringify(view)).not.toContain('SYNTHETIC_TEST_SECRET')
    const resources = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)
    expect(resources.resources.find(resource => resource.kind === 'directory')?.configuration).toMatchObject({ path: folder, access: 'readWrite' })
    expect(resources.resources.find(resource => resource.configuration.type === 'program')?.configuration.grants).toHaveLength(1)
    expect(resources.variables).toContainEqual({ name: 'telegram_chat_id', value: '123456789', revision: 1 })
    expect((await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)).runs).toHaveLength(0)
    expect((await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).enabled).toBe(false)
    await page.evaluate(() => window.pods.language({ type: 'set', language: 'de' })); await page.reload()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(560, 760))
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('.chat-access').first().scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.master-compose').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/chat-setup-resolved-de-dark.png') })
  }
  finally { await app.close(); await identity.close(); await rm(root, { recursive: true, force: true }); await rm(folder, { recursive: true, force: true }) }
})
