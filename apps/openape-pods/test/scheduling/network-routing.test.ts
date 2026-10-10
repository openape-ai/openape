// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { parseNetworkView, parseNetworkDefinition } from '../../src/contracts/networks'
import { fenceNetworkBoot } from '../../src/worker/scheduling/network-boot'
import { assertIntegrity } from '../../src/worker/storage/integrity'
import { restoreNetworkStorage } from '../../src/worker/storage/network-restore'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeNetworks)

function fixture() {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['mail.unsure'], summary: 'Source' }, async () => {})
  const received: string[] = []
  const consumer = f.pod('Selected', { takes: ['mail.selected'], gives: [], summary: 'Selected' }, async (items) => { received.push(...items.map(item => item.channel)) })
  const independent = f.pod('History', { takes: ['mail.unsure'], gives: [], summary: 'History' }, async () => {})
  const id = f.engine.execute({ type: 'create', draft: {
    name: 'Synthetic routed network', groupId: f.groupId,
    members: [{ podId: source, source: { schedule: null }, serialCase: false }, ...[consumer, independent].map(podId => ({ podId, source: null, serialCase: false }))],
    channels: ['mail.unsure', 'mail.selected'].map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } })),
    routes: [{ key: 'review', title: 'Choose a route', kind: 'choose', takes: 'mail.unsure', options: [{ key: 'keep', title: 'Keep', channel: 'mail.selected' }, { key: 'other', title: 'Other', channel: 'mail.selected' }] }],
  } }).createdId!
  const emit = async (version = 'provider-v1') => {
    const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual', true)!
    await f.engine.invocations.finish(authority, 'completed', 'Synthetic input', null, [], [{ channel: 'mail.unsure', key: version === 'provider-v1' ? 'one' : `one-${version}`, sourceItemId: 'immutable-one', sourceVersion: version, payload: { subject: 'One' } }])
  }
  return { ...f, id, source, consumer, independent, received, emit }
}

it('retains a paused owner choice, routes once with its original case and preserves independent delivery', async () => {
  const f = fixture()
  await f.emit()
  const view = parseNetworkView(f.engine.execute({ type: 'list' }))
  expect(view.networks[0]).toMatchObject({ state: 'paused', decisions: 1 })
  expect(view.choices).toHaveLength(1)
  expect(f.started).toEqual([])
  const choice = view.choices![0]!
  const command = { type: 'choose', id: f.id, revision: 1, eventId: choice.eventId, gate: 'review', option: 'keep' }
  expect(() => f.engine.execute({ ...command, eventId: randomUUID() })).toThrow('unavailable')
  expect(() => f.engine.execute({ ...command, revision: 2 })).toThrow()
  f.engine.execute(command)
  f.engine.execute(command)
  expect(() => f.engine.execute({ ...command, option: 'other' })).toThrow('different owner decision')
  expect(f.engine.execute({ type: 'list' }).choices).toBeUndefined()
  const events = f.store.db.prepare('SELECT id,case_id,case_revision,channel,origin FROM network_events ORDER BY accepted_at,rowid').all()
  expect(events).toHaveLength(2)
  expect(events[1]).toMatchObject({ case_id: choice.caseId, case_revision: 1, channel: 'mail.selected' })
  expect(JSON.parse(events[1]!.origin as string)).toMatchObject({ inputEventIds: [choice.eventId], gate: 'review', decision: 'keep' })
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_deliveries').get()!.n).toBe(2)
  f.process(f.id, [f.consumer, f.independent])
  await expect.poll(() => f.store.db.prepare('SELECT count(*) AS n FROM run_leases').get()!.n).toBe(0)
  expect(f.received).toEqual(['mail.selected'])
  expect(f.started.sort()).toEqual([f.consumer, f.independent].sort())
  await f.emit()
  expect(f.engine.execute({ type: 'list' }).choices).toBeUndefined()
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_events').get()!.n).toBe(2)
})

it('answers older waiting revisions of a case with one owner decision and keeps newer input open', async () => {
  const f = fixture()
  await f.emit('provider-v1')
  await f.emit('provider-v2')
  const [oldest, newest] = parseNetworkView(f.engine.execute({ type: 'list' })).choices!
  expect(oldest!.caseId).toBe(newest!.caseId)
  const command = { type: 'choose', id: f.id, revision: 1, gate: 'review', option: 'keep' }
  const selected = () => f.store.db.prepare('SELECT count(*) AS n FROM network_events WHERE channel=\'mail.selected\'').get()!.n
  f.engine.execute({ ...command, eventId: newest!.eventId })
  const view = parseNetworkView(f.engine.execute({ type: 'list' }))
  expect(view.choices).toBeUndefined()
  expect(view.networks[0]!.decisions).toBe(0)
  expect(selected()).toBe(1)
  expect(JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'choice-superseded\' AND event_id=?').get(oldest!.eventId)!.body as string)).toMatchObject({ gate: 'review', caseRevision: 1, decidedEventId: newest!.eventId, decision: 'keep' })
  // A surface that still shows the answered revision repeats the same decision without effect.
  f.engine.execute({ ...command, eventId: oldest!.eventId })
  expect(() => f.engine.execute({ ...command, eventId: oldest!.eventId, option: 'other' })).toThrow('different owner decision')
  expect(selected()).toBe(1)
  expect(f.engine.execute({ type: 'archivePreview', id: f.id, revision: 1 }).archiveReview!.issues).not.toContain('Resolve pending owner choices before changing the composition')
  await f.emit('provider-v3')
  const later = parseNetworkView(f.engine.execute({ type: 'list' })).choices!
  expect(later).toHaveLength(1)
  // Answering an older revision leaves the newer one, whose input differs, open.
  await f.emit('provider-v4')
  f.engine.execute({ ...command, eventId: later[0]!.eventId })
  expect(parseNetworkView(f.engine.execute({ type: 'list' })).choices!.map(choice => choice.eventId)).not.toContain(later[0]!.eventId)
  expect(parseNetworkView(f.engine.execute({ type: 'list' })).choices).toHaveLength(1)
})

it('blocks composition retirement while an owner choice is unresolved', async () => {
  const f = fixture()
  await f.emit()
  const preview = f.engine.execute({ type: 'archivePreview', id: f.id, revision: 1 }).archiveReview!
  expect(preview.issues).toContain('Resolve pending owner choices before changing the composition')
  expect(() => f.engine.execute({ type: 'archiveNetwork', id: f.id, revision: 1, expectedFingerprint: preview.fingerprint })).toThrow()
  expect(f.engine.execute({ type: 'list' }).choices).toHaveLength(1)
})

it('retains pending choices over a worker restart and fences them after restore', async () => {
  const f = fixture()
  await f.emit()
  const retained = f.store.db.prepare('SELECT * FROM network_choices').all()
  fenceNetworkBoot(f.store)
  expect(f.store.db.prepare('SELECT * FROM network_choices').all()).toEqual(retained)
  expect(f.engine.view().choices).toHaveLength(1)
  restoreNetworkStorage(f.store.db)
  const choice = f.engine.view().choices![0]!
  expect(() => f.engine.execute({ type: 'choose', id: f.id, revision: 1, eventId: choice.eventId, gate: choice.gate, option: 'keep' })).toThrow('reviewed baseline')
  expect(f.store.db.prepare('SELECT * FROM network_choices').all()).toEqual(retained)
})

it('rejects restored choice records whose gate or selected output differs from the pinned route', async () => {
  const f = fixture()
  await f.emit()
  expect(() => assertIntegrity(f.store.db, true)).not.toThrow()
  const choice = f.engine.view().choices![0]!
  f.store.db.prepare('UPDATE network_choices SET gate_key=?').run('foreign-gate')
  expect(() => assertIntegrity(f.store.db, true)).toThrow('choice scope')
  f.store.db.prepare('UPDATE network_choices SET gate_key=?').run(choice.gate)
  f.engine.execute({ type: 'choose', id: f.id, revision: 1, eventId: choice.eventId, gate: choice.gate, option: 'keep' })
  expect(() => assertIntegrity(f.store.db, true)).not.toThrow()
  f.store.db.prepare('UPDATE network_choices SET result_event_id=event_id').run()
  expect(() => assertIntegrity(f.store.db, true)).toThrow('choice scope')
})

it('refuses incompatible choice schemas before admitting work', () => {
  const f = fixture()
  const definition = JSON.parse(f.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(f.id)!.contract as string)
  definition.channels[1].schema.properties.extra = { type: 'string' }
  expect(() => parseNetworkDefinition(definition)).toThrow('identical input and output schemas')
})
