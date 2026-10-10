// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { emptyPackages } from '../../src/contracts/dependencies'
import type { GraphContract } from '../../src/contracts/graphs'
import { parseNetworkView } from '../../src/contracts/networks'
import { digest } from '../../src/worker/storage/database'
import { mapView } from '../../src/worker/workspace/map-view'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeNetworks)

const selected: GraphContract = { takes: ['mail.selected'], gives: [], summary: 'Selected' }

function fixture() {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['mail.unsure'], summary: 'Source' }, async () => {})
  const received: string[] = []
  const consumer = f.pod('Selected', selected, async (items) => { received.push(...items.map(item => item.key)) })
  const id = f.engine.execute({ type: 'create', draft: {
    name: 'Synthetic member update network', groupId: f.groupId,
    members: [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }],
    channels: ['mail.unsure', 'mail.selected'].map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } })),
    routes: [{ key: 'review', title: 'Choose a route', kind: 'choose', takes: 'mail.unsure', options: [{ key: 'keep', title: 'Keep', channel: 'mail.selected' }, { key: 'other', title: 'Other', channel: 'mail.selected' }] }],
  } }).createdId!
  const emit = async (key: string) => {
    const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual', true)!
    await f.engine.invocations.finish(authority, 'completed', 'Synthetic input', null, [], [{ channel: 'mail.unsure', key, sourceItemId: `immutable-${key}`, sourceVersion: 'provider-v1', payload: { subject: key } }])
  }
  const choose = (eventId: string) => f.engine.execute({ type: 'choose', id, revision: 1, eventId, gate: 'review', option: 'keep' })
  // Stores a script version as validation would: same binding manifest, new code, validated for the current resources.
  const validated = (contract: GraphContract, marker: string, overrides: Record<string, unknown> = {}) => {
    const active = f.store.getPod(consumer).activeScript!
    const manifest = JSON.parse(f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(consumer, active)!.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)};\n// ${marker}\nexport async function run(context) { return {status:'completed',summary:'Updated',completedInputIds:context.input.eventIds,gapIds:[]}; }\n`
    const hash = digest(code)
    f.store.storeScript(consumer, { ...manifest, ...overrides, contentHash: hash, contract }, code)
    f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(consumer, hash, f.store.getPod(consumer).bindingRevision, f.resources.epoch(consumer), '{"synthetic":true}')
    return hash
  }
  const update = (hash: string) => f.engine.updateMemberScript({ type: 'updateMemberScript', id, revision: 1, podId: consumer, hash })
  const pin = () => f.store.db.prepare('SELECT v.content_hash FROM instance_definition_bindings m JOIN pod_definition_versions v ON v.definition_id=m.definition_id AND v.version=m.definition_version WHERE m.pod_id=?').get(consumer)!.content_hash
  return { ...f, id, source, consumer, received, emit, choose, validated, update, pin }
}

it('updates one member script while another decision stays open and runs the new script for later work', async () => {
  const f = fixture()
  await f.emit('first')
  const choice = parseNetworkView(f.engine.execute({ type: 'list' })).choices![0]!
  const hash = f.validated(selected, 'fixed')

  f.update(hash)

  expect(f.store.getPod(f.consumer).activeScript).toBe(hash)
  expect(f.pin()).toBe(hash)
  const network = f.store.db.prepare('SELECT revision,state FROM networks WHERE id=?').get(f.id)!
  expect(network).toMatchObject({ revision: 1, state: 'paused' })
  const revision = f.store.db.prepare('SELECT contract,content_hash FROM network_revisions WHERE network_id=?').get(f.id)!
  expect(revision.content_hash).toBe(digest(revision.contract as string))
  const pinned = f.store.db.prepare('SELECT definition_id,definition_version FROM instance_definition_bindings WHERE pod_id=?').get(f.consumer)!
  expect(JSON.parse(revision.contract as string).members.find((member: { podId: string }) => member.podId === f.consumer)).toMatchObject({ definitionId: pinned.definition_id, definitionVersion: pinned.definition_version })
  expect(JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'member-script-updated\'').get()!.body as string)).toMatchObject({ podId: f.consumer, script: hash, definitionVersion: pinned.definition_version, via: 'mcp' })
  expect(parseNetworkView(f.engine.execute({ type: 'list' })).choices).toHaveLength(1)
  f.store.assertStorage()
  expect(mapView(f.store).pods.find(pod => pod.id === f.consumer)!.scriptUpdate).toMatchObject({ script: hash, previous: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(mapView(f.store, Date.now(), true).pods.find(pod => pod.id === f.consumer)?.scriptUpdate).toBeUndefined()

  f.choose(choice.eventId)
  f.process(f.id, [f.consumer])
  await expect.poll(() => f.store.db.prepare('SELECT count(*) AS n FROM run_leases').get()!.n).toBe(0)
  expect(f.received).toEqual(['first'])
  expect(f.store.db.prepare('SELECT r.script_hash FROM runs r JOIN network_invocations i ON i.run_id=r.id WHERE i.pod_id=?').get(f.consumer)!.script_hash).toBe(hash)
})

it('refuses contract, rights, dependency and unvalidated changes and leaves the pin unchanged', () => {
  const f = fixture()
  const active = f.store.getPod(f.consumer).activeScript
  expect(() => f.update(f.validated(selected, 'checkpoint', { checkpointSchemaVersion: 99 }))).toThrow('Checkpoint or trigger changes')
  expect(() => f.update(f.validated({ ...selected, summary: 'Changed contract' }, 'contract'))).toThrow('Contract changes')
  expect(() => f.update(f.validated(selected, 'rights', { capabilities: ['mail.read'] }))).toThrow('Rights changes')
  const packaged = f.validated(selected, 'packages')
  f.store.db.prepare('INSERT INTO dependency_sets VALUES(?,?,?,\'{}\',\'[]\')').run(f.consumer, 'b'.repeat(64), JSON.stringify({ dependencies: { leftpad: '1.0.0' } }))
  f.store.db.prepare('INSERT INTO script_dependencies VALUES(?,?,?)').run(f.consumer, packaged, 'b'.repeat(64))
  expect(() => f.update(packaged)).toThrow('Dependency changes')
  const unvalidated = f.validated(selected, 'unvalidated')
  f.store.db.prepare('DELETE FROM validations WHERE script_hash=?').run(unvalidated)
  expect(() => f.update(unvalidated)).toThrow('Validate this script')
  expect(f.store.getPod(f.consumer).activeScript).toBe(active)
  expect(f.pin()).toBe(active)
})

it('waits while the member itself has a running invocation', async () => {
  const f = fixture()
  await f.emit('first')
  f.choose(parseNetworkView(f.engine.execute({ type: 'list' })).choices![0]!.eventId)
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'manual', true)!
  expect(authority).toBeTruthy()
  const active = f.store.getPod(f.consumer).activeScript
  expect(() => f.update(f.validated(selected, 'busy'))).toThrow('Wait for this Pod\'s network executions to settle')
  expect(f.pin()).toBe(active)
})

it('replays inputs of a run that failed under the earlier script exactly once', async () => {
  const f = fixture()
  await f.emit('first')
  f.choose(parseNetworkView(f.engine.execute({ type: 'list' })).choices![0]!.eventId)
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'manual', true)!
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic refusal', 'Protected or incomplete mail', [], [])
  expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE run_id=?').get(authority.runId)!.state).toBe('blocked')

  const unchanged = await f.engine.replayFailed({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })
  expect(unchanged.replay).toEqual({ replayed: [], skipped: [] })

  f.update(f.validated(selected, 'fixed'))
  const replay = await f.engine.replayFailed({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })
  expect(replay.replay).toEqual({ replayed: [authority.runId], skipped: [] })
  expect(f.store.db.prepare('SELECT state,attempt,run_id FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(f.consumer)).toMatchObject({ state: 'pending', attempt: 0, run_id: null })
  expect((await f.engine.replayFailed({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })).replay!.replayed).toEqual([])

  f.process(f.id, [f.consumer])
  await expect.poll(() => f.store.db.prepare('SELECT count(*) AS n FROM run_leases').get()!.n).toBe(0)
  expect(f.received).toEqual(['first'])
  expect(f.store.db.prepare('SELECT state FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(f.consumer)!.state).toBe('done')
  f.store.assertStorage()
})

it('does not replay a failed run that attempted an external effect', async () => {
  const f = fixture()
  await f.emit('first')
  f.choose(parseNetworkView(f.engine.execute({ type: 'list' })).choices![0]!.eventId)
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'manual', true)!
  const input = f.store.db.prepare('SELECT case_id,case_revision FROM network_deliveries WHERE run_id=?').get(authority.runId)!
  f.store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,?,?,?,\'confirmed_applied\',?,?)').run('c'.repeat(64), authority.runId, input.case_id!, input.case_revision!, 'd'.repeat(64), 'e'.repeat(64), Date.now(), f.id)
  f.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,\'confirmed_applied\',\'{}\',?)').run('c'.repeat(64), Date.now())
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic refusal', 'Failure after an applied effect', [], [])
  f.update(f.validated(selected, 'fixed'))
  const result = await f.engine.replayFailed({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })
  expect(result.replay).toEqual({ replayed: [], skipped: [] })
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE run_id=?').get(authority.runId)!.state).not.toBe('pending')
})

it('keeps an active network active and forks a definition shared with another instance', async () => {
  const f = fixture()
  f.engine.execute({ type: 'activate', id: f.id, revision: 1 })
  const shared = f.store.db.prepare('SELECT definition_id FROM instance_definition_bindings WHERE pod_id=?').get(f.consumer)!.definition_id as string
  const other = f.store.createPod({ name: 'Other instance' })
  f.store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(other.id, shared)

  f.update(f.validated(selected, 'fixed'))

  expect(f.store.db.prepare('SELECT state,revision FROM networks WHERE id=?').get(f.id)).toMatchObject({ state: 'active', revision: 1 })
  const member = f.store.db.prepare('SELECT definition_id,definition_version FROM instance_definition_bindings WHERE pod_id=?').get(f.consumer)!
  expect(member.definition_id).not.toBe(shared)
  expect(member.definition_version).toBe(1)
  expect(f.store.db.prepare('SELECT max(version) AS version FROM pod_definition_versions WHERE definition_id=?').get(shared)!.version).toBe(1)
  expect(f.store.db.prepare('SELECT state FROM pod_definition_sources WHERE definition_id=?').get(member.definition_id!)!.state).toBe('legacy')
  f.store.assertStorage()
})

it('leaves owner-held and cancelled runs to desktop review', async () => {
  const f = fixture()
  await f.emit('first')
  f.choose(parseNetworkView(f.engine.execute({ type: 'list' })).choices![0]!.eventId)
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'manual', true)!
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic refusal', 'Failure', [], [])
  f.update(f.validated(selected, 'fixed'))
  for (const kind of ['quota', 'recovery']) {
    f.store.db.prepare('UPDATE network_invocation_controls SET failure_kind=? WHERE run_id=?').run(kind, authority.runId)
    expect((await f.engine.replayFailed({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })).replay).toEqual({ replayed: [], skipped: [] })
  }
  f.store.db.prepare('UPDATE network_invocation_controls SET failure_kind=\'exhausted\',settlement_receipt=? WHERE run_id=?').run(JSON.stringify({ state: 'cancelled' }), authority.runId)
  expect((await f.engine.replayFailed({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })).replay).toEqual({ replayed: [], skipped: [] })
  f.store.db.prepare('UPDATE networks SET baseline_state=\'review_required\',state=\'paused\' WHERE id=?').run(f.id)
  await expect(f.engine.replayFailed({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })).rejects.toThrow('Restored networks')
})

it('appends an unpublished version to a definition owned only by this member', async () => {
  const f = fixture()
  const binding = f.store.db.prepare('SELECT definition_id FROM instance_definition_bindings WHERE pod_id=?').get(f.consumer)!
  const active = f.store.getPod(f.consumer).activeScript!
  f.store.db.prepare('INSERT INTO pod_definition_sources VALUES(?,1,\'published\',?,?,?,NULL)').run(binding.definition_id!, f.consumer, f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(f.consumer, active)!.manifest as string, JSON.stringify(emptyPackages()))
  const hash = f.validated(selected, 'fixed')
  f.update(hash)
  expect(f.store.db.prepare('SELECT definition_id,definition_version FROM instance_definition_bindings WHERE pod_id=?').get(f.consumer)).toEqual({ definition_id: binding.definition_id, definition_version: 2 })
  expect(f.store.db.prepare('SELECT state FROM pod_definition_sources WHERE definition_id=? AND version=2').get(binding.definition_id!)!.state).toBe('legacy')
  expect(f.pin()).toBe(hash)
})

it('accepts a script validated under a newer app runtime lock', () => {
  const f = fixture()
  const hash = f.validated(selected, 'upgraded runtime', { dependencyLockHash: 'f'.repeat(64) })
  f.update(hash)
  expect(f.pin()).toBe(hash)
  f.store.assertStorage()
})
