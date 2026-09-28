// @vitest-environment node
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'

async function recipe() { return await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'examples/iurio-pr-monitor.mjs')).href) }
const variables = { telegram_chat_id: '123', publication_mode: 'live', reports_url: 'https://report.openape.ai', reports_series_id: '01M3J0X2MA3M468QP4121WGXV9', reports_preview_series_id: '01M3J0X2QHEK44RGYEBZ2YRJE5' }

it('escapes source/model markup and leaves presentation, language and category with the client', async () => {
  const { reportDocument } = await recipe()
  const report = reportDocument('PR <script>alert(1)</script>\n\nInhalt: <img onerror=x>', variables.reports_series_id, false)
  expect(report).toMatchObject({ type: 'document', language: 'de', category: 'PR Updates' })
  expect(report.html).not.toContain('<script>'); expect(report.html).toContain('&lt;img onerror=x&gt;')
  expect(report.css).toContain('@media')
})

it('keeps unchanged scans silent and does not regenerate an initial baseline', async () => {
  const { run } = await recipe()
  const invoke = vi.fn(async () => ({ exitCode: 0, stdout: '{"value":[]}' }))
  const agent = vi.fn(); const request = vi.fn(); const commit = vi.fn(async (_input: unknown) => ({ revision: 2 }))
  const outcome = await run({ variables, input: { checkpointRevision: 1, checkpoint: { schema: 1, baseline: {}, pending: null, fullAt: Date.now() }, eventIds: [], reason: 'schedule' }, tools: { invoke }, agent: { run: agent }, http: { request }, progress: { commit }, log: vi.fn() })
  expect(outcome.status).toBe('completed'); expect(outcome.summary).toContain('No PR changes')
  expect(agent).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
})

it('confirms the exact publication before Telegram and advances the baseline only after delivery', async () => {
  const { run, preparePublications } = await recipe()
  const reports = preparePublications({ variables }, ['PR #1\nNew commit\n\nInhalt: Geprüfte Änderung.'], false)
  const report = reports[0]
  const receipt = { id: '01M3J0X2MA3M468QP4121WGXVA', version: 1, digest: report.digest, artifactDigest: 'a'.repeat(64), policyVersion: 'static-document-1', edition_url: 'https://report.openape.ai/r/abcdefghijklmnopqrstuvwx' }
  const state = { schema: 1, baseline: { old: true }, pending: { id: 'existing-delivery-key', chatId: '123', parts: [], next: 0, reports, baseline: { next: true } } }
  const checkpoints: typeof state[] = []; const effects: string[] = []
  const request = vi.fn(async (input: { method: string, url: string, key: string }) => {
    effects.push(input.url)
    if (input.url.includes('/api/reports/publication')) return { status: 200, body: JSON.stringify(receipt) }
    expect(input.key).toBe('iurio-pr-existing-delivery-key-0')
    expect(checkpoints.at(-1)!.baseline).toEqual({ old: true })
    return { status: 200, body: JSON.stringify({ ok: true, result: { message_id: 42, chat: { id: 123 } } }) }
  })
  const outcome = await run({ variables, input: { checkpointRevision: 1, checkpoint: state, eventIds: [], reason: 'schedule' }, http: { request }, credentials: { get: async () => 'synthetic-token' }, progress: { commit: async ({ checkpoint }: { checkpoint: typeof state }) => { checkpoints.push(structuredClone(checkpoint)); return { revision: checkpoints.length + 1 } } }, log: vi.fn() })
  expect(outcome.status).toBe('completed')
  expect(effects[0]).toContain('/api/reports/publication'); expect(effects[1]).toContain('api.telegram.org')
  expect(checkpoints.at(-1)).toMatchObject({ baseline: { next: true }, pending: null, lastDelivery: { messageId: 42 } })
})

it('retains prepared reports and the old baseline when the receipt digest is wrong', async () => {
  const { run, preparePublications } = await recipe()
  const reports = preparePublications({ variables }, ['PR #1\n\nInhalt'], false)
  const state = { schema: 1, baseline: { old: true }, pending: { id: 'stable', chatId: '123', parts: [], next: 0, reports, baseline: { next: true } } }
  const request = vi.fn(async () => ({ status: 200, body: '{"digest":"wrong"}' }))
  const commit = vi.fn(async (_input: unknown) => ({ revision: 2 }))
  const outcome = await run({ variables, input: { checkpointRevision: 1, checkpoint: state, eventIds: [], reason: 'schedule', runId: 'test' }, http: { request }, progress: { commit }, log: vi.fn() })
  expect(outcome.status).toBe('completedWithGaps'); expect(request).toHaveBeenCalledTimes(1)
  expect(commit.mock.calls[0]![0]).toMatchObject({ checkpoint: state })
})

it('never delivers existing pending work from a manual preview', async () => {
  const { run } = await recipe()
  const request = vi.fn()
  await expect(run({ variables, input: { checkpointRevision: 1, checkpoint: { schema: 1, pending: { id: 'stable' } }, reason: 'manual' }, http: { request } })).rejects.toThrow('Pending delivery')
  expect(request).not.toHaveBeenCalled()
})

it('reconciles before retrying known failures and preserves identities for uncertain effects', async () => {
  const { preparePublications, reconcilePublication } = await recipe()
  const pending = preparePublications({ variables }, ['PR #1\n\nInhalt'], false)[0]
  const retries: unknown[] = []
  const saveRetry = async (value: unknown) => { retries.push(value) }
  const request = vi.fn(async ({ method }: { method: string }) => method === 'GET' ? { status: 404, body: '{}' } : { status: 503, body: '{}' })
  await expect(reconcilePublication({ http: { request } }, pending, saveRetry)).rejects.toThrow('503')
  expect(retries).toEqual([{ ...pending, attempt: 1 }])
  expect(request.mock.calls.map(([item]) => item.method)).toEqual(['GET', 'POST'])
  const uncertain = vi.fn(async ({ method }: { method: string }) => { if (method === 'GET') return { status: 404, body: '{}' }; throw new Error('transport outcome unknown') })
  await expect(reconcilePublication({ http: { request: uncertain } }, pending, saveRetry)).rejects.toThrow('unknown')
  expect(retries).toHaveLength(1)
})
