// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { closeNetworks, networkFixture } from './network-fixture'
import { digest } from '../../src/worker/storage/database'
import { parseNetworkView } from '../../src/contracts/networks'
import { restoreNetworkStorage } from '../../src/worker/storage/network-restore'
import { pruneNetworkTraces } from '../../src/worker/scheduling/network-maintenance'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeNetworks)
function fixture() {
  const f = networkFixture()
  const source = f.pod('Case source', { takes: [], gives: ['cases'], summary: 'Reads cases' }, async () => {})
  const consumer = f.pod('Case consumer', { takes: ['cases'], gives: [], summary: 'Reviews cases' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['cases'])
  return { ...f, source, consumer, id }
}

it('reviews terminal archival without mutation, preserves historical rows and refuses future execution', async () => {
  const f = fixture(); const { id } = f
  const tables = ['pods', 'scripts', 'resources', 'checkpoints', 'network_members', 'network_checkpoints', 'network_revisions']
  const before = Object.fromEntries(tables.map(table => [table, f.store.db.prepare(`SELECT * FROM ${table}`).all()]))
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n
  const review = parseNetworkView(f.engine.execute({ type: 'archivePreview', id, revision: 1 })).archiveReview!
  expect(review.issues).toEqual([])
  expect(f.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
  const command = { type: 'archiveNetwork' as const, id, revision: 1, expectedFingerprint: review.fingerprint }
  expect(f.engine.execute(command).networks[0]!.state).toBe('archived')
  expect(f.engine.execute(command).networks[0]!.state).toBe('archived')
  for (const table of tables) expect(f.store.db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table])
  for (const type of ['activate', 'pause'] as const) expect(() => f.engine.execute({ type, id, revision: 1 })).toThrow('unavailable')
  expect(() => f.engine.execute({ type: 'preview', id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 })).toThrow('unavailable')
  expect(f.engine.execute({ type: 'detail', id, revision: 1 }).details!.definition.id).toBe(id)
  pruneNetworkTraces(f.store, Date.now() + 10 * 86400000)
  f.store.transaction(() => restoreNetworkStorage(f.store.db))
  expect(f.engine.execute(command).networks[0]!.state).toBe('archived')
  await f.engine.tick(); expect(f.started).toEqual([])
})

it('refuses stale and active archive reviews and preserves unsettled effects', () => {
  const f = fixture(); const { id } = f
  const review = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  f.engine.execute({ type: 'activate', id, revision: 1 })
  expect(f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!.issues).toContain('Pause the network before reviewing archival')
  expect(() => f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: review.fingerprint })).toThrow('review changed')
  f.engine.execute({ type: 'pause', id, revision: 1 })
  const runId = randomUUID()
  f.store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,0,1,?,NULL,0,1)').run(runId, f.source, f.store.getPod(f.source).activeScript!, 'completed', 'Synthetic retained effect')
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,?,NULL)').run(f.source, 'uncertain', 'http.request', digest('intent'), runId, 'unknown')
  const pending = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  expect(pending.issues).toContain('Reconcile retained legacy effects before changing the composition')
  expect(() => f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: pending.fingerprint })).toThrow('Reconcile')
  expect(f.engine.view().networks[0]!.state).toBe('paused')
  expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()!.state).toBe('unknown')
})

it('refuses archival while native leases, bounded batches, invocations, deliveries, joins or effect receipts remain unresolved', async () => {
  const f = fixture(); const { id } = f
  const issues = () => f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!.issues
  f.store.db.prepare('INSERT INTO program_leases VALUES(?,?,?,1,1)').run(f.source, randomUUID(), 'synthetic')
  expect(issues()).toContain('Wait for member program leases to settle')
  f.store.db.prepare('DELETE FROM program_leases').run()
  const preview = f.engine.execute({ type: 'preview', id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }).preview!
  f.store.db.prepare('UPDATE network_process_previews SET state=\'running\',consumed_at=1 WHERE id=?').run(preview.id)
  expect(issues()).toContain('Stop bounded processing before changing the composition')
  f.store.db.prepare('UPDATE network_process_previews SET state=\'stopped\' WHERE id=?').run(preview.id)
  f.engine.execute({ type: 'activate', id, revision: 1 })
  const source = f.engine.invocations.reserve(id, f.source, f.resources.epoch(f.source), 'manual')!
  expect(issues()).toContain('Settle network executions before changing the composition')
  expect(issues()).toContain('Wait for member process leases to settle')
  await f.engine.invocations.finish(source, 'completed', 'Synthetic source', null, [], [{ channel: 'cases', key: 'case', sourceItemId: 'case', sourceVersion: '1', payload: { subject: 'Retained case' } }])
  expect(issues()).toContain('Resolve pending network deliveries before changing the composition')
  const consumer = f.engine.invocations.reserve(id, f.consumer, f.resources.epoch(f.consumer), 'manual')!
  const event = f.store.db.prepare('SELECT id,case_id,case_revision FROM network_events').get()!
  const effectKey = digest('synthetic-action')
  f.store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,\'confirmed_applied\',1,?)').run(effectKey, consumer.runId, event.case_id!, digest('input'), digest('manifest'), id)
  expect(issues()).toContain('Reconcile external effect receipts before changing the composition')
  f.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,\'confirmed_applied\',?,1)').run(effectKey, '{"synthetic":true}')
  expect(issues()).not.toContain('Reconcile external effect receipts before changing the composition')
  f.store.db.prepare('INSERT INTO network_joins VALUES(?,?,?,?,1,?,1,\'blocked\',?)').run(id, 'synthetic-join', event.case_id!, event.case_revision!, '{}', 'Synthetic unresolved join')
  expect(issues()).toContain('Resolve pending joins before changing the composition')
  f.store.db.prepare('UPDATE network_joins SET state=\'discarded\',reason=? WHERE network_id=?').run('Synthetic explicit resolution', id)
  await f.engine.invocations.finish(consumer, 'completed', 'Synthetic consumer', null, [event.id as string], [])
  f.engine.execute({ type: 'pause', id, revision: 1 })
  expect(issues()).toEqual([])
  const archived = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: archived.fingerprint })
  expect(() => f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: digest('different') })).toThrow('different archive review')
  expect(() => f.engine.updateInstance(f.source, () => { throw new Error('Must not execute') })).toThrow('Archived')
  expect(() => f.engine.execute({ type: 'process', id, revision: 1, previewId: preview.id })).toThrow('unavailable')
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_effect_receipts').get()!.n).toBe(1)
})
