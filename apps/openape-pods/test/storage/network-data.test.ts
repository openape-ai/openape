// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeNetworks, networkFixture } from '../scheduling/network-fixture'
import { pruneNetworkTraces } from '../../src/worker/scheduling/network-maintenance'
import { networkConfiguration } from '../../src/worker/scheduling/network-config'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { PodDatabase, digest, schemaVersion } from '../../src/worker/storage/database'
import { NetworkRecovery } from '../../src/worker/scheduling/network-recovery'
import { fenceNetworkBoot } from '../../src/worker/scheduling/network-boot'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); closeNetworks() })

function fixture() {
  const f = networkFixture()
  const contract = { takes: [], gives: ['output'], summary: 'Synthetic data producer' }
  const first = f.pod('First writer', contract, async () => {})
  const second = f.pod('Second writer', contract, async () => {})
  const consumer = f.pod('Pending consumer', { takes: ['output'], gives: [], summary: 'Synthetic downstream consumer' }, async () => {})
  const networkId = f.create([...([first, second].map(podId => ({ podId, source: { schedule: null }, serialCase: false }))), { podId: consumer, source: null, serialCase: false }], ['output'])
  const collectionId = randomUUID(); const scopeId = randomUUID()
  f.store.transaction(() => {
    f.store.db.prepare('INSERT INTO data_collections VALUES(?,?,?,?,?,1,?)').run(collectionId, f.owner.issuer, f.owner.subject, f.groupId, 'cases', '{}')
    f.store.db.prepare('INSERT INTO data_collection_versions VALUES(?,1,?,?,?)').run(collectionId, JSON.stringify({ type: 'object', properties: { status: { type: 'string' }, count: { type: 'integer' }, artifact: { type: 'string' } }, required: ['status'], additionalProperties: false }), JSON.stringify([{ name: 'status', field: 'status' }, { name: 'count', field: 'count' }]), Date.now())
    f.store.db.prepare('INSERT INTO artifact_scopes VALUES(?,?,?,?,?,NULL)').run(scopeId, f.owner.issuer, f.owner.subject, f.groupId, collectionId)
    for (const podId of [first, second]) {
      for (const operation of ['read', 'write', 'delete']) f.store.db.prepare('INSERT INTO data_permissions VALUES(?,?,?,?,?,?,?,1)').run(networkId, podId, collectionId, f.owner.issuer, f.owner.subject, f.groupId, operation)
      for (const operation of ['read', 'create']) f.store.db.prepare('INSERT INTO artifact_permissions VALUES(?,?,?,?,?,?,?,1)').run(networkId, podId, scopeId, f.owner.issuer, f.owner.subject, f.groupId, operation)
    }
  })
  const invocations = f.engine.invocations
  const reserve = (podId = first) => invocations.reserve(networkId, podId, f.resources.epoch(podId), 'manual')!
  return { ...f, first, second, consumer, networkId, collectionId, scopeId, invocations, reserve, data: invocations.data }
}

describe('scoped shared collection transactions', () => {
  it('commits both staged revisions with provenance and lets another authorized Pod update the same case', async () => {
    const f = fixture(); const first = f.reserve()
    expect(f.data.put(first, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'new' } })).toEqual({ revision: 1 })
    expect(f.data.put(first, { collection: 'cases', key: 'one', expectedRevision: 1, value: { status: 'reviewed' } })).toEqual({ revision: 2 })
    expect(f.data.get(first, { collection: 'cases', key: 'one' })).toMatchObject({ revision: 2, value: { status: 'reviewed' }, provenance: { staged: true, verification: 'proposed' } })
    expect(f.store.db.prepare('SELECT 1 FROM data_records').get()).toBeUndefined()
    await f.invocations.finish(first, 'completed', 'Committed', null, [], [])
    const second = f.reserve(f.second)
    expect(f.data.get(second, { collection: 'cases', key: 'one' })).toMatchObject({ revision: 2, provenance: { podId: f.first, invocationId: first.runId, staged: false, verification: 'proposed' } })
    f.data.put(second, { collection: 'cases', key: 'one', expectedRevision: 2, value: { status: 'done' } })
    await f.invocations.finish(second, 'completed', 'Updated', null, [], [])
    expect(f.store.db.prepare('SELECT revision FROM data_records').get()!.revision).toBe(3)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM data_record_revisions').get()!.count).toBe(3)
  })

  it('rejects a stale writer and rolls back all records, checkpoint and emitted outputs', async () => {
    const f = fixture(); const first = f.reserve(); const second = f.reserve(f.second)
    for (const authority of [first, second]) f.data.put(authority, { collection: 'cases', key: 'shared', expectedRevision: 0, value: { status: authority.runId } })
    f.data.put(second, { collection: 'cases', key: 'unrelated', expectedRevision: 0, value: { status: 'must roll back' } })
    f.invocations.stageProgress(second, { expectedRevision: 0, checkpoint: { advanced: true }, sources: [], claims: [] })
    await f.invocations.finish(first, 'completed', 'First wins', null, [], [])
    await expect(f.invocations.finish(second, 'completed', 'Must fail atomically', null, [], [{ channel: 'output', key: 'stale', sourceItemId: 'stale', sourceVersion: '1', payload: { subject: 'Must not emit' } }])).rejects.toThrow('current revision 1')
    expect(f.store.db.prepare('SELECT 1 FROM data_records WHERE record_key=\'unrelated\'').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT 1 FROM network_events').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.second)!.revision).toBe(0)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM data_record_provenance').get()!.count).toBe(1)
  })

  it('rejects changed authority at settlement even without staged data and keeps outputs atomic', async () => {
    const f = fixture(); const authority = f.reserve()
    f.invocations.input(authority)
    f.invocations.stageProgress(authority, { expectedRevision: 0, checkpoint: { advanced: true }, sources: [], claims: [] })
    f.store.db.prepare('UPDATE data_permissions SET revision=revision+1 WHERE pod_id=?').run(f.first)
    await expect(f.invocations.finish(authority, 'completed', 'Must not commit after revocation', null, [], [{ channel: 'output', key: 'revoked', sourceItemId: 'revoked', sourceVersion: '1', payload: { subject: 'Must not emit' } }])).rejects.toThrow('bindings or configuration changed')
    expect(f.store.db.prepare('SELECT 1 FROM network_events').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.first)!.revision).toBe(0)
  })

  it('fences automatic retry data authority and freezes a fresh explicit owner retry', async () => {
    const f = fixture(); const original = f.reserve()
    await f.invocations.finish(original, 'failed', 'Synthetic safe infrastructure failure', 'Connection failed before any effect', [], [], true)
    f.store.db.prepare('UPDATE network_invocation_controls SET retry_at=0 WHERE run_id=?').run(original.runId)
    f.store.db.prepare('UPDATE data_permissions SET revision=revision+1 WHERE pod_id=?').run(f.first)
    expect(f.reserve()).toBeNull()
    expect(f.store.db.prepare('SELECT failure_kind,retry_at FROM network_invocation_controls WHERE run_id=?').get(original.runId)).toMatchObject({ failure_kind: 'invalid', retry_at: null })
    const generation = Number(f.store.db.prepare('SELECT generation FROM network_invocations WHERE run_id=?').get(original.runId)!.generation)
    const recovery = new NetworkRecovery(f.store, '/unused')
    await recovery.inspect(f.networkId, original.runId, generation, () => {})
    recovery.requeue(f.networkId, original.runId, generation, { fingerprint: 'synthetic-explicit-owner-review', resourceEpoch: 0, assignmentRevision: f.store.getPod(f.first).bindingRevision, scriptHash: f.store.getPod(f.first).activeScript! }, () => {})
    const reviewed = JSON.parse(f.store.db.prepare('SELECT retry_authority FROM network_invocation_controls WHERE run_id=?').get(original.runId)!.retry_authority as string)
    expect(reviewed.dataPin).toMatch(/^[a-f0-9]{64}$/)
    const retry = f.reserve()!
    expect(retry.runId).not.toBe(original.runId)
    expect(JSON.parse(f.store.db.prepare('SELECT manifest FROM network_invocations WHERE run_id=?').get(retry.runId)!.manifest as string).dataPin).toBe(reviewed.dataPin)
    await f.invocations.finish(retry, 'failed', 'Synthetic second safe failure', 'No effect', [], [], true)
    f.store.db.prepare('UPDATE network_invocation_controls SET retry_at=0 WHERE run_id=?').run(retry.runId)
    f.store.db.prepare('UPDATE data_permissions SET revision=revision+1 WHERE pod_id=?').run(f.first)
    expect(f.reserve()).toBeNull()
  })

  it('commits a staged write followed by deletion with both revisions and no visible record', async () => {
    const f = fixture(); const authority = f.reserve()
    f.data.put(authority, { collection: 'cases', key: 'temporary', expectedRevision: 0, value: { status: 'draft' } })
    f.data.put(authority, { collection: 'cases', key: 'temporary', expectedRevision: 1 }, true)
    expect(f.data.get(authority, { collection: 'cases', key: 'temporary' })).toBeNull()
    await f.invocations.finish(authority, 'completed', 'Draft deleted atomically', null, [], [])
    expect(f.store.db.prepare('SELECT revision,tombstone FROM data_records').get()).toEqual({ revision: 2, tombstone: 1 })
    expect(f.store.db.prepare('SELECT revision,tombstone FROM data_record_revisions ORDER BY revision').all()).toEqual([{ revision: 1, tombstone: 0 }, { revision: 2, tombstone: 1 }])
    expect(f.store.db.prepare('SELECT count(*) AS count FROM data_record_provenance').get()!.count).toBe(2)
  })

  it('refuses missing rights, stale bindings, untrusted fields and script owner verification', () => {
    const f = fixture(); const authority = f.reserve()
    expect(() => f.data.get(authority, { collection: randomUUID(), key: 'one' })).toThrow('explicit same-company')
    expect(() => f.data.put(authority, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'new' }, verification: 'owner_verified' })).toThrow('Unsupported scoped data fields')
    expect(() => f.data.put(authority, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: { kind: 'secret-reference', id: randomUUID() } } })).toThrow('scalar schema')
    f.store.db.prepare('UPDATE data_permissions SET revision=revision+1 WHERE pod_id=?').run(f.first)
    expect(() => f.data.get(authority, { collection: 'cases', key: 'one' })).toThrow('bindings or configuration changed')
  })

  it('refuses cross-company collections and deletion while related downstream work is unresolved', async () => {
    const f = fixture()
    const company = randomUUID(); const foreign = randomUUID()
    f.store.transaction(() => {
      f.store.db.prepare('INSERT INTO pod_groups VALUES(?,\'Other company\',0)').run(company)
      f.store.db.prepare('INSERT INTO data_collections VALUES(?,?,?,?,?,1,?)').run(foreign, f.owner.issuer, f.owner.subject, company, 'foreign', '{}')
      const original = f.store.db.prepare('SELECT schema,indexes FROM data_collection_versions WHERE collection_id=?').get(f.collectionId)!
      f.store.db.prepare('INSERT INTO data_collection_versions VALUES(?,1,?,?,?)').run(foreign, original.schema!, original.indexes!, Date.now())
    })
    const first = f.reserve()
    expect(() => f.data.get(first, { collection: foreign, key: 'one' })).toThrow('same-company')
    expect(() => f.store.db.prepare('INSERT INTO data_permissions VALUES(?,?,?,?,?,?,\'read\',1)').run(f.networkId, f.first, foreign, f.owner.issuer, f.owner.subject, company)).toThrow('FOREIGN KEY')
    f.data.put(first, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'pending' } })
    await f.invocations.finish(first, 'completed', 'Pending downstream', null, [], [{ channel: 'output', key: 'one', sourceItemId: 'one', sourceVersion: '1', payload: { subject: 'Unresolved downstream' } }])
    const second = f.reserve(f.second)
    expect(() => f.data.put(second, { collection: 'cases', key: 'one', expectedRevision: 1 }, true)).toThrow('owner review')
    expect(f.store.db.prepare('SELECT tombstone FROM data_records').get()!.tombstone).toBe(0)
  })

  it('permits deletion after related downstream work has actually settled as done', async () => {
    const f = fixture(); const first = f.reserve()
    f.data.put(first, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'ready' } })
    await f.invocations.finish(first, 'completed', 'Ready', null, [], [{ channel: 'output', key: 'one', sourceItemId: 'one', sourceVersion: '1', payload: { subject: 'Ready' } }])
    const consumer = f.reserve(f.consumer)
    await f.invocations.finish(consumer, 'completed', 'Downstream complete', null, f.invocations.input(consumer).items.map(item => item.eventId), [])
    expect(f.store.db.prepare('SELECT state FROM network_deliveries').get()!.state).toBe('done')
    const second = f.reserve(f.second)
    f.data.put(second, { collection: 'cases', key: 'one', expectedRevision: 1 }, true)
    await f.invocations.finish(second, 'completed', 'Resolved data deleted', null, [], [])
    expect(f.store.db.prepare('SELECT revision,tombstone FROM data_records').get()).toMatchObject({ revision: 2, tombstone: 1 })
  })

  it('preserves uncommitted drafts when terminal cleanup discovers an uncertain external effect', async () => {
    const f = fixture(); const authority = f.reserve()
    const artifact = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'YQ==', mediaType: 'text/plain' })
    f.data.put(authority, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'uncommitted' } })
    const event = f.invocations.events.accept(authority, { channel: 'output', key: 'one', sourceItemId: 'one', sourceVersion: '1', payload: { subject: 'Synthetic effect case' } })
    const key = digest('synthetic-uncertain-effect')
    f.store.transaction(() => {
      f.store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,\'intent\',1,?)').run(key, authority.runId, event.caseId!, digest('input'), digest('manifest'), f.networkId)
      f.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,\'intent\',\'{}\',1)').run(key)
    })
    await f.invocations.finish(authority, 'failed', 'Synthetic uncertain effect', 'Uncertain external state', [], [])
    expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE run_id=?').get(authority.runId)!.state).toBe('unknown')
    expect(f.store.db.prepare('SELECT 1 FROM network_data_staging').get()).toBeDefined()
    expect(f.store.db.prepare('SELECT 1 FROM network_artifact_staging').get()).toBeDefined()
    f.data.artifacts.prune(Date.now() + 100 * 86400000)
    expect(existsSync(join(f.store.root, 'artifacts', artifact.hash))).toBe(true)
    expect(f.store.db.prepare('SELECT 1 FROM data_records').get()).toBeUndefined()
  })

  it('rolls back staged records and artifact publication when a late emission fails', async () => {
    const f = fixture(); const authority = f.reserve()
    const artifact = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'YQ==', mediaType: 'text/plain' })
    f.data.put(authority, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'must roll back' }, artifacts: [{ id: artifact.id, scope: artifact.scope }] })
    await expect(f.invocations.finish(authority, 'completed', 'Invalid final output', null, [], [{ channel: 'output', key: 'one', sourceItemId: 'one', sourceVersion: '1', payload: { unexpected: 'not allowed' } }])).rejects.toThrow('schema')
    expect(f.store.db.prepare('SELECT 1 FROM data_records').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT 1 FROM data_record_revisions').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT 1 FROM artifacts').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT 1 FROM artifact_references').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT 1 FROM network_events').get()).toBeUndefined()
    expect(readFileSync(join(f.store.root, 'artifacts', artifact.hash), 'utf8')).toBe('a')
  })

  it('uses declared indexes, bounded stable cursors and the invocation staging overlay', async () => {
    const f = fixture(); const first = f.reserve()
    for (const key of ['a', 'b', 'c']) f.data.put(first, { collection: 'cases', key, expectedRevision: 0, value: { status: 'ready', count: 2 } })
    const query = { collection: 'cases', index: 'status', operator: 'eq', value: 'ready', limit: 2 }
    expect(f.data.query(first, query)).toMatchObject({ records: [{ key: 'a' }, { key: 'b' }], cursor: 'b' })
    await f.invocations.finish(first, 'completed', 'Indexed', null, [], [])
    const second = f.reserve(f.second)
    f.data.put(second, { collection: 'cases', key: 'b', expectedRevision: 1, value: { status: 'other', count: 3 } })
    expect(f.data.query(second, query)).toMatchObject({ records: [{ key: 'a' }, { key: 'c' }], cursor: null })
    expect(f.data.query(second, { ...query, cursor: 'a' })).toMatchObject({ records: [{ key: 'c' }] })
    expect(f.data.query(second, { ...query, index: 'count', operator: 'gte', value: 3 })).toMatchObject({ records: [{ key: 'b' }] })
    expect(() => f.data.query(second, { ...query, index: 'implicit' })).toThrow('declared index')
    expect(() => f.data.query(second, { ...query, limit: 101 })).toThrow('limit 1–100')
    expect(() => f.data.query(second, { ...query, sql: 'SELECT *' })).toThrow('Unsupported scoped data fields')
  })

  it('uses SQLite Unicode ordering for both staged and committed pagination and string ranges', async () => {
    const f = fixture(); const authority = f.reserve()
    const keys = ['\uE000', '😀']
    for (const key of keys) f.data.put(authority, { collection: 'cases', key, expectedRevision: 0, value: { status: key, count: 1 } })
    const check = (current: typeof authority) => {
      const first = f.data.query(current, { collection: 'cases', index: 'count', operator: 'eq', value: 1, limit: 1 })
      expect(first.records.map(record => record.key)).toEqual([keys[0]])
      expect(first.cursor).toBe(keys[0])
      const second = f.data.query(current, { collection: 'cases', index: 'count', operator: 'eq', value: 1, limit: 1, cursor: first.cursor })
      expect(second.records.map(record => record.key)).toEqual([keys[1]])
      expect(second.cursor).toBeNull()
      expect(f.data.query(current, { collection: 'cases', index: 'status', operator: 'gt', value: keys[0], limit: 10 }).records.map(record => record.key)).toEqual([keys[1]])
    }
    check(authority)
    await f.invocations.finish(authority, 'completed', 'Unicode order committed', null, [], [])
    check(f.reserve(f.second))
  })

  it('bounds query response bytes and continues its stable cursor without losing staged records', () => {
    const f = fixture(); const authority = f.reserve()
    const references = Array.from({ length: 16 }, () => {
      const artifact = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: '', mediaType: 'text/plain' })
      return { id: artifact.id, scope: artifact.scope }
    })
    for (let index = 0; index < 100; index++) f.data.put(authority, { collection: 'cases', key: String(index).padStart(3, '0'), expectedRevision: 0, value: { status: 'ready', artifact: 'x'.repeat(900) }, artifacts: references })
    const keys: string[] = []; let cursor: string | null = null
    do {
      const page = f.data.query(authority, { collection: 'cases', index: 'status', operator: 'eq', value: 'ready', limit: 100, cursor })
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(196700)
      keys.push(...page.records.map(record => record.key)); cursor = page.cursor
    } while (cursor !== null)
    expect(keys).toEqual(Array.from({ length: 100 }, (_, index) => String(index).padStart(3, '0')))
  })

  it('keeps configuration separate with explicit origins and typed protected secret references', () => {
    const f = fixture()
    const binding = f.store.db.prepare('SELECT definition_id FROM network_members WHERE pod_id=?').get(f.first)!
    f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,\'region\',\'public\',?)').run(binding.definition_id!, JSON.stringify('default'))
    f.store.db.prepare('INSERT INTO composition_config VALUES(?,\'region\',?)').run(f.networkId, JSON.stringify('composition'))
    f.store.db.prepare('INSERT INTO instance_config VALUES(?,\'region\',?)').run(f.first, JSON.stringify('instance'))
    expect(networkConfiguration(f.store, f.networkId, f.first)).toMatchObject({ region: { value: 'instance', origin: 'pod', kind: 'public' } })
    f.store.db.prepare('DELETE FROM instance_config').run()
    expect(networkConfiguration(f.store, f.networkId, f.first).region).toMatchObject({ value: 'composition', origin: 'composition' })
    const secret = { kind: 'secret-reference', id: randomUUID() }
    f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,\'api-key\',\'secret-reference\',?)').run(binding.definition_id!, JSON.stringify(secret))
    expect(networkConfiguration(f.store, f.networkId, f.first)['api-key']).toMatchObject({ value: secret, origin: 'definition' })
    f.store.db.prepare('INSERT INTO instance_config VALUES(?,\'api-key\',?)').run(f.first, JSON.stringify('secret bytes'))
    expect(() => f.reserve()).toThrow('protected-store reference')
  })

  it('retains tombstone revision/provenance and requires that revision to recreate a deleted key', async () => {
    const f = fixture(); const first = f.reserve()
    f.data.put(first, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'new' } })
    await f.invocations.finish(first, 'completed', 'Created', null, [], [])
    const second = f.reserve(f.second)
    f.data.put(second, { collection: 'cases', key: 'one', expectedRevision: 1 }, true)
    expect(f.data.get(second, { collection: 'cases', key: 'one' })).toBeNull()
    expect(f.data.get(second, { collection: 'cases', key: 'one', includeDeleted: true })).toMatchObject({ revision: 2, deleted: true, value: null })
    await f.invocations.finish(second, 'completed', 'Deleted', null, [], [])
    const third = f.reserve()
    const tombstone = f.data.get(third, { collection: 'cases', key: 'one', includeDeleted: true })!
    expect(tombstone).toMatchObject({ revision: 2, deleted: true, provenance: { verification: 'proposed', podId: f.second } })
    expect(() => f.data.put(third, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'wrong' } })).toThrow('current revision 2')
    f.data.put(third, { collection: 'cases', key: 'one', expectedRevision: tombstone.revision, value: { status: 'restored' } })
    await f.invocations.finish(third, 'completed', 'Recreated', null, [], [])
    expect(f.store.db.prepare('SELECT revision,tombstone FROM data_records').get()).toMatchObject({ revision: 3, tombstone: 0 })
  })

  it('refuses changed configuration before script launch even without a data operation', () => {
    const f = fixture(); const authority = f.reserve()
    const binding = f.store.db.prepare('SELECT definition_id FROM network_members WHERE pod_id=?').get(f.first)!
    f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,\'region\',\'public\',?)').run(binding.definition_id!, JSON.stringify('new default'))
    expect(() => f.invocations.input(authority)).toThrow('bindings or configuration changed')
  })
})

describe('managed scoped artifacts', () => {
  it.each(['stableBytes', 'staged', 'recordsWritten', 'eventWritten', 'committed'])('retains atomic production data/artifact settlement after real SIGKILL at %s', async (point) => {
    const f = fixture()
    const loader = createRequire(import.meta.url).resolve('tsx')
    const modules = Object.fromEntries(['storage/database', 'runs/store', 'scheduling/network-invocations'].map(path => [path, resolve(`src/worker/${path}.ts`)]))
    const code = `
      import { PodDatabase } from ${JSON.stringify(modules['storage/database'])};
      import { RunStore } from ${JSON.stringify(modules['runs/store'])};
      import { NetworkInvocations } from ${JSON.stringify(modules['scheduling/network-invocations'])};
      const store = new PodDatabase(${JSON.stringify(f.store.root)});
      const invocations = new NetworkInvocations(store,new RunStore(store),'/unused');
      const point = ${JSON.stringify(point)}; const die = () => process.kill(process.pid,'SIGKILL');
      const authority = invocations.reserve(${JSON.stringify(f.networkId)},${JSON.stringify(f.first)},0,'manual');
      const prepare = store.db.prepare.bind(store.db);
      store.db.prepare = (sql) => { if(point==='stableBytes' && sql.startsWith('INSERT INTO network_artifact_staging'))die(); return prepare(sql); };
      const artifact = invocations.data.artifacts.create(authority,{scope:${JSON.stringify(f.scopeId)},bytesBase64:'YQ==',mediaType:'text/plain'});
      invocations.data.put(authority,{collection:'cases',key:'one',expectedRevision:0,value:{status:'new'},artifacts:[{id:artifact.id,scope:artifact.scope}]});
      invocations.stageProgress(authority,{expectedRevision:0,checkpoint:{committed:true},sources:[],claims:[]});
      if(point==='staged')die();
      const commit = invocations.data.commit.bind(invocations.data);
      invocations.data.commit = (...args) => { commit(...args); if(point==='recordsWritten')die(); };
      const accept = invocations.events.accept.bind(invocations.events);
      invocations.events.accept = (...args) => { const receipt=accept(...args); if(point==='eventWritten')die(); return receipt; };
      await invocations.finish(authority,'completed','Synthetic atomic data',null,[],[{channel:'output',key:'one',sourceItemId:'one',sourceVersion:'1',payload:{subject:'Synthetic committed data'}}]);
      die();
    `
    const child = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 20000 })
    expect(child.signal, child.stderr).toBe('SIGKILL')
    fenceNetworkBoot(f.store)
    const committed = point === 'committed'
    for (const table of ['data_records', 'data_record_revisions', 'data_record_provenance', 'artifacts', 'network_events']) expect(f.store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count).toBe(committed ? 1 : 0)
    expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.first)!.revision).toBe(committed ? 1 : 0)
    expect(readFileSync(join(f.store.root, 'artifacts', digest('a')), 'utf8')).toBe('a')
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_artifact_staging').get()!.count).toBe(point === 'stableBytes' || committed ? 0 : 1)
    if (!committed) {
      const invocation = f.store.db.prepare('SELECT run_id,generation FROM network_invocations WHERE pod_id=?').get(f.first)!
      const recovery = new NetworkRecovery(f.store, '/unused')
      await recovery.inspect(f.networkId, invocation.run_id as string, Number(invocation.generation), () => {})
      recovery.discardFailure(f.networkId, invocation.run_id as string, Number(invocation.generation), 'Synthetic owner reviewed crashed uncommitted data', () => {})
      f.data.artifacts.prune(Date.now() + 2 * 86400000)
      expect(existsSync(join(f.store.root, 'artifacts', digest('a')))).toBe(false)
    }
  })

  it('publishes durable scoped bytes with records and retains them across trace pruning and backup/restore', async () => {
    const f = fixture(); const authority = f.reserve()
    const artifact = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: Buffer.from('Synthetic retained evidence').toString('base64'), mediaType: 'text/plain' })
    const reference = { id: artifact.id, scope: artifact.scope }
    expect(f.data.artifacts.read(authority, reference)).toMatchObject({ bytesBase64: Buffer.from('Synthetic retained evidence').toString('base64') })
    expect(f.store.db.prepare('SELECT 1 FROM artifacts').get()).toBeUndefined()
    f.data.put(authority, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'ready', artifact: artifact.id }, artifacts: [reference] })
    await f.invocations.finish(authority, 'completed', 'Artifact committed', null, [], [])
    pruneNetworkTraces(f.store, Date.now() + 8 * 86400000)
    f.data.artifacts.prune(Date.now() + 100 * 86400000)
    expect(readFileSync(join(f.store.root, 'artifacts', artifact.hash), 'utf8')).toBe('Synthetic retained evidence')
    expect(f.store.db.prepare('SELECT 1 FROM artifact_references WHERE reference_kind=\'record\'').get()).toBeDefined()
    const exports = mkdtempSync(join(tmpdir(), 'pods-data-backup-'))
    const backup = await createBackup(f.store, exports)
    const restoredPath = await restoreBackup(backup, exports, schemaVersion)
    const restored = new PodDatabase(restoredPath)
    try {
      expect(readFileSync(join(restored.root, 'artifacts', artifact.hash), 'utf8')).toBe('Synthetic retained evidence')
      expect(restored.db.prepare('SELECT count(*) AS count FROM data_record_revisions').get()!.count).toBe(1)
    }
    finally { restored.close(); rmSync(exports, { recursive: true, force: true }) }
  })

  it('refuses another scope, host paths, malformed bytes, tampered files and revoked permissions', () => {
    const f = fixture(); const authority = f.reserve()
    expect(() => f.data.artifacts.create(authority, { scope: randomUUID(), bytesBase64: '', mediaType: 'text/plain' })).toThrow('same-company scope')
    expect(() => f.data.artifacts.create(authority, { scope: f.scopeId, path: '/etc/passwd', mediaType: 'text/plain' })).toThrow('Unsupported scoped data fields')
    expect(() => f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'a', mediaType: 'text/plain' })).toThrow('canonical base64')
    const artifact = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'YQ==', mediaType: 'text/plain' })
    const reference = { id: artifact.id, scope: artifact.scope }
    expect(() => f.data.artifacts.read(authority, { ...reference, scope: randomUUID() })).toThrow('same-company scope')
    const path = join(f.store.root, 'artifacts', artifact.hash)
    rmSync(path); writeFileSync(path, 'b')
    expect(() => f.data.artifacts.read(authority, reference)).toThrow('content hash')
    rmSync(path); symlinkSync('/etc/passwd', path)
    expect(() => f.data.artifacts.read(authority, reference)).toThrow()
    f.store.db.prepare('DELETE FROM artifact_permissions WHERE pod_id=?').run(f.first)
    expect(() => f.data.artifacts.read(authority, reference)).toThrow('bindings or configuration changed')
  })

  it('rejects artifact quota without publishing metadata or business outputs', () => {
    const f = fixture(); const authority = f.reserve()
    f.store.db.prepare('UPDATE data_settings SET limit_bytes=1 WHERE id=1').run()
    expect(() => f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'YQ==', mediaType: 'text/plain' })).toThrow('quota reached')
    expect(f.store.db.prepare('SELECT 1 FROM network_artifact_staging').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT 1 FROM artifacts').get()).toBeUndefined()
  })

  it('keeps interrupted staging until verified owner disposal, then collects only unreferenced bytes', async () => {
    const f = fixture(); const authority = f.reserve()
    const artifact = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'YQ==', mediaType: 'text/plain' })
    f.data.put(authority, { collection: 'cases', key: 'one', expectedRevision: 0, value: { status: 'uncommitted' } })
    await f.invocations.failClosed(authority, new Error('Synthetic interruption after staging'))
    f.data.artifacts.prune(Date.now() + 2 * 86400000)
    expect(f.store.db.prepare('SELECT 1 FROM network_artifact_staging').get()).toBeDefined()
    expect(existsSync(join(f.store.root, 'artifacts', artifact.hash))).toBe(true)
    const generation = Number(f.store.db.prepare('SELECT generation FROM network_invocations WHERE run_id=?').get(authority.runId)!.generation)
    const recovery = new NetworkRecovery(f.store, '/unused')
    await recovery.inspect(f.networkId, authority.runId, generation, () => {})
    recovery.discardFailure(f.networkId, authority.runId, generation, 'Synthetic explicit owner disposal', () => {})
    expect(f.store.db.prepare('SELECT 1 FROM network_artifact_staging').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT 1 FROM network_data_staging').get()).toBeUndefined()
    expect(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'staged-data-abandoned\'').get()!.body).toContain(artifact.hash)
    f.data.artifacts.prune(Date.now() + 2 * 86400000)
    expect(existsSync(join(f.store.root, 'artifacts', artifact.hash))).toBe(false)
  })

  it('does not starve orphan cleanup behind one hundred retained artifacts and removes stale private staging files', () => {
    const f = fixture(); const authority = f.reserve()
    f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: '', mediaType: 'text/plain' })
    const directory = join(f.store.root, 'artifacts')
    for (let index = 0; index < 100; index++) {
      const bytes = `Synthetic retained ${index}`; const hash = digest(bytes); const id = randomUUID()
      writeFileSync(join(directory, hash), bytes)
      f.store.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)').run(id, f.scopeId, hash, Buffer.byteLength(bytes), 'text/plain', `artifacts/${hash}`, Date.now())
      f.store.db.prepare('INSERT INTO artifact_references VALUES(?,\'definition\',?)').run(id, 'synthetic-retained-definition')
    }
    const orphan = join(directory, 'f'.repeat(64)); const temporary = join(directory, `.staging-${randomUUID()}`)
    writeFileSync(orphan, 'Unreferenced orphan'); writeFileSync(temporary, 'Unpublished temporary')
    const past = new Date(Date.now() - 2 * 86400000); utimesSync(orphan, past, past); utimesSync(temporary, past, past)
    f.data.artifacts.prune(); f.data.artifacts.prune()
    expect(existsSync(orphan)).toBe(false); expect(existsSync(temporary)).toBe(false)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get()!.count).toBe(100)
  })

  it('reports a maintenance filesystem failure while unrelated source work keeps progressing', async () => {
    const f = fixture(); const authority = f.reserve()
    f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: '', mediaType: 'text/plain' })
    await f.invocations.finish(authority, 'failed', 'Synthetic failed draft', 'No business commit', [], [])
    symlinkSync('/etc/passwd', join(f.store.root, 'artifacts', 'f'.repeat(64)))
    const prune = vi.spyOn(f.data.artifacts, 'prune')
    f.process(f.networkId, [f.second], [], 1)
    await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(f.second)?.state).toBe('completed')
    expect(f.store.db.prepare('SELECT 1 FROM network_trace_events WHERE kind=\'network-maintenance-failed\'').get()).toBeDefined()
    f.engine.tick(false)
    expect(prune).toHaveBeenCalledTimes(1)
  })

  it('keeps repeated and changing maintenance failures in a bounded status row', () => {
    const f = fixture(); const directory = join(f.store.root, 'artifacts')
    f.data.artifacts.create(f.reserve(), { scope: f.scopeId, bytesBase64: '', mediaType: 'text/plain' })
    const poison = join(directory, 'f'.repeat(64)); symlinkSync('/etc/passwd', poison)
    const start = Date.now(); const clock = vi.spyOn(Date, 'now')
    for (let attempt = 0; attempt < 10; attempt++) {
      clock.mockReturnValue(start + attempt * 60001)
      f.engine.tick(false)
    }
    expect(f.store.db.prepare('SELECT operation,failure_count FROM network_maintenance_status').all()).toEqual([{ operation: 'artifacts', failure_count: 10 }])
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_trace_events WHERE kind=\'network-maintenance-failed\'').get()!.count).toBe(1)
    rmSync(poison)
    clock.mockReturnValue(start + 10 * 60001); f.engine.tick(false)
    expect(f.store.db.prepare('SELECT body,failure_count FROM network_maintenance_status').get()).toEqual({ body: null, failure_count: 10 })
    symlinkSync('/etc/passwd', poison)
    clock.mockReturnValue(start + 11 * 60001); f.engine.tick(false)
    expect(f.store.db.prepare('SELECT failure_count FROM network_maintenance_status').get()!.failure_count).toBe(11)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_trace_events WHERE kind=\'network-maintenance-failed\'').get()!.count).toBe(1)
  })

  it('commits metadata removal before file cleanup failure and continues past a poisoned entry', async () => {
    const f = fixture(); const authority = f.reserve()
    const first = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'YQ==', mediaType: 'text/plain' })
    const second = f.data.artifacts.create(authority, { scope: f.scopeId, bytesBase64: 'Yg==', mediaType: 'text/plain' })
    await f.invocations.finish(authority, 'completed', 'Unreferenced artifact drafts published', null, [], [])
    const directory = join(f.store.root, 'artifacts')
    const poison = join(directory, '0'.repeat(64)); symlinkSync('/etc/passwd', poison)
    const now = Date.now() + 100 * 86400000
    expect(() => f.data.artifacts.prune(now)).toThrow('cleanup failed')
    expect(f.store.db.prepare('SELECT 1 FROM artifacts').get()).toBeUndefined()
    expect(existsSync(join(directory, first.hash))).toBe(false)
    expect(existsSync(join(directory, second.hash))).toBe(false)
    expect(existsSync(poison)).toBe(true)
  })
})
