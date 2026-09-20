import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { recordedResponse } from './fixtures/responses'

it('master-chat: creates a manual pod, validates a draft and shows exact pending access in the packaged owner UI', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-master-ui-')))
  let calls = 0; const requestedModels: string[] = []
  const server = createServer((request, response) => {
    const respond = async () => {
      let body = ''; for await (const chunk of request) body += String(chunk)
      if (body.includes('previousDescription')) {
        const reply = recordedResponse({ type: 'message', id: 'summary', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ description: 'Maintains sourced mail knowledge; access remains pending.' }), annotations: [] }] })
        response.setHeader('Content-Type', 'text/event-stream'); response.end(await reply.text()); return
      }
      requestedModels.push((JSON.parse(body) as { model: string }).model)
      const index = ++calls; const store = new PodDatabase(root)
      const pod = store.listPods()[0]; const draft = store.db.prepare('SELECT id,revision FROM script_drafts LIMIT 1').get(); store.close()
      const scope = { podId: pod?.id, revision: pod?.revision }
      const actions = [
        { action: 'create', name: 'Mail knowledge' },
        { action: 'draft', ...scope, draftId: null, draftRevision: 0, code: 'export async function run() { return {status:\'completed\',summary:\'Synthetic manual run\',completedInputIds:[],gapIds:[]} }', capabilities: [] },
        { action: 'validate', ...scope, draftId: draft?.id, draftRevision: draft?.revision },
        { action: 'activate', ...scope, draftId: draft?.id, draftRevision: draft?.revision },
        { action: 'requestAccess', ...scope, request: { provider: 'microsoft', account: 'synthetic@example.invalid', folders: ['Inbox', 'Sent Items'], attachments: true, description: 'Read selected messages and attachments for sourced knowledge.' } },
      ]
      const reply = index <= actions.length ? recordedResponse({ type: 'function_call', id: `item-${index}`, call_id: `call-${index}`, name: 'pods_control', arguments: JSON.stringify(actions[index - 1]) }) : recordedResponse({ type: 'message', id: 'final', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Your pod and validated draft are ready. Microsoft access awaits your review; automatic runs remain disabled.', annotations: [] }] })
      response.setHeader('Content-Type', 'text/event-stream'); response.end(await reply.text())
    }
    void respond().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error('Fixture provider failed')))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, OPENAPE_PODS_FIXTURE_MODEL_PORT: String(address.port), NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('button', { name: 'New pod', exact: false }).click()
    const input = page.getByLabel('Message', { exact: true })
    await input.fill('/'); await mkdir(resolve('.artifacts'), { recursive: true })
    await page.getByRole('option', { name: '/model', exact: false }).waitFor()
    await page.screenshot({ path: resolve('.artifacts/chats-slash-command.png') })
    await input.press('Enter')
    await page.getByRole('combobox', { name: 'Search models', exact: true }).waitFor()
    await page.screenshot({ path: resolve('.artifacts/chats-model-picker.png') })
    await page.getByRole('combobox', { name: 'Search models', exact: true }).fill('astra')
    await page.getByRole('combobox', { name: 'Search models', exact: true }).press('Enter')
    expect(await input.inputValue()).toBe(''); expect(calls).toBe(0)
    await input.fill('Create a synthetic mail knowledge pod and prepare a script. Propose the mailbox access for review.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText('Your pod and validated draft are ready. Microsoft access awaits your review; automatic runs remain disabled.', { exact: true }).waitFor()
    await expect.poll(async () => (await page.evaluate(() => window.pods.master({ type: 'list' }))).state).toBe('idle')
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods[0]?.activeScript).toBeNull()
    await page.getByRole('button', { name: 'Apply changes together', exact: true }).click()
    const pods = (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods
    expect(pods).toHaveLength(1); expect(pods[0]!.lifecycle).toBe('paused'); expect(pods[0]!.activeScript).toMatch(/^[a-f0-9]{64}$/)
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pods[0]!.id)).enabled).toBe(false)
    const view = await page.evaluate(() => window.pods.master({ type: 'list' })); expect(view.drafts[0]?.validation).toContain('native-synthetic-contract'); expect(view.proposals[0]?.state).toBe('pending'); expect(calls).toBe(6); expect(requestedModels).toEqual(Array.from({ length: 6 }).fill('gpt-6-astra'))
    await page.getByRole('heading', { name: 'Resource access for your review' }).scrollIntoViewIfNeeded()
    await mkdir(resolve('.artifacts'), { recursive: true }); await page.screenshot({ path: resolve('.artifacts/master-permission.png') })
    await page.locator('.chat-details > summary').click()
    await page.locator('[aria-label="Script drafts"] > details > summary').click(); await page.locator('[aria-label="Script drafts"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/master-draft.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' }); await page.getByRole('heading', { name: 'Resource access for your review' }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/master-narrow-dark.png') })
    await page.getByRole('button', { name: 'Decline', exact: true }).click(); await page.getByText('declined', { exact: false }).waitFor()
    await page.locator('.chat-details > summary').click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 850)); await page.emulateMedia({ colorScheme: 'light' })
    await page.locator('.chat-scroll').evaluate(element => element.scrollTop = 0)
    await page.screenshot({ path: resolve('.artifacts/chat-conversation-en.png') })
    const geometry = await page.evaluate(() => {
      const user = document.querySelector('.master-message.user')!.getBoundingClientRect()
      const assistant = document.querySelector('.master-message.assistant')!.getBoundingClientRect()
      const composer = document.querySelector('.master-compose')!.getBoundingClientRect()
      return { userLeft: user.left, assistantLeft: assistant.left, composerBottom: composer.bottom, height: innerHeight }
    })
    expect(geometry.userLeft).toBeGreaterThan(geometry.assistantLeft)
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.height)
    expect(await page.locator('.chat-activity pre').first().isVisible()).toBe(false)
    await page.evaluate(() => window.pods.language({ type: 'set', language: 'de' })); await page.reload()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByLabel('Nachricht', { exact: true }).waitFor()
    await page.locator('.chat-scroll').evaluate(element => element.scrollTop = 0)
    await page.screenshot({ path: resolve('.artifacts/chat-conversation-de.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(560, 560)); await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: resolve('.artifacts/chat-conversation-narrow-dark.png') })
    expect(await page.locator('.master-compose').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const appendReply = (id: string, text: string) => {
      const store = new PodDatabase(root)
      try {
        store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(id, 'assistant', text, 'completed', Date.now())
        store.db.prepare('INSERT INTO master_message_scopes VALUES(?,?)').run(id, pods[0]!.id)
      }
      finally { store.close() }
    }
    appendReply('long-reply', 'A long synthetic response. '.repeat(150))
    await page.getByText('A long synthetic response.', { exact: false }).waitFor({ state: 'attached' })
    const scroll = page.locator('.chat-scroll')
    expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await scroll.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
    appendReply('while-reading', 'This arrived while you were reading earlier messages.')
    await page.getByText('This arrived while you were reading earlier messages.', { exact: true }).waitFor({ state: 'attached' })
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(0)
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
    appendReply('follow-latest', 'This reply should remain visible at the end of the conversation.')
    await page.getByText('This reply should remain visible at the end of the conversation.', { exact: true }).waitFor()
    await expect.poll(() => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2)
    expect(await page.locator('.master-compose').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true)
    await page.getByLabel('Nachricht', { exact: true }).fill('/model')
    await page.getByLabel('Nachricht', { exact: true }).press('Enter')
    await page.getByRole('combobox', { name: 'Modelle suchen', exact: true }).waitFor()
    expect(await page.locator('.composer-palette').evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight })).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/chats-model-picker-560.png') })
    await page.getByRole('combobox', { name: 'Modelle suchen', exact: true }).fill('sol')
    await page.getByRole('combobox', { name: 'Modelle suchen', exact: true }).press('Enter')
    expect(calls).toBe(6)
    await page.getByLabel('Nachricht', { exact: true }).fill('Explain the pending setup without executing anything.')
    await page.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect.poll(async () => {
      const view = await page.evaluate(() => window.pods.master({ type: 'list' }))
      const visibleError = await page.locator('.error-message[role="alert"]').allTextContents()
      return { models: requestedModels.length, accepted: view.messages.some(message => message.role === 'user' && message.text === 'Explain the pending setup without executing anything.'), error: view.error, visibleError }
    }, { timeout: 10000 }).toEqual({ models: 7, accepted: true, error: null, visibleError: [] })
    expect(requestedModels[6]).toBe('gpt-5.6-sol')
    await expect.poll(async () => (await page.evaluate(() => window.pods.master({ type: 'list' }))).state).toBe('idle')
  }
  catch (error) {
    const page = await app.firstWindow()
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.screenshot({ path: resolve('.artifacts/master-ui-failure.png') })
    const diagnostics = await page.evaluate(async () => ({ text: document.body.textContent, view: await window.pods.master({ type: 'list' }) }))
    await writeFile(resolve('.artifacts/master-ui-failure.json'), JSON.stringify({ requestedModels, ...diagnostics }, null, 2))
    throw error
  }
  finally { await app.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }) }
})
