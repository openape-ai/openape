// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Cron } from 'croner'
import { pathToFileURL } from 'node:url'

const { assess, document, run } = await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'examples/linde-server-report.mjs')).href)

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const hosts = ['dev-portal.lindeverlag.at', 'portal-staging.lindeverlag.at', 'portal.lindeverlag.at', 'lb.lindeverlag.at', 'auth-prod.lindeverlag.at']
const observed = { facts: { observedAt: '2026-09-30T12:00:00Z', os: { value: 'PRETTY_NAME="Debian 12"' }, kernel: { value: '6.1.0-53-cloud-amd64' }, packages: { value: 'installed linux-image-6.1.0-53-cloud-amd64 6.1.187-1' }, rebootRequired: false, candidates: { value: 'nodejs:\n  Installed: 24.21\n  Candidate: 24.21' }, packageRefresh: { value: 'Result=success\nExecMainExitTimestamp=Wed 2026-09-30 08:16:10 UTC\nExecMainStatus=0' }, disk: { value: '/dev/disk 10 2 8 20% /' }, services: { value: 'Id=nginx.service\nLoadState=loaded\nActiveState=active\n\nId=pm2-linde.service\nLoadState=loaded\nActiveState=active\n\nId=pm2-LPortalService.service\nLoadState=loaded\nActiveState=active' }, backup: { value: '2026-09-30T04:30:00Z ok' }, certificates: [{ name: 'fixture.example', result: { value: 'notAfter=Dec 29 11:27:50 2026 GMT\nsha256 Fingerprint=AA:BB' } }], authHealth: [{ port: 3001, result: { value: 'HTTP 200' } }] } }
function fixture(failedHost = '') {
  const workspace = mkdtempSync(join(tmpdir(), 'linde-recipe-')); roots.push(workspace)
  const ids = Object.fromEntries(hosts.map((host, index) => [host, `00000000-0000-4000-8000-00000000000${index}`]))
  let pendingBody = ''; let revision = 0; let checkpoint = {}
  const http = vi.fn(async (request) => {
    if (request.method === 'GET') return { status: 404, body: '{}' }
    if (request.url.endsWith('/api/reports')) {
      pendingBody = request.body
      return { status: 201, body: JSON.stringify({ id: 'report', version: 1, digest: createHash('sha256').update(pendingBody).digest('hex'), url: 'https://report.openape.ai/r/fixture' }) }
    }
    return { status: 200, body: JSON.stringify({ ok: true, result: { message_id: 42, chat: { id: 123 } } }) }
  })
  const context = { workspace, variables: { inventory_targets: JSON.stringify(ids), reports_series_id: 'A'.repeat(26), telegram_chat_id: '123', delivery_mode: 'live' }, input: { runId: 'run1', eventIds: ['event1'], checkpointRevision: revision, checkpoint }, tools: { invoke: vi.fn(async ({ sshInventory }) => { if (sshInventory === ids[failedHost]) throw new Error('SSH timeout'); return structuredClone(observed) }) }, credentials: { get: vi.fn(async () => 'synthetic-token') }, http: { request: http }, progress: { commit: vi.fn(async (next) => { checkpoint = next.checkpoint; revision++; return { revision } }) } }
  return { context, http, checkpoint: () => checkpoint, revision: () => revision, report: () => JSON.parse(pendingBody) }
}
it('writes German prose, distinguishes missing observations and treats 404 as an unknown health route', () => {
  const incomplete = document({ [hosts[0]]: observed }, '2026-09-30T13:00:00Z', 'A'.repeat(26))
  expect(incomplete.gaps).toBe(4)
  expect(incomplete.envelope.language).toBe('de')
  expect(incomplete.envelope.html).toContain('Sein Zustand ist unbekannt')
  const health = structuredClone(observed); health.facts.authHealth = [{ port: 3000, result: { value: 'HTTP 404' } }]
  expect(assess(hosts[4], health, new Date('2026-09-30T13:00:00Z')).html).toContain('nicht als ausgefallen bewertet')
  const injected = document({ [hosts[0]]: { error: '<script>bad</script>' } }, '2026-09-30T13:00:00Z', 'A'.repeat(26))
  expect(injected.envelope.html).not.toContain('<script>')
})
it('publishes and notifies on healthy runs, preserves receipts and skips replay of the same input', async () => {
  const f = fixture()
  await expect(run(f.context)).resolves.toMatchObject({ status: 'completed' })
  expect(f.http.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(2)
  expect(f.report().category).toBe('Test Runs')
  expect(f.context.tools.invoke).toHaveBeenCalledTimes(5)
  f.context.input.checkpoint = f.checkpoint(); f.context.input.checkpointRevision = f.revision()
  await run(f.context)
  expect(f.http.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(2)
  f.context.input.eventIds = ['event2']; f.context.input.runId = 'run2'
  await run(f.context)
  expect(f.http.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(4)
})
it('still publishes an incomplete report and notification when one server cannot be reached', async () => {
  const f = fixture(hosts[2])
  const result = await run(f.context)
  expect(result.status).toBe('completedWithGaps')
  expect(f.report().html).toContain('SSH timeout')
  expect(f.http.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(2)
  expect(result.gapIds).toHaveLength(1)
})
it('retains the frozen publication and effect key when notification delivery is uncertain', async () => {
  const f = fixture()
  const original = f.http.getMockImplementation()!
  f.http.mockImplementation(async (request) => { if (request.url.includes('telegram.org')) throw new Error('Effect outcome is unknown; reconcile before retrying'); return original(request) })
  await expect(run(f.context)).resolves.toMatchObject({ status: 'completedWithGaps' })
  expect(f.checkpoint()).toMatchObject({ pending: { publication: { url: 'https://report.openape.ai/r/fixture' } } })
  const firstKey = f.http.mock.calls.find(([request]) => request.url.includes('telegram.org'))![0].key
  f.context.input.checkpoint = f.checkpoint(); f.context.input.checkpointRevision = f.revision()
  await run(f.context)
  expect(f.context.tools.invoke).toHaveBeenCalledTimes(5)
  expect(f.http.mock.calls.filter(([request]) => request.url.endsWith('/api/reports'))).toHaveLength(1)
  expect(f.http.mock.calls.filter(([request]) => request.url.includes('telegram.org')).map(([request]) => request.key)).toEqual([firstKey, firstKey])
})
it('schedules Monday and Thursday at eight local time across the autumn DST change', () => {
  const cron = new Cron('0 8 * * 1,4', { timezone: 'Europe/Vienna', paused: true })
  expect(cron.nextRuns(4, new Date('2026-10-21T00:00:00Z')).map(date => date.toISOString())).toEqual(['2026-10-22T06:00:00.000Z', '2026-10-26T07:00:00.000Z', '2026-10-29T07:00:00.000Z', '2026-11-02T07:00:00.000Z'])
  cron.stop()
})
