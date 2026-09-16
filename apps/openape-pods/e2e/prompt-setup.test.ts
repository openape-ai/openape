import { fixtureShellIdentity } from './fixtures/shell-identity'
import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { PromptModel, setupAnswer, setupPrompt } from './fixtures/prompt-model'

it('packaged prompt setup repairs a script, configures a pod and runs through the visible chat', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-prompt-setup-')))
  const store = new PodDatabase(root); const other = store.createPod({ name: 'Unrelated' }); store.close()
  let shellIdentity: Awaited<ReturnType<typeof fixtureShellIdentity>> | undefined
  let app: ElectronApplication
  const model = new PromptModel(); const failures: string[] = []
  const server = createServer((request, response) => {
    const respond = async () => {
      let body = ''; for await (const part of request) body += String(part)
      if (model.calls === 11 && !shellIdentity) { shellIdentity = await fixtureShellIdentity(root); await shellIdentity.encrypt(app, true) }
      const reply = model.reply(JSON.parse(body))
      response.setHeader('Content-Type', 'text/event-stream'); response.end(await reply.text())
    }
    void respond().catch((error: unknown) => { failures.push(String(error)); response.destroy(error instanceof Error ? error : new Error('Synthetic provider failed')) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, OPENAPE_PODS_FIXTURE_MODEL_PORT: String(address.port), NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(7000); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('button', { name: 'New pod', exact: false }).click()
    await page.getByLabel('Message this pod').fill(setupPrompt)
    const submittedPrompt = await page.getByLabel('Message this pod').inputValue()
    expect(submittedPrompt.trim()).toBe(setupPrompt)
    const started = Date.now(); await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => ({ failures, state: (await page.evaluate(() => window.pods.master({ type: 'list' }))).state }), { timeout: 30000 }).toEqual({ failures: [], state: 'idle' })
    await page.getByText(setupAnswer, { exact: true }).waitFor()
    const workspace = await page.evaluate(() => window.pods.workspace({ type: 'list' }))
    const pod = workspace.pods.find(item => item.name === 'Greeting')!
    expect(pod.activeScript).toMatch(/^[a-f0-9]{64}$/); expect(pod.lifecycle).toBe('paused'); expect(workspace.pods.find(item => item.id === other.id)).toEqual(other)
    await expect.poll(async () => (await page.evaluate(id => window.pods.runs({ type: 'list', podId: id }), pod.id)).runs[0]?.state).toBe('completed')
    const run = (await page.evaluate(id => window.pods.runs({ type: 'list', podId: id }), pod.id)).runs[0]!
    expect(run.summary).toBe('Hello from my pod (1)')
    const schedule = await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pod.id)
    expect(schedule).toMatchObject({ enabled: false, spec: { kind: 'interval', seconds: 900 } })
    const chat = await page.evaluate(() => window.pods.master({ type: 'list' }))
    expect(chat.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(chat.messages.filter(message => message.role === 'tool' && message.state === 'failed')).toHaveLength(1)
    expect(chat.drafts[0]).toMatchObject({ podId: pod.id, revision: 2 }); expect(chat.drafts[0]?.validation).toContain('native-synthetic-contract')
    expect(model.calls).toBe(15)
    expect(chat.initialRequest?.text).toBe(submittedPrompt)
    await expect.poll(async () => (await page.evaluate(id => window.pods.master({ type: 'list', podId: id }), pod.id)).description?.state).toBe('ready')
    expect(await page.getByRole('article', { name: 'Start request' }).count()).toBe(1)
    const inspected = model.results.get(13)!
    expect(inspected.variables).toEqual([{ name: 'greeting', value: 'Hello from my pod', revision: 1 }])
    const persisted = new PodDatabase(root)
    try { expect(persisted.checkpoint(pod.id).body).toEqual({ count: 1 }) }
    finally { persisted.close() }
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.getByRole('article', { name: 'Start request' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/prompt-setup-chat.png') })
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await page.getByText('Generated from this conversation', { exact: true }).waitFor()
    await page.screenshot({ path: resolve('.artifacts/prompt-description.png') })
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: 'Variables and secrets', exact: true }).click()
    await page.getByRole('tab', { name: 'Variables and secrets', exact: true }).waitFor()
    await expect.poll(() => page.getByRole('tab', { name: 'Variables and secrets', exact: true }).getAttribute('aria-selected')).toBe('true')
    await page.getByRole('heading', { name: 'Greeting', exact: true }).waitFor()
    await page.getByLabel('Variable name', { exact: true }).waitFor({ timeout: 3000 })
    await page.getByText('notification_token', { exact: true }).waitFor()
    await page.getByText('These values are visible to the pod assistant. Changes apply to future runs. Store sensitive values as secrets below.', { exact: true }).waitFor()
    await page.screenshot({ path: resolve('.artifacts/prompt-setup-settings.png') })
    await page.getByRole('tab', { name: 'Script', exact: true }).click()
    await expect.poll(() => page.getByLabel('Script source', { exact: true }).inputValue()).toContain('greeting.txt')
    await page.screenshot({ path: resolve('.artifacts/prompt-setup-script.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(560, 760)); await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: 'Variables and secrets', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/prompt-setup-secret-dark.png') })
    await page.evaluate(() => window.pods.language({ type: 'set', language: 'de' }))
    await page.reload(); await page.locator('.pod-button').filter({ hasText: 'Greeting' }).click(); await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('article', { name: 'Startauftrag' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/prompt-start-de.png') })
    await page.getByRole('tab', { name: 'Übersicht', exact: true }).click()
    await page.getByText('Aus diesem Chat erstellt', { exact: true }).waitFor()
    await page.screenshot({ path: resolve('.artifacts/prompt-description-de.png') })
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: 'Variablen und Geheimnisse', exact: true }).scrollIntoViewIfNeeded()
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))) })
    await page.screenshot({ path: resolve('.artifacts/prompt-setup-secret-de.png') })
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, scrollX }))).toEqual({ width: 560, viewport: 560, scrollX: 0 })
    const sidebar = await page.locator('.sidebar').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth, scrollLeft: element.scrollLeft }))
    expect(sidebar.content).toBeLessThanOrEqual(sidebar.width)
    expect(sidebar.scrollLeft).toBe(0)
    const scriptRoot = join(root, 'pods', pod.id, 'workspace')
    expect(await readFile(join(scriptRoot, 'greeting.txt'), 'utf8')).toBe('Hello from my pod')
    await writeFile(resolve('.artifacts/prompt-setup-evidence.json'), JSON.stringify({ kind: 'synthetic-model-packaged-ui', prompt: setupPrompt, userPrompts: 1, repairAttempts: 1, modelCalls: model.calls, elapsedMs: Date.now() - started, scriptGeneratedByLiveModel: false, ownerProfileUsed: false, enabledSchedule: schedule.enabled, result: run.summary, pendingSecret: chat.proposals[0]?.body.alias }, null, 2))
  }
  finally { await app.close(); await shellIdentity?.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }) }
})
