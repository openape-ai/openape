// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { NetworkEmission } from '../../src/worker/scheduling/network-events'
import { networkSettlementIssues } from '../../src/worker/scheduling/network-retirement'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeNetworks)

it('bounds declared feedback to its hops, delays each hop, schedules a re-emitted transition once and holds exhausted feedback for review', async () => {
  const f = networkFixture()
  const schema = { type: 'object' as const, properties: { subject: { type: 'string' as const } }, required: ['subject'], additionalProperties: false as const }
  const source = f.pod('Intake', { takes: [], gives: ['item'], summary: 'Emits an item' }, async () => {})
  const classifier = f.pod('Classifier', { takes: ['item', 'review'], gives: ['classified'], summary: 'Classifies items' }, async () => {})
  const reviewer = f.pod('Reviewer', { takes: ['classified'], gives: ['review'], summary: 'Sends items back' }, async () => {})
  const channels = ['item', 'classified', 'review'].map(name => ({ name, title: name, schemaVersion: 1, schema }))
  const members = [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: classifier, source: null, serialCase: false }, { podId: reviewer, source: null, serialCase: false }]
  // The same loop without a declaration is an immediate cycle and stays invalid.
  expect(() => f.engine.execute({ type: 'create', draft: { name: 'Undeclared loop', groupId: f.groupId, channels, members } })).toThrow('blocking diagnostics')
  const id = f.engine.execute({ type: 'create', draft: { name: 'Classification review', groupId: f.groupId, channels, members, feedback: [{ id: 'recheck', podId: reviewer, channel: 'review', delayMs: 1000, maxHops: 3, maxCaseAgeMs: 86400000 }] } }).createdId!
  const invocations = f.engine.invocations
  const settle = async (podId: string, emissions: NetworkEmission[], reason: 'manual' | 'event' = 'manual') => {
    const authority = invocations.reserve(id, podId, f.resources.epoch(podId), reason)
    expect(authority).not.toBeNull()
    const items = invocations.input(authority!).items
    await invocations.finish(authority!, 'completed', 'Synthetic step', null, items.map(item => item.eventId), emissions)
    return items
  }
  const hop = (eventId: string) => Number(f.store.db.prepare('SELECT json_extract(origin,\'$.feedbackHop\') AS hop FROM network_events WHERE id=?').get(eventId)!.hop)
  const pendingReviews = () => f.store.db.prepare('SELECT d.ready_at,d.accepted_at,e.id FROM network_deliveries d JOIN network_events e ON e.id=d.event_id WHERE e.channel=\'review\' AND d.state=\'pending\'').all()
  const classified = (key: string) => [{ channel: 'classified', key, payload: { subject: 'classified' } }]
  const review = (key: string) => ({ channel: 'review', key, payload: { subject: 'look again' } })
  await settle(source, [{ channel: 'item', key: 'INV-1', sourceItemId: 'INV-1', sourceVersion: '1', payload: { subject: 'INV-1' } }])
  for (let round = 1; round <= 3; round++) {
    const inputs = await settle(classifier, classified(`c${round}`))
    expect(inputs.map(item => item.channel)).toEqual(round === 1 ? ['item'] : ['review'])
    // Hops travel through ordinary derived events unchanged and grow only through the declared transition.
    expect(hop(f.store.db.prepare('SELECT id FROM network_events WHERE item_key=?').get(`c${round}`)!.id as string)).toBe(round - 1)
    // Emitting the same transition twice in one settlement schedules it once.
    await settle(reviewer, [review(`r${round}`), review(`r${round}`)])
    const pending = pendingReviews()
    expect(pending).toHaveLength(1)
    expect(Number(pending[0]!.ready_at) - Number(pending[0]!.accepted_at)).toBe(1000)
    expect(hop(pending[0]!.id as string)).toBe(round)
    // The delay holds the hop back until its time; pausing holds it back entirely.
    expect(invocations.reserve(id, classifier, f.resources.epoch(classifier), 'manual')).toBeNull()
    f.store.db.prepare('UPDATE network_deliveries SET ready_at=0 WHERE state=\'pending\'').run()
    if (round === 2) {
      f.engine.execute({ type: 'activate', id, revision: 1 })
      f.engine.execute({ type: 'pause', id, revision: 1 })
      expect(invocations.reserve(id, classifier, f.resources.epoch(classifier), 'event')).toBeNull()
    }
  }
  // The fourth hop exceeds the declared bound: it is stored and held for owner review instead of being dispatched.
  await settle(classifier, classified('c4'))
  // A second key for the same transition is refused rather than scheduled as another transition.
  const authority = invocations.reserve(id, reviewer, f.resources.epoch(reviewer), 'manual')!
  const inputs = invocations.input(authority).items
  invocations.events.accept(authority, review('r4'))
  expect(() => invocations.events.accept(authority, review('r4-other'))).toThrow('already scheduled for these inputs')
  await invocations.finish(authority, 'completed', 'Synthetic step', null, inputs.map(item => item.eventId), [])
  expect(invocations.reserve(id, classifier, f.resources.epoch(classifier), 'manual')).toBeNull()
  expect(pendingReviews()).toHaveLength(0)
  expect(f.store.db.prepare('SELECT d.state,d.reason FROM network_deliveries d JOIN network_events e ON e.id=d.event_id WHERE e.item_key=\'r4\'').all()).toEqual([{ state: 'blocked', reason: 'Feedback exceeded 3 hops' }])
  expect(f.engine.view().networks[0]!.counts).toMatchObject({ blocked: 1, pending: 0 })
  const heldEvent = f.store.db.prepare('SELECT id FROM network_events WHERE item_key=\'r4\'').get()!.id as string
  const trace = () => f.store.db.prepare('SELECT kind,event_id,body FROM network_trace_events WHERE kind IN (\'feedback-review\',\'feedback-review-resolved\',\'event-accepted\') ORDER BY id').all()
  expect(trace().filter(row => row.kind === 'feedback-review').map(row => ({ eventId: row.event_id, ...JSON.parse(row.body as string) }))).toEqual([{ eventId: heldEvent, channel: 'review', caseRevision: 1, feedback: 'recheck', hop: 4, delayMs: 1000, reason: 'Feedback exceeded 3 hops' }])
  expect(trace().filter(row => row.kind === 'event-accepted').map(row => JSON.parse(row.body as string).hop).filter(value => value !== undefined)).toEqual([1, 2, 3])
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_events WHERE channel=\'review\'').get()!.count).toBe(4)
  // Held feedback blocks composition changes until the owner discards it with evidence; the event and both trace lines stay.
  expect(networkSettlementIssues(f.store, id)).toContain('Resolve pending network deliveries before changing the composition')
  expect(() => f.engine.execute({ type: 'discardFeedback', id, revision: 1, eventId: heldEvent, evidence: ' ' })).toThrow('explicit owner evidence')
  f.engine.execute({ type: 'discardFeedback', id, revision: 1, eventId: heldEvent, evidence: 'Reviewed: the classifier cannot settle this item' })
  expect(() => f.engine.execute({ type: 'discardFeedback', id, revision: 1, eventId: heldEvent, evidence: 'again' })).toThrow('No held feedback delivery')
  expect(f.engine.view().networks[0]!.counts).toMatchObject({ blocked: 0, discarded: 1 })
  expect(networkSettlementIssues(f.store, id)).toEqual([])
  expect(trace().filter(row => row.kind === 'feedback-review-resolved').map(row => JSON.parse(row.body as string))).toEqual([{ eventId: heldEvent, reason: 'Reviewed: the classifier cannot settle this item' }])
  f.store.assertStorage()
})

it('holds feedback whose case revision would exceed its age bound after the delay', async () => {
  const f = networkFixture()
  const schema = { type: 'object' as const, properties: { subject: { type: 'string' as const } }, required: ['subject'], additionalProperties: false as const }
  const source = f.pod('Intake', { takes: [], gives: ['item'], summary: 'Emits an item' }, async () => {})
  const checker = f.pod('Checker', { takes: ['item', 'again'], gives: ['again'], summary: 'Asks itself again' }, async () => {})
  const id = f.engine.execute({ type: 'create', draft: { name: 'Aged feedback', groupId: f.groupId, channels: ['item', 'again'].map(name => ({ name, title: name, schemaVersion: 1, schema })), members: [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: checker, source: null, serialCase: false }], feedback: [{ id: 'again', podId: checker, channel: 'again', delayMs: 1000, maxHops: 3, maxCaseAgeMs: 5000 }] } }).createdId!
  const invocations = f.engine.invocations
  const settle = async (podId: string, emissions: NetworkEmission[]) => {
    const authority = invocations.reserve(id, podId, f.resources.epoch(podId), 'manual')!
    const items = invocations.input(authority).items
    await invocations.finish(authority, 'completed', 'Synthetic step', null, items.map(item => item.eventId), emissions)
  }
  await settle(source, [{ channel: 'item', key: 'INV-1', sourceItemId: 'INV-1', sourceVersion: '1', payload: { subject: 'INV-1' } }])
  // The age counts from the case revision, not from the first source version: a revision made now is young even when its case is old.
  f.store.db.prepare('UPDATE network_cases SET created_at=created_at-100000').run()
  await settle(checker, [{ channel: 'again', key: 'a1', payload: { subject: 'again' } }])
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE state!=\'done\' ORDER BY accepted_at DESC').get()!.state).toBe('pending')
  f.store.db.prepare('UPDATE network_case_revisions SET created_at=created_at-4500').run()
  f.store.db.prepare('UPDATE network_deliveries SET ready_at=0 WHERE state=\'pending\'').run()
  await settle(checker, [{ channel: 'again', key: 'a2', payload: { subject: 'again' } }])
  expect(f.store.db.prepare('SELECT d.state,d.reason FROM network_deliveries d JOIN network_events e ON e.id=d.event_id WHERE e.item_key=\'a2\'').get()).toEqual({ state: 'blocked', reason: 'Feedback case is older than 5000 ms' })
  f.store.assertStorage()
})
