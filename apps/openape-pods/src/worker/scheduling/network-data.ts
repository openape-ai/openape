import type { PodDatabase } from '../storage/database'
import type { NetworkAuthority, NetworkEvents } from './network-events'
import { artifactReferences, collectionContract, dataFields, dataKey, dataRevision, queryScalar } from '../../contracts/network-data'
import { validateNetworkPayload } from '../../contracts/network-payload'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { networkDataPin } from './network-config'
import { assertNetworkQuota } from './network-quota'
import { NetworkArtifacts } from './network-artifacts'

export class NetworkRecordConflict extends Error {
  constructor(readonly collection: string, readonly key: string, readonly currentRevision: number) {
    super(`Collection record changed: ${collection}/${key}, current revision ${currentRevision}`)
  }
}

export class NetworkData {
  readonly artifacts: NetworkArtifacts
  constructor(private readonly store: PodDatabase, private readonly events: NetworkEvents) {
    this.artifacts = new NetworkArtifacts(store, (authority, finishing) => this.authority(authority, finishing))
  }

  authority(authority: NetworkAuthority, finishing = false) {
    const scope = this.events.authority(authority, finishing)
    if (scope.row.execution_kind !== 'script') throw new Error('Shared data requires a script invocation')
    const pin = JSON.parse(scope.row.manifest as string).dataPin
    if (!pin || pin !== networkDataPin(this.store, scope.definition.id, scope.member.podId)) throw new Error('Network data bindings or configuration changed during execution')
    return scope
  }

  private collection(authority: NetworkAuthority, collection: unknown, operation: 'read' | 'write' | 'delete', finishing = false) {
    const scope = this.authority(authority, finishing)
    const name = dataKey(collection)
    const row = this.store.db.prepare(`SELECT c.*,v.schema,v.indexes FROM data_collections c
      JOIN data_collection_versions v ON v.collection_id=c.id AND v.version=c.current_version
      JOIN data_permissions p ON p.collection_id=c.id AND p.owner_issuer=c.owner_issuer AND p.owner_subject=c.owner_subject AND p.group_id=c.group_id
      WHERE ${/^[a-f0-9-]{36}$/.test(name) ? 'c.id' : 'c.name'}=? AND p.network_id=? AND p.pod_id=? AND p.operation=?
      AND c.owner_issuer=? AND c.owner_subject=? AND c.group_id=?`).get(name, scope.definition.id, scope.member.podId, operation, scope.row.owner_issuer!, scope.row.owner_subject!, scope.row.group_id!)
    if (!row) throw new Error('Collection operation requires an explicit same-company binding')
    return { scope, row, contract: collectionContract(JSON.parse(row.schema as string), JSON.parse(row.indexes as string)) }
  }

  get(authority: NetworkAuthority, value: unknown) {
    return this.store.transaction(() => {
      const input = dataFields(value, ['collection', 'key'], ['includeDeleted'])
      if (input.includeDeleted !== undefined && typeof input.includeDeleted !== 'boolean') throw new Error('Invalid deleted-record view')
      const { row } = this.collection(authority, input.collection, 'read')
      const record = this.record(authority.runId, row.id as string, dataKey(input.key), input.includeDeleted === true)
      if (record && Buffer.byteLength(canonicalNetworkJson(record)) > 192 * 1024) throw new Error('Collection record exceeds the bounded response limit')
      return record
    })
  }

  private record(runId: string, collectionId: string, key: string, includeDeleted = false) {
    const staged = this.store.db.prepare('SELECT * FROM network_data_staging WHERE run_id=? AND collection_id=? AND record_key=? ORDER BY revision DESC LIMIT 1').get(runId, collectionId, key)
    if (staged) {
      if (staged.tombstone && !includeDeleted) return null
      return { key, revision: Number(staged.revision), deleted: Boolean(staged.tombstone), value: staged.body === null ? null : JSON.parse(staged.body as string), artifacts: JSON.parse(staged.artifact_refs as string), provenance: { invocationId: runId, verification: 'proposed', staged: true } }
    }
    const current = this.store.db.prepare(`SELECT v.*,p.pod_id,p.source_refs,p.verification FROM data_records r
      JOIN data_record_revisions v ON v.collection_id=r.collection_id AND v.record_key=r.record_key AND v.revision=r.revision
      LEFT JOIN data_record_provenance p ON p.collection_id=v.collection_id AND p.record_key=v.record_key AND p.revision=v.revision
      WHERE r.collection_id=? AND r.record_key=?`).get(collectionId, key)
    if (!current || (current.tombstone && !includeDeleted)) return null
    const references = this.store.db.prepare(`SELECT a.id,a.scope_id AS scope FROM artifact_references ref JOIN artifacts a ON a.id=ref.artifact_id WHERE ref.reference_kind='record' AND ref.reference_id=? ORDER BY a.id`).all(canonicalNetworkJson([collectionId, key, current.revision]))
    return { key, revision: Number(current.revision), deleted: Boolean(current.tombstone), value: current.body === null ? null : JSON.parse(current.body as string), artifacts: references, provenance: { podId: current.pod_id, definitionId: current.definition_id, definitionVersion: current.definition_version, invocationId: current.author_run_id, sources: current.source_refs ? JSON.parse(current.source_refs as string) : [], at: current.created_at, revision: current.revision, verification: current.verification ?? 'proposed', staged: false } }
  }

  put(authority: NetworkAuthority, value: unknown, deleting = false): { revision: number } {
    const input = dataFields(value, ['collection', 'key', 'expectedRevision', ...(deleting ? [] : ['value'])], deleting ? [] : ['artifacts'])
    return this.store.transaction(() => {
      const { row, contract } = this.collection(authority, input.collection, deleting ? 'delete' : 'write')
      const key = dataKey(input.key); const expected = dataRevision(input.expectedRevision)
      const staged = this.store.db.prepare('SELECT revision FROM network_data_staging WHERE run_id=? AND collection_id=? AND record_key=? ORDER BY revision DESC LIMIT 1').get(authority.runId, row.id!, key)
      const current = staged?.revision ?? this.store.db.prepare('SELECT revision FROM data_records WHERE collection_id=? AND record_key=?').get(row.id!, key)?.revision ?? 0
      if (Number(current) !== expected) throw new NetworkRecordConflict(row.name as string, key, Number(current))
      if (deleting && !current) throw new Error('Cannot delete a missing collection record')
      if (deleting) this.assertDeletionResolved(row.id as string, key)
      const body = deleting ? null : canonicalNetworkJson(validateNetworkPayload(input.value, contract.schema))
      const references = deleting ? [] : artifactReferences(input.artifacts ?? [])
      for (const reference of references) this.artifacts.reference(authority, reference)
      if (Number(this.store.db.prepare('SELECT count(*) AS count FROM network_data_staging WHERE run_id=?').get(authority.runId)!.count) >= 100) throw new Error('Network invocation exceeds 100 staged record writes')
      assertNetworkQuota(this.store, 8192 + Buffer.byteLength(body ?? ''))
      this.store.db.prepare('INSERT INTO network_data_staging VALUES(?,?,?,?,?,?,?,?,?)').run(authority.runId, row.id!, key, expected, expected + 1, row.current_version!, body, deleting ? 1 : 0, canonicalNetworkJson(references))
      return { revision: expected + 1 }
    })
  }

  query(authority: NetworkAuthority, value: unknown) {
    return this.store.transaction(() => {
      const input = dataFields(value, ['collection', 'index', 'operator', 'value', 'limit'], ['cursor'])
      const { row, contract } = this.collection(authority, input.collection, 'read')
      const index = contract.indexes.find(item => item.name === input.index)
      if (!index || !['eq', 'lt', 'lte', 'gt', 'gte'].includes(input.operator as string) || !Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 100) throw new Error('Collection query requires a declared index and limit 1–100')
      const scalar = queryScalar(input.value)
      if (input.operator !== 'eq' && typeof scalar !== 'string' && typeof scalar !== 'number') throw new Error('Collection range query requires a string or number')
      validateNetworkPayload({ [index.field]: scalar }, { ...contract.schema, required: [index.field] })
      const cursor = input.cursor === undefined || input.cursor === null ? '' : dataKey(input.cursor)
      const operator = { eq: '=', lt: '<', lte: '<=', gt: '>', gte: '>=' }[input.operator as 'eq']!
      const type = scalar === null ? 'null' : typeof scalar
      const column = typeof scalar === 'number' || typeof scalar === 'boolean' ? 'value_number' : 'value_text'
      const parameter = typeof scalar === 'boolean' ? Number(scalar) : scalar
      const keys = this.store.db.prepare(`SELECT x.record_key FROM data_index_values x WHERE x.collection_id=? AND x.schema_version=? AND x.index_name=? AND x.value_type=? AND x.${column} ${scalar === null ? 'IS NULL' : `${operator} ?`} AND x.record_key>?
        AND NOT EXISTS(SELECT 1 FROM network_data_staging s WHERE s.run_id=? AND s.collection_id=x.collection_id AND s.record_key=x.record_key)
        ORDER BY x.record_key LIMIT ?`).all(row.id!, row.current_version!, index.name, type, ...(scalar === null ? [] : [parameter]), cursor, authority.runId, Number(input.limit) + 1).map(item => item.record_key as string)
      const staged = this.store.db.prepare(`SELECT s.record_key,s.body,s.tombstone FROM network_data_staging s WHERE s.run_id=? AND s.collection_id=? AND s.record_key>?
        AND s.revision=(SELECT max(latest.revision) FROM network_data_staging latest WHERE latest.run_id=s.run_id AND latest.collection_id=s.collection_id AND latest.record_key=s.record_key)`).all(authority.runId, row.id!, cursor)
      for (const item of staged) {
        if (item.tombstone) continue
        const candidate = JSON.parse(item.body as string)[index.field]
        const comparison = typeof candidate === 'string' && typeof scalar === 'string' ? Buffer.compare(Buffer.from(candidate), Buffer.from(scalar)) : candidate < scalar! ? -1 : candidate > scalar! ? 1 : 0
        const matches = input.operator === 'eq' ? candidate === scalar : typeof candidate === typeof scalar && (input.operator === 'lt' ? comparison < 0 : input.operator === 'lte' ? comparison <= 0 : input.operator === 'gt' ? comparison > 0 : comparison >= 0)
        if (matches) keys.push(item.record_key as string)
      }
      keys.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      const records = []; let bytes = 0
      for (const key of keys.slice(0, Number(input.limit))) {
        const record = this.record(authority.runId, row.id as string, key)!
        const size = Buffer.byteLength(canonicalNetworkJson(record)) + 2
        if (size > 192 * 1024) throw new Error('Collection record exceeds the bounded response limit')
        if (bytes + size > 192 * 1024) break
        records.push(record); bytes += size
      }
      return { records, cursor: keys.length > records.length ? records.at(-1)!.key : null }
    })
  }

  commit(authority: NetworkAuthority): void {
    const writes = this.store.db.prepare('SELECT * FROM network_data_staging WHERE run_id=? ORDER BY collection_id,record_key,revision').all(authority.runId)
    if (!writes.length && !this.store.db.prepare('SELECT 1 FROM network_artifact_staging WHERE run_id=?').get(authority.runId)) return
    const scope = this.authority(authority, true)
    assertNetworkQuota(this.store, writes.length * 16384 + Number(this.store.db.prepare('SELECT count(*) AS count FROM network_artifact_staging WHERE run_id=?').get(authority.runId)!.count) * 4096)
    this.artifacts.commit(authority)
    const sources = this.store.db.prepare('SELECT event_id FROM network_deliveries WHERE run_id=? AND state=\'claimed\' ORDER BY event_id').all(authority.runId).map(item => item.event_id)
    for (const write of writes) {
      const { row, contract } = this.collection(authority, write.collection_id, write.tombstone ? 'delete' : 'write', true)
      const current = Number(this.store.db.prepare('SELECT revision FROM data_records WHERE collection_id=? AND record_key=?').get(row.id!, write.record_key!)?.revision ?? 0)
      if (current !== write.base_revision) throw new NetworkRecordConflict(row.name as string, write.record_key as string, current)
      if (write.tombstone) this.assertDeletionResolved(row.id as string, write.record_key as string, authority.runId)
      const references = artifactReferences(JSON.parse(write.artifact_refs as string))
      for (const reference of references) this.artifacts.reference(authority, reference, true)
      if (write.schema_version !== row.current_version) throw new Error('Collection schema changed before settlement')
      if (write.body !== null) validateNetworkPayload(JSON.parse(write.body as string), contract.schema)
      this.store.db.prepare('INSERT INTO data_records VALUES(?,?,?,?) ON CONFLICT(collection_id,record_key) DO UPDATE SET revision=excluded.revision,tombstone=excluded.tombstone').run(row.id!, write.record_key!, write.revision!, write.tombstone!)
      this.store.db.prepare('INSERT INTO data_record_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.id!, write.record_key!, write.revision!, row.current_version!, authority.runId, scope.member.definitionId, scope.member.definitionVersion, write.body!, write.tombstone!, Date.now())
      this.store.db.prepare('INSERT INTO data_record_provenance(collection_id,record_key,revision,pod_id,source_refs) VALUES(?,?,?,?,?)').run(row.id!, write.record_key!, write.revision!, scope.member.podId, canonicalNetworkJson(sources))
      this.store.db.prepare('DELETE FROM data_index_values WHERE collection_id=? AND record_key=?').run(row.id!, write.record_key!)
      if (!write.tombstone) {
        const body = JSON.parse(write.body as string)
        for (const index of contract.indexes) {
          if (!Object.hasOwn(body, index.field)) continue
          const scalar = queryScalar(body[index.field]); const type = scalar === null ? 'null' : typeof scalar
          this.store.db.prepare('INSERT INTO data_index_values VALUES(?,?,?,?,?,?,?)').run(row.id!, row.current_version!, index.name, write.record_key!, type, typeof scalar === 'string' ? scalar : null, typeof scalar === 'number' ? scalar : typeof scalar === 'boolean' ? Number(scalar) : null)
        }
      }
      for (const reference of references) this.artifacts.retain(reference, 'record', canonicalNetworkJson([row.id, write.record_key, write.revision]))
    }
  }

  clear(runId: string): void {
    this.store.db.prepare('DELETE FROM network_data_staging WHERE run_id=?').run(runId)
    this.store.db.prepare('DELETE FROM network_artifact_staging WHERE run_id=?').run(runId)
  }

  private assertDeletionResolved(collectionId: string, key: string, stagedAuthor = ''): void {
    if (this.store.db.prepare(`SELECT 1 FROM data_record_revisions r JOIN network_deliveries d ON d.run_id=r.author_run_id WHERE r.collection_id=? AND r.record_key=? AND r.author_run_id!=? AND d.state NOT IN ('done','discarded')
      UNION ALL SELECT 1 FROM data_record_revisions r JOIN network_events e ON json_extract(e.origin,'$.invocationId')=r.author_run_id JOIN network_deliveries d ON d.event_id=e.id WHERE r.collection_id=? AND r.record_key=? AND r.author_run_id!=? AND d.state NOT IN ('done','discarded')
      UNION ALL SELECT 1 FROM data_record_revisions r JOIN network_invocations i ON i.run_id=r.author_run_id JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE r.collection_id=? AND r.record_key=? AND r.author_run_id!=? AND (i.state IN ('running','stopping','interrupted','unknown') OR c.review_required=1) LIMIT 1`).get(collectionId, key, stagedAuthor, collectionId, key, stagedAuthor, collectionId, key, stagedAuthor)) {
      throw new Error('Deleting unresolved collection data requires owner review')
    }
  }
}
