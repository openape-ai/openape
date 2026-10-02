// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseNetworkDefinition } from '../../src/contracts/networks'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { NetworkEvents, canonicalNetworkJson } from '../../src/worker/scheduling/network-events'
import { NetworkInvocations } from '../../src/worker/scheduling/network-invocations'
import { RunStore } from '../../src/worker/runs/store'
import { installExample } from '../../src/worker/runs/examples'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import * as domains from '../../src/worker/recovery/domains'
import { NetworkRecovery } from '../../src/worker/scheduling/network-recovery'
import { fenceNetworkBoot } from '../../src/worker/scheduling/network-boot'
import { seedNetwork } from '../storage/network-fixture'

const stores: PodDatabase[] = []
const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-network-events-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const seed = seedNetwork(store)
  const binding = store.db.prepare('SELECT source_binding_id FROM network_members WHERE pod_id=?').get(seed.pod.id)!.source_binding_id as string
  const definition = parseNetworkDefinition({
    formatVersion: 1, kind: 'network', semantics: 'persistent-network-v1', id: seed.networkId, revision: 1, groupId: seed.groupId, name: 'Synthetic source',
    channels: ['input', 'other'].map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: { value: { type: 'string' }, count: { type: 'integer' } }, required: ['value'], additionalProperties: false } })),
    members: [{ podId: seed.pod.id, definitionId: seed.definitionId, definitionVersion: 1, bindingRevision: 1, source: { bindingId: binding, schedule: null }, serialCase: false, contract: { takes: [], gives: ['input', 'other'], summary: 'Synthetic source' } }],
  })
  const schemaHash = digest(canonicalNetworkJson({ schemaVersion: 1, schema: definition.channels[0]!.schema }))
  const boot = randomUUID(); const token = randomUUID()
  store.transaction(() => {
    const body = canonicalNetworkJson(definition)
    store.db.prepare('UPDATE network_revisions SET contract=?,content_hash=? WHERE network_id=?').run(body, digest(body), seed.networkId)
    store.db.prepare('UPDATE network_subscriptions SET schema_hash=? WHERE network_id=?').run(schemaHash, seed.networkId)
    store.db.prepare('UPDATE runs SET state=\'running\',finished_at=NULL WHERE id=?').run(seed.runId)
    store.db.prepare('UPDATE network_invocations SET state=\'running\',boot_nonce=?,claim_token=? WHERE run_id=?').run(boot, token, seed.runId)
    store.db.prepare('UPDATE network_invocations SET manifest=? WHERE run_id=?').run(JSON.stringify({ assignmentRevision: store.getPod(seed.pod.id).bindingRevision, resourceEpoch: 0, inputClaims: [] }), seed.runId)
    store.db.prepare('INSERT INTO run_leases VALUES(?,?,?,?,NULL)').run(seed.pod.id, seed.runId, boot, Date.now())
  })
  return { store, seed, events: new NetworkEvents(store, boot), authority: { runId: seed.runId, claimToken: token } }
}

const emission = { channel: 'input', key: 'item-1', sourceItemId: 'item-1', sourceVersion: 'v1', payload: { value: 'ready', count: 1 } }

function invocationFixture() {
  const { store, seed } = fixture()
  store.transaction(() => {
    store.db.prepare('DELETE FROM run_leases WHERE run_id=?').run(seed.runId)
    store.db.prepare('UPDATE runs SET state=\'completed\' WHERE id=?').run(seed.runId)
    store.db.prepare('UPDATE network_invocations SET state=\'completed\' WHERE run_id=?').run(seed.runId)
    store.db.prepare('DELETE FROM network_effect_receipts').run()
    store.db.prepare('DELETE FROM network_effect_attempts').run()
  })
  const resources = new ResourceRegistry(store, () => {})
  installExample(store, resources, seed.pod.id, 'deterministic', 'a'.repeat(64))
  store.db.prepare('UPDATE pod_definition_versions SET content_hash=? WHERE definition_id=?').run(store.getPod(seed.pod.id).activeScript!, seed.definitionId)
  const runs = new RunStore(store)
  const invocations = new NetworkInvocations(store, runs, '/unused')
  const reserve = () => invocations.reserve(seed.networkId, seed.pod.id, resources.epoch(seed.pod.id), 'manual', true)!
  return { store, seed, runs, invocations, reserve }
}

describe('network invocation transactions', () => {
  it('stages private progress and commits output, checkpoint, finish and lease release together', async () => {
    const { store, seed, runs, invocations, reserve } = invocationFixture()
    const authority = reserve()
    expect(invocations.stageProgress(authority, { expectedRevision: 1, checkpoint: { cursor: 'new-private-value' }, sources: [], claims: [] })).toEqual({ revision: 2 })
    expect(store.db.prepare('SELECT body FROM network_checkpoints WHERE pod_id=?').get(seed.pod.id)!.body).toBe('{"cursor":"retained"}')
    expect(store.db.prepare('SELECT 1 FROM network_case_sources WHERE source_item=?').get('item-1')).toBeUndefined()
    await invocations.finish(authority, 'completed', 'Private business summary', null, [], [emission])
    expect(store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE pod_id=?').get(seed.pod.id)).toMatchObject({ revision: 2, body: '{"cursor":"new-private-value"}' })
    expect(store.checkpoint(seed.pod.id).body).toEqual({})
    expect(runs.get(authority.runId)).toMatchObject({ state: 'completed', checkpointRevision: 2, summary: 'Network invocation finished' })
    expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(authority.runId)).toBeUndefined()
    expect(store.db.prepare('SELECT body FROM network_trace_events WHERE run_id=? AND kind=\'invocation-settled\'').get(authority.runId)!.body).toContain('Private business summary')
    expect(() => invocations.events.accept(authority, emission)).toThrow('authority')
  })

  it('retains the lease and old checkpoint when fan-out settlement fails', async () => {
    const { store, seed, runs, invocations, reserve } = invocationFixture()
    const authority = reserve()
    invocations.stageProgress(authority, { expectedRevision: 1, checkpoint: { cursor: 'not-committed' }, sources: [], claims: [] })
    store.db.prepare('UPDATE network_subscriptions SET schema_hash=? WHERE network_id=?').run(digest('invalid'), seed.networkId)
    await expect(invocations.finish(authority, 'completed', 'Done', null, [], [emission])).rejects.toThrow('subscription schema')
    expect(runs.get(authority.runId).state).toBe('running')
    expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(authority.runId)).toBeDefined()
    expect(store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(seed.pod.id)!.revision).toBe(1)
    expect(store.db.prepare('SELECT 1 FROM network_case_sources WHERE source_item=?').get('item-1')).toBeUndefined()
    await invocations.finish(authority, 'failed', 'Fan-out rejected', 'Private diagnostic', [], [])
    expect(runs.get(authority.runId)).toMatchObject({ state: 'failed', error: 'Network invocation requires inspection' })
  })

  it('rejects successful settlement after a resource change during asynchronous stop proof', async () => {
    const { store, seed, runs, invocations, reserve } = invocationFixture()
    const authority = reserve()
    let release: (() => void) | undefined
    vi.spyOn(domains, 'confirmDomainsStopped').mockImplementation(async () => { await new Promise<void>((resolve) => { release = resolve }) })
    const finishing = invocations.finish(authority, 'completed', 'Done', null, [], [emission])
    store.db.prepare('INSERT INTO resource_epochs VALUES(?,1) ON CONFLICT(pod_id) DO UPDATE SET epoch=epoch+1').run(seed.pod.id)
    release!()
    await expect(finishing).rejects.toThrow('resource epoch')
    expect(runs.get(authority.runId).state).toBe('running')
    expect(store.db.prepare('SELECT count(*) AS count FROM network_events WHERE json_extract(origin,\'$.invocationId\')=?').get(authority.runId)!.count).toBe(0)
    vi.mocked(domains.confirmDomainsStopped).mockResolvedValue()
    await invocations.failClosed(authority, new Error('Revoked resources'))
    expect(runs.get(authority.runId).state).toBe('interrupted')
    expect(store.db.prepare('SELECT boot_id FROM run_leases WHERE run_id=?').get(authority.runId)!.boot_id).toMatch(/^fenced:/)
  })

  it('allows one invocation per instance and shares the existing global lease table', () => {
    const { store, seed, invocations, reserve } = invocationFixture()
    reserve()
    expect(invocations.reserve(seed.networkId, seed.pod.id, 0, 'manual', true)).toBeNull()
    expect(store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(1)
    expect(invocations.reserve(seed.networkId, seed.pod.id, 0, 'schedule')).toBeNull()
  })

  it('fences callbacks while checking process shutdown and retains the lease if shutdown is unverified', async () => {
    const { store, runs, invocations, reserve } = invocationFixture()
    const authority = reserve()
    let release: (() => void) | undefined
    vi.spyOn(domains, 'confirmDomainsStopped').mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      throw new Error('Synthetic process is still present')
    })
    const finishing = invocations.finish(authority, 'completed', 'Done', null, [], [])
    expect(() => invocations.events.emission(authority, emission)).toThrow('authority')
    expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(authority.runId)).toBeDefined()
    release!(); await finishing
    expect(runs.get(authority.runId).state).toBe('interrupted')
    expect(store.db.prepare('SELECT boot_id FROM run_leases WHERE run_id=?').get(authority.runId)!.boot_id).toContain('fenced:')
    expect(store.db.prepare('SELECT state FROM network_invocations WHERE run_id=?').get(authority.runId)!.state).toBe('interrupted')
  })

  it('blocks successful settlement with an unresolved effect and retains an unknown receipt', async () => {
    const { store, seed, runs, invocations, reserve } = invocationFixture()
    const authority = reserve(); const key = digest('synthetic-in-flight-effect')
    store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,\'intent\',1,?)').run(key, authority.runId, seed.caseId, digest('input'), digest('manifest'), seed.networkId)
    store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,\'intent\',\'{}\',1)').run(key)
    await expect(invocations.finish(authority, 'completed', 'Done', null, [], [])).rejects.toThrow('reconciliation')
    expect(runs.get(authority.runId).state).toBe('running')
    await invocations.finish(authority, 'failed', 'Uncertain action', 'Unknown', [], [])
    expect(store.db.prepare('SELECT state FROM network_invocations WHERE run_id=?').get(authority.runId)!.state).toBe('unknown')
    expect(store.db.prepare('SELECT outcome FROM network_effect_receipts WHERE logical_action_key=? ORDER BY sequence DESC LIMIT 1').get(key)!.outcome).toBe('unknown')
    expect(runs.get(authority.runId).state).toBe('blocked')
    expect(() => reserve()).toThrow('external effect requiring review')
  })

  it('rejects legacy completion/interruption and fences an unfinished network boot without releasing its lease', () => {
    const { store, runs, invocations, reserve } = invocationFixture()
    const authority = reserve()
    invocations.stageProgress(authority, { expectedRevision: 1, checkpoint: { cursor: 'pending' }, sources: [], claims: [] })
    expect(() => runs.finish(authority.runId, 'completed', 'Done', null)).toThrow('atomic network settlement')
    expect(() => runs.interrupt(authority.runId, 'Legacy stop')).toThrow('network recovery')
    fenceNetworkBoot(store)
    expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(authority.runId)).toBeDefined()
    expect(store.db.prepare('SELECT state,staged_checkpoint FROM network_invocations WHERE run_id=?').get(authority.runId)).toMatchObject({ state: 'interrupted', staged_checkpoint: '{"body":{"cursor":"pending"},"revision":2}' })
    expect(() => invocations.events.accept(authority, emission)).toThrow('authority')
    expect(reserve()).toBeNull()
    store.db.prepare('DELETE FROM run_leases WHERE run_id=?').run(authority.runId)
    expect(() => reserve()).toThrow('recovery')
  })
})

describe('durable network event acceptance', () => {
  it('accepts once and returns the original receipt without repeating delivery', () => {
    const { store, seed, events, authority } = fixture()
    const first = events.accept(authority, emission)
    const repeated = events.accept(authority, { ...emission, key: 'different-display-key', payload: { count: 1, value: 'ready' } })
    expect(repeated).toEqual({ ...first, duplicate: true })
    expect(store.db.prepare('SELECT count(*) AS count FROM network_deliveries WHERE network_id=? AND state=\'pending\'').get(seed.networkId)!.count).toBe(1)
    expect(store.db.prepare('SELECT count FROM network_queue_counts WHERE network_id=? AND state=\'pending\'').get(seed.networkId)!.count).toBe(1)
    expect(store.db.prepare('SELECT body FROM network_checkpoints WHERE pod_id=?').get(seed.pod.id)!.body).toBe('{"cursor":"retained"}')
  })

  it('maps channels of one source version to the same case and advances only a new version', () => {
    const { events, authority } = fixture()
    const first = events.accept(authority, emission)
    const other = events.accept(authority, { ...emission, channel: 'other' })
    const updated = events.accept(authority, { ...emission, sourceVersion: 'v2' })
    expect(other.caseId).toBe(first.caseId); expect(other.caseRevision).toBe(1)
    expect(updated.caseId).toBe(first.caseId); expect(updated.caseRevision).toBe(2)
    expect(events.accept(authority, emission).caseRevision).toBe(1)
  })

  it('retains identity receipts after event pruning', () => {
    const { store, events, authority } = fixture()
    const accepted = events.accept(authority, { ...emission, channel: 'other' })
    store.db.prepare('DELETE FROM network_events WHERE id=?').run(accepted.eventId)
    expect(events.accept(authority, { ...emission, channel: 'other' })).toEqual({ eventId: accepted.eventId, duplicate: true, caseId: null, caseRevision: null })
  })

  it('rejects identity conflicts and rolls back the whole fan-out on invalid subscription', () => {
    const { store, seed, events, authority } = fixture()
    events.accept(authority, emission)
    expect(() => events.accept(authority, { ...emission, payload: { value: 'changed' } })).toThrow('conflicts')
    store.db.prepare('UPDATE network_subscriptions SET schema_hash=? WHERE network_id=?').run(digest('invalid'), seed.networkId)
    expect(() => events.accept(authority, { ...emission, sourceVersion: 'v2' })).toThrow('subscription schema')
    expect(store.db.prepare('SELECT current_revision FROM network_cases WHERE id=(SELECT case_id FROM network_case_sources WHERE network_id=? AND source_item=?)').get(seed.networkId, 'item-1')!.current_revision).toBe(1)
    expect(store.db.prepare('SELECT 1 FROM network_case_sources WHERE network_id=? AND source_version=\'v2\'').get(seed.networkId)).toBeUndefined()
  })

  it('fences boot, restore and epoch changes while allowing active work to settle during pause', () => {
    const { store, seed, events, authority } = fixture()
    expect(events.accept(authority, emission).duplicate).toBe(false)
    expect(() => events.accept({ ...authority, claimToken: randomUUID() }, emission)).toThrow('authority')
    expect(() => new NetworkEvents(store, randomUUID()).accept(authority, emission)).toThrow('authority')
    store.db.prepare('UPDATE networks SET activation_epoch=activation_epoch+1 WHERE id=?').run(seed.networkId)
    expect(() => events.accept(authority, emission)).toThrow('authority')
  })
})

it('persists jittered infrastructure deadlines and stops at three total source attempts', async () => {
  const { store, invocations, reserve } = invocationFixture()
  let previous: string | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const authority = reserve()
    expect(store.db.prepare('SELECT attempt,retry_of FROM network_invocation_controls WHERE run_id=?').get(authority.runId)).toEqual({ attempt, retry_of: previous })
    const before = Date.now()
    await invocations.finish(authority, 'failed', 'Infrastructure unavailable', 'Synthetic transient failure', [], [], true)
    const control = store.db.prepare('SELECT retry_at,failure_kind FROM network_invocation_controls WHERE run_id=?').get(authority.runId)!
    if (attempt < 3) {
      expect(Number(control.retry_at)).toBeGreaterThanOrEqual(before + 1600 * 2 ** (attempt - 1))
      expect(Number(control.retry_at)).toBeLessThan(Date.now() + 2401 * 2 ** (attempt - 1))
      expect(control.failure_kind).toBe('transient')
      store.db.prepare('UPDATE network_invocation_controls SET retry_at=? WHERE run_id=?').run(Date.now() - 1, authority.runId)
    }
    else {
      expect(control).toEqual({ retry_at: null, failure_kind: 'exhausted' })
    }
    expect(() => invocations.events.accept(authority, emission)).toThrow('authority')
    previous = authority.runId
  }
})

it('fences an expired source callback and refuses late successful settlement', async () => {
  const { store, invocations, reserve } = invocationFixture(); const authority = reserve()
  store.db.prepare('UPDATE network_invocation_controls SET deadline=? WHERE run_id=?').run(Date.now() - 1, authority.runId)
  expect(() => invocations.events.accept(authority, emission)).toThrow('deadline')
  await expect(invocations.finish(authority, 'completed', 'Late output', null, [], [emission])).rejects.toThrow('deadline')
  expect(store.db.prepare('SELECT 1 FROM network_case_sources WHERE source_item=?').get('item-1')).toBeUndefined()
  await invocations.finish(authority, 'cancelled', 'Deadline exceeded', 'Deadline exceeded', [], [])
})

it('releases only a proven stopped network process while retaining unknown effects and staged progress', async () => {
  const { store, seed, invocations, reserve } = invocationFixture(); const authority = reserve()
  invocations.stageProgress(authority, { expectedRevision: 1, checkpoint: { cursor: 'uncommitted' }, sources: [], claims: [] })
  const key = digest('uncertain-recovery-effect')
  store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,\'intent\',1,?)').run(key, authority.runId, seed.caseId, digest('input'), digest('grant'), seed.networkId)
  store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,\'intent\',\'{}\',1)').run(key)
  fenceNetworkBoot(store)
  const generation = Number(store.db.prepare('SELECT generation FROM network_invocations WHERE run_id=?').get(authority.runId)!.generation)
  const recovery = new NetworkRecovery(store, '/unused')
  await expect(recovery.inspect(seed.networkId, authority.runId, generation, () => {})).rejects.toThrow('evidence is missing')
  store.db.prepare('INSERT INTO execution_domains VALUES(?,?,?)').run(join(store.root, 'runs', authority.runId, 'domain'), authority.runId, process.pid)
  vi.spyOn(domains, 'confirmDomainsStopped').mockRejectedValueOnce(new Error('Synthetic process still present'))
  await expect(recovery.inspect(seed.networkId, authority.runId, generation, () => {})).rejects.toThrow('still present')
  expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(authority.runId)).toBeDefined()
  vi.mocked(domains.confirmDomainsStopped).mockResolvedValue(undefined)
  await recovery.inspect(seed.networkId, authority.runId, generation, () => {})
  expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(authority.runId)).toBeUndefined()
  expect(store.db.prepare('SELECT staged_checkpoint,state FROM network_invocations WHERE run_id=?').get(authority.runId)).toMatchObject({ state: 'unknown', staged_checkpoint: '{"body":{"cursor":"uncommitted"},"revision":2}' })
  expect(() => recovery.requeue(seed.networkId, authority.runId, generation, { fingerprint: digest('current'), resourceEpoch: 0, assignmentRevision: 1, scriptHash: seed.hash }, () => {})).toThrow('Unknown external effects')
  expect(store.db.prepare('SELECT outcome FROM network_effect_receipts WHERE logical_action_key=? ORDER BY sequence DESC LIMIT 1').get(key)!.outcome).toBe('unknown')
  const effect = { key, attempt: 1, sequence: 2, outcome: 'confirmed_applied' as const, evidence: 'Synthetic owner verified that the isolated action was applied once' }
  expect(() => recovery.reconcileEffect(seed.networkId, authority.runId, generation, { ...effect, sequence: 1 }, () => {})).toThrow('state changed')
  recovery.reconcileEffect(seed.networkId, authority.runId, generation, effect, () => {})
  expect(store.db.prepare('SELECT outcome FROM network_effect_receipts WHERE logical_action_key=? ORDER BY sequence').all(key).map(row => row.outcome)).toEqual(['intent', 'unknown', 'confirmed_applied'])
  recovery.requeue(seed.networkId, authority.runId, generation, { fingerprint: digest('current'), resourceEpoch: 0, assignmentRevision: store.getPod(seed.pod.id).bindingRevision, scriptHash: store.getPod(seed.pod.id).activeScript! }, () => {})
  expect(store.db.prepare('SELECT state FROM network_effect_attempts WHERE logical_action_key=?').get(key)!.state).toBe('confirmed_applied')
  expect(store.db.prepare('SELECT count(*) AS count FROM network_effect_attempts WHERE logical_action_key=?').get(key)!.count).toBe(1)
})
