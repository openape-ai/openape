import { fixtureShellIdentity } from './fixtures/shell-identity'
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { recordedResponse } from './fixtures/responses'

it('central chats: scopes tools, reviews both Pods, starts a separate run and resets context without losing history', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-central-chats-')))
  const seed = new PodDatabase(root)
  for (const name of ['Mail filter', 'Short report', 'Private Pod']) seed.createPod({ name })
  seed.close()
  const identity = await fixtureShellIdentity(root)
  let call = 0; let phase: 'prepare' | 'run' | 'context' = 'prepare'; const bodies: string[] = []
  const server = createServer((request, response) => {
    const respond = async () => {
      let body = ''; for await (const chunk of request) body += String(chunk); bodies.push(body)
      const store = new PodDatabase(root)
      const pods = store.listPods(); const filter = pods.find(pod => pod.name === 'Mail filter')!; const report = pods.find(pod => pod.name === 'Short report')!; const other = pods.find(pod => pod.name === 'Private Pod')!
      const draft = (podId: string) => store.db.prepare('SELECT id,revision FROM script_drafts WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(podId)
      const scope = (pod: typeof filter) => ({ podId: pod.id, revision: pod.revision })
      const code = 'export async function run() { return {status:"completed",summary:"Synthetic chat run",completedInputIds:[],gapIds:[]} }'
      const actions = [
        { action: 'inspect', ...scope(other) },
        { action: 'draft', ...scope(filter), draftId: null, draftRevision: 0, code, capabilities: [] },
        { action: 'validate', ...scope(filter), draftId: draft(filter.id)?.id, draftRevision: draft(filter.id)?.revision },
        { action: 'activate', ...scope(filter), draftId: draft(filter.id)?.id, draftRevision: draft(filter.id)?.revision },
        { action: 'draft', ...scope(report), draftId: null, draftRevision: 0, code, capabilities: [] },
        { action: 'validate', ...scope(report), draftId: draft(report.id)?.id, draftRevision: draft(report.id)?.revision },
        { action: 'activate', ...scope(report), draftId: draft(report.id)?.id, draftRevision: draft(report.id)?.revision },
      ]
      const index = call++; const action = phase === 'prepare' ? actions[index] : phase === 'run' && index === 0 ? { action: 'run', ...scope(filter) } : undefined
      store.close()
      const reply = recordedResponse(action ? { type: 'function_call', id: `item-${phase}-${index}`, call_id: `call-${phase}-${index}`, name: 'pods_control', arguments: JSON.stringify(action) } : { type: 'message', id: `done-${phase}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: `Review ready: ${phase}.`, annotations: [] }] })
      response.setHeader('Content-Type', 'text/event-stream'); response.end(await reply.text())
    }
    void respond().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error('Fixture provider failed')))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, OPENAPE_PODS_FIXTURE_MODEL_PORT: String(address.port), NODE_ENV: 'test' } })
  try {
    await identity.encrypt(app, true)
    const page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('button', { name: 'Chats', exact: true }).click()
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await page.getByText('Rename chat', { exact: true }).click()
    await page.getByLabel('Chat title', { exact: true }).fill('Mail filter and short report')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Rename chat', { exact: true }).click()
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByLabel('Mail filter', { exact: true }).check(); await page.getByLabel('Short report', { exact: true }).check()
    await page.getByRole('button', { name: 'Confirm context', exact: true }).click()
    await page.getByLabel('Message', { exact: true }).fill('FILTER_PRIVATE_CONTEXT: Prepare both scripts together.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText('Review ready: prepare.', { exact: true }).waitFor()
    const state = await page.evaluate(() => window.pods.master({ type: 'list' })); const id = state.conversation!.id
    expect(state.messages.some(message => message.role === 'tool' && message.text.includes('context_required'))).toBe(true)
    expect(state.changes?.[0]?.targets).toHaveLength(2)
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods.every(pod => pod.activeScript === null)).toBe(true)
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.locator('.change-diff > summary').first().click()
    await page.getByRole('button', { name: 'Apply changes together', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/chats-review.png') })
    await page.getByRole('button', { name: 'Apply changes together', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pods.master({ type: 'list' }))).changes?.[0]?.state).toBe('applied')
    const pods = (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods; const filter = pods.find(pod => pod.name === 'Mail filter')!
    expect(pods.filter(pod => !!pod.activeScript)).toHaveLength(2)
    phase = 'run'; call = 0
    await page.getByLabel('Message', { exact: true }).fill('Prepare one synthetic filter run.')
    await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.getByText('Review ready: run.', { exact: true }).waitFor()
    expect((await page.evaluate(id => window.pods.runs({ type: 'list', podId: id }), filter.id)).runs).toHaveLength(0)
    await page.getByRole('button', { name: 'Run once', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(id => window.pods.runs({ type: 'list', podId: id }), filter.id)).runs[0]?.state).toBe('completed')
    const runState = await page.evaluate(() => window.pods.master({ type: 'list' })); expect(runState.changes?.[0]?.results[0]?.result).toHaveProperty('runId')
    expect(runState.changes?.[0]?.execution?.[0]).toMatchObject({ podId: filter.id, state: 'completed' })
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByLabel('Mail filter', { exact: true }).uncheck()
    await page.screenshot({ path: resolve('.artifacts/chats-plus-context.png') })
    await page.getByRole('button', { name: 'Confirm context', exact: true }).click()
    expect((await page.evaluate(id => window.pods.master({ type: 'list', conversationId: id }), id)).conversation?.revision).toBe(3)
    phase = 'context'; call = 0; const before = bodies.length
    await page.getByLabel('Message', { exact: true }).fill('Inspect only the selected saved state.')
    await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.getByText('Review ready: context.', { exact: true }).waitFor()
    await expect.poll(async () => (await page.evaluate(id => window.pods.master({ type: 'list', conversationId: id }), id)).state).toBe('idle')
    await expect.poll(() => page.getByRole('button', { name: 'Add context', exact: true }).isEnabled()).toBe(true)
    expect(bodies.slice(before).join('\n')).not.toContain('FILTER_PRIVATE_CONTEXT')
    expect(await page.getByText('FILTER_PRIVATE_CONTEXT: Prepare both scripts together.', { exact: true }).count()).toBe(1)
    await mkdir(resolve('.artifacts'), { recursive: true })
    for (const width of [1060, 760, 560]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 840), width)
      await page.emulateMedia({ colorScheme: width === 560 ? 'dark' : 'light' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('.master-compose').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true)
      await page.screenshot({ path: resolve(`.artifacts/chats-${width}.png`) })
    }
  }
  finally { await app.close(); await identity.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }) }
}, 90000)
