import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { recordedResponse } from './fixtures/responses'

it('master-chat: creates a manual pod, validates a draft and shows exact pending access in the packaged owner UI', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-master-ui-')))
  let calls = 0
  const server = createServer((request, response) => {
    request.resume()
    const respond = async () => {
      const index = ++calls; const store = new PodDatabase(root)
      const pod = store.listPods()[0]; const draft = store.db.prepare('SELECT id,revision FROM script_drafts LIMIT 1').get(); store.close()
      const scope = { podId: pod?.id, revision: pod?.revision }
      const actions = [
        { action: 'create', name: 'Mail knowledge', assignment: 'Keep synthetic sourced mail knowledge current.' },
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
    await page.getByRole('button', { name: 'New pod', exact: false }).click(); await page.getByLabel('Message this pod').fill('Create a synthetic mail knowledge pod and prepare a script. Propose the mailbox access for review.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText('Your pod and validated draft are ready. Microsoft access awaits your review; automatic runs remain disabled.', { exact: true }).waitFor()
    await expect.poll(async () => (await page.evaluate(() => window.pods.master({ type: 'list' }))).state).toBe('idle')
    const pods = (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods
    expect(pods).toHaveLength(1); expect(pods[0]!.lifecycle).toBe('paused'); expect(pods[0]!.activeScript).toMatch(/^[a-f0-9]{64}$/)
    expect((await page.evaluate(id => window.pods.scheduling({ type: 'list', podId: id }), pods[0]!.id)).enabled).toBe(false)
    const view = await page.evaluate(() => window.pods.master({ type: 'list' })); expect(view.drafts[0]?.validation).toContain('native-synthetic-contract'); expect(view.proposals[0]?.state).toBe('pending'); expect(calls).toBe(6)
    await page.getByRole('heading', { name: 'Resource access for your review' }).scrollIntoViewIfNeeded()
    await mkdir(resolve('.artifacts'), { recursive: true }); await page.screenshot({ path: resolve('.artifacts/master-permission.png') })
    await page.locator('[aria-label="Script drafts"] > details > summary').click(); await page.locator('[aria-label="Script drafts"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/master-draft.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' }); await page.getByRole('heading', { name: 'Resource access for your review' }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/master-narrow-dark.png') })
    await page.getByRole('button', { name: 'Decline', exact: true }).click(); await page.getByText('declined', { exact: true }).waitFor()
  }
  finally { await app.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }) }
})
