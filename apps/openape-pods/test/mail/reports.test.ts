// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(options: { manual?: boolean, reportFailure?: boolean, uncertain?: boolean, publicationUncertain?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T05:01:00Z'))
  const workspace = await mkdtemp(join(tmpdir(), 'pod-reports-')); roots.push(workspace)
  const { run } = await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'examples/morning-mail-briefing.mjs')).href)
  const calls: { url: string, method: string, body?: string, key?: string, headers: Record<string, string> }[] = []
  let checkpoint: Record<string, any> = { version: 1, lastDeliveredDate: '2026-09-27', delivery: { chatId: '123', status: 'sent' }, pending: null }
  let publication: Record<string, unknown> | undefined
  let revision = 1
  const context = {
    workspace, variables: { calendar_chat_id: '123', delivery_mode: 'live', publication_mode: 'live', reports_url: 'https://report.openape.ai', reports_series_id: `01M${'A'.repeat(23)}`, reports_preview_series_id: `01M${'B'.repeat(23)}` },
    input: { eventIds: [], reason: options.manual ? 'manual' : 'schedule', runId: 'fixture', checkpointRevision: revision, checkpoint, workflow: { outputs: { mail: { schema: 'morning-mail-review/v1', data: { date: '2026-09-28', collectedAt: new Date().toISOString(), accounts: [], gaps: [], preview: !!options.manual } } } } },
    credentials: { get: async () => 'synthetic-token' },
    tools: { invoke: vi.fn(async ({ application }: { application: string }) => ({ exitCode: 0, stdout: JSON.stringify(application === 'repos-issues' ? { total: 0, scope: 'owned:patrick', issues: [] } : []) })) },
    progress: { commit: async (value: { checkpoint: Record<string, any> }) => { checkpoint = value.checkpoint; return { revision: ++revision } } },
    http: { request: vi.fn(async (request: typeof calls[number]) => {
      calls.push(request)
      if (request.url.includes('/getChat')) return { status: 200, body: JSON.stringify({ ok: true, result: { id: 123 } }) }
      if (request.url.includes('/sendMessage')) {
        expect(publication).toBeDefined()
        expect(checkpoint.pending).toBeDefined()
        if (options.uncertain) throw new Error('Uncertain send')
        return { status: 200, body: JSON.stringify({ ok: true, result: { message_id: 900, date: 1, chat: { id: 123 } } }) }
      }
      if (request.method === 'GET') return { status: publication ? 200 : 404, body: JSON.stringify(publication ?? {}) }
      expect(checkpoint.pendingReport.body).toBe(request.body)
      if (options.publicationUncertain) throw new Error('Uncertain publication')
      if (options.reportFailure) return { status: 503, body: '{}' }
      publication = { id: 'publication', version: 1, digest: createHash('sha256').update(request.body!).digest('hex'), url: 'https://report.openape.ai/r/fixture', edition_url: 'https://report.openape.ai/r/fixture?v=1' }
      return { status: 201, body: JSON.stringify(publication) }
    }) },
  }
  return { context, calls, run: async () => { context.input.checkpoint = checkpoint; context.input.checkpointRevision = revision; return await run(context) }, state: () => checkpoint, options }
}
it('publishes the private edition before sending one short notification and saves both receipts', async () => {
  const f = await fixture()
  expect((await f.run()).status).toBe('completed')
  expect(f.calls.filter(call => call.method === 'POST').map(call => new URL(call.url).pathname)).toEqual(['/api/reports', '/botsynthetic-token/sendMessage'])
  expect(f.calls.slice(-2).map(call => call.method)).toEqual(['GET', 'POST'])
  expect(f.calls.at(-2)!.url).toContain('/publication')
  const sent = JSON.parse(f.calls.at(-1)!.body!)
  expect(sent.link_preview_options).toEqual({ is_disabled: true })
  expect(sent.text).toContain('https://report.openape.ai/r/fixture?v=1')
  expect(f.state()).toMatchObject({ lastDeliveredDate: '2026-09-28', pending: null, pendingReport: null, delivery: { messageId: 900 } })
  await f.run()
  expect(f.calls.filter(call => call.url.includes('/sendMessage'))).toHaveLength(1)
})
it('publishes manual previews to a separate series and never sends Telegram', async () => {
  const f = await fixture({ manual: true })
  expect((await f.run()).status).toBe('completed')
  const post = f.calls.find(call => call.url.endsWith('/api/reports'))!
  expect(JSON.parse(post.body!).seriesId).toBe(f.context.variables.reports_preview_series_id)
  expect(f.calls.some(call => call.url.includes('/sendMessage'))).toBe(false)
  await f.run()
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
})
it('retains the original Telegram pending state and blocks every automatic resend after uncertainty', async () => {
  const f = await fixture({ uncertain: true })
  expect((await f.run()).status).toBe('completedWithGaps')
  expect(f.state().pending.key).toBe('calendar-briefing:123:2026-09-28')
  await f.run()
  expect(f.calls.filter(call => call.url.includes('/sendMessage'))).toHaveLength(1)
})
it('reconciles and retries only a known failed HTTP publication with the same frozen payload and server idempotency key', async () => {
  const f = await fixture({ reportFailure: true })
  expect((await f.run()).status).toBe('completedWithGaps')
  const first = f.calls.find(call => call.url.endsWith('/api/reports'))!
  expect(f.state().pendingReport.attempt).toBe(1)
  expect(f.calls.some(call => call.url.includes('/sendMessage'))).toBe(false)
  f.options.reportFailure = false
  expect((await f.run()).status).toBe('completed')
  const posts = f.calls.filter(call => call.url.endsWith('/api/reports'))
  expect(posts[1]!.body).toBe(first.body)
  expect(posts[1]!.headers['idempotency-key']).toBe(first.headers['idempotency-key'])
  expect(posts[1]!.key).not.toBe(first.key)
})
it('keeps an uncertain publication effect key and never sends its link', async () => {
  const f = await fixture({ publicationUncertain: true })
  expect((await f.run()).status).toBe('completedWithGaps')
  expect(f.state().pendingReport.attempt).toBeUndefined()
  expect(f.calls.some(call => call.url.includes('/sendMessage'))).toBe(false)
})

it('keeps the existing required-source failure gate before publication', async () => {
  const f = await fixture()
  f.context.tools.invoke.mockResolvedValue({ exitCode: 1, stdout: '' })
  expect((await f.run()).status).toBe('completedWithGaps')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  expect(f.state().pendingReport).toBeUndefined()
})
