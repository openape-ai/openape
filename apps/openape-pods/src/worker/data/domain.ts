import { assertRecordSchema, dataLimits, dataWriter, namespacePath, ownerWriter, parseRecordSchema, plainJson, recordKey, splitDataKey } from '../../contracts/domain-data'
import type { DataMode, RecordSchema } from '../../contracts/domain-data'
import { canonicalJson } from '../../contracts/canonical-json'
import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'

/** Who acts on shared data: a Pod in one of its runs, or the owner through an explicit command. */
export type DataPrincipal = { podId: string, runId: string } | typeof ownerWriter
export interface DataResultBinding { operation: string, ruleVersion: number, input: { key: string, revision: number, fingerprint: string }, workKey: string }
export interface DataEntryView {
  key: string
  revision: number
  value: unknown
  author: string
  updatedAt: number
  result?: DataResultBinding
}
export interface NamespaceView { path: string, writer: string, mode: DataMode, schema: RecordSchema | null, readers: string[], revision: number, writerEpoch: number, entries: number }
interface NamespaceRow { path: string, writer: string, mode: DataMode, schema: string | null, writer_epoch: number, revision: number }

export class DataConflict extends Error {
  constructor(readonly key: string, readonly currentRevision: number) { super(`Data record changed: ${key} is at revision ${currentRevision}`) }
}

const encoder = new TextEncoder()
const author = (principal: DataPrincipal) => principal === ownerWriter ? ownerWriter : principal.podId

export class DomainData {
  constructor(private readonly store: PodDatabase) {}

  private row(path: string): NamespaceRow {
    const row = this.store.db.prepare('SELECT * FROM data_namespaces WHERE path=?').get(namespacePath(path))
    if (!row) throw new Error(`Data namespace ${path} does not exist`)
    return row as unknown as NamespaceRow
  }

  namespace(path: string): NamespaceView {
    const row = this.row(path)
    const readers = this.store.db.prepare('SELECT pod_id FROM data_readers WHERE path=? ORDER BY pod_id').all(row.path).map(item => String(item.pod_id))
    const entries = Number(this.store.db.prepare('SELECT count(*) AS count FROM data_entries WHERE namespace=? AND deleted=0').get(row.path)!.count)
    return { path: row.path, writer: row.writer, mode: row.mode, schema: row.schema ? parseRecordSchema(JSON.parse(row.schema)) : null, readers, revision: row.revision, writerEpoch: row.writer_epoch, entries }
  }

  namespaces(): NamespaceView[] {
    return this.store.db.prepare('SELECT path FROM data_namespaces ORDER BY path').all().map(item => this.namespace(String(item.path)))
  }

  /** Owner command: creates a namespace with its writer and readers; nothing is ever inherited from a parent path. */
  define(input: { path: string, writer: string, mode: DataMode, schema?: unknown, readers?: string[] }): NamespaceView {
    const path = namespacePath(input.path); const writer = dataWriter(input.writer)
    if (!['records', 'results'].includes(input.mode)) throw new Error('Invalid namespace mode')
    if (input.mode === 'results' && writer === ownerWriter) throw new Error('Only a Pod writes results')
    const schema = input.schema === undefined || input.schema === null ? null : canonicalJson(parseRecordSchema(input.schema))
    this.store.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM data_namespaces WHERE path=? OR path LIKE ? OR ? LIKE path || \'/%\'').get(path, `${path}/%`, path)) throw new Error('A namespace may not contain or lie inside another namespace')
      if (writer !== ownerWriter) this.store.getPod(writer)
      const now = Date.now()
      this.store.db.prepare('INSERT INTO data_namespaces VALUES(?,?,?,?,1,1,?,?)').run(path, writer, input.mode, schema, now, now)
      for (const reader of input.readers ?? []) this.addReader(path, reader)
    })
    return this.namespace(path)
  }

  private addReader(path: string, podId: string): void {
    this.store.getPod(dataWriter(podId))
    this.store.db.prepare('INSERT OR IGNORE INTO data_readers VALUES(?,?)').run(path, podId)
  }

  /** Owner command: replaces the readers. Reading is an access rule; it never schedules anything. */
  setReaders(path: string, readers: string[], expectedRevision: number): NamespaceView {
    this.store.transaction(() => {
      const row = this.row(path)
      if (row.revision !== expectedRevision) throw new Error('Namespace changed; read it again')
      this.store.db.prepare('DELETE FROM data_readers WHERE path=?').run(row.path)
      for (const reader of readers) this.addReader(row.path, reader)
      this.store.db.prepare('UPDATE data_namespaces SET revision=revision+1,updated_at=? WHERE path=?').run(Date.now(), row.path)
    })
    return this.namespace(path)
  }

  /**
   * Owner command: transfers the writer without renaming data or changing readers. The old writer must hold no run
   * and no claimed work for this namespace, and the writer epoch fences anything it still tries to commit.
   */
  assignWriter(path: string, writer: string, expectedRevision: number): NamespaceView {
    const next = dataWriter(writer)
    this.store.transaction(() => {
      const row = this.row(path)
      if (row.revision !== expectedRevision) throw new Error('Namespace changed; read it again')
      if (row.mode === 'results' && next === ownerWriter) throw new Error('Only a Pod writes results')
      if (next !== ownerWriter) this.store.getPod(next)
      if (row.writer !== ownerWriter && this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(row.writer)) throw new Error('The current writer is running; wait until its run finished before replacing it')
      if (this.store.db.prepare('SELECT 1 FROM work_items i JOIN work_operations o ON o.operation=i.operation WHERE o.output=? AND i.state=\'claimed\' LIMIT 1').get(row.path)) throw new Error('Claimed work still writes this namespace; wait until it settles')
      this.store.db.prepare('UPDATE data_namespaces SET writer=?,writer_epoch=writer_epoch+1,revision=revision+1,updated_at=? WHERE path=?').run(next, Date.now(), row.path)
    })
    return this.namespace(path)
  }

  /** The registered namespace and record of a key; a key outside every namespace is refused. */
  resolve(key: string): { namespace: NamespaceRow, record: string } {
    const parts = splitDataKey(key)
    return { namespace: this.row(parts.namespace), record: parts.record }
  }

  canRead(principal: DataPrincipal, namespace: NamespaceRow): boolean {
    if (principal === ownerWriter) return true
    return namespace.writer === principal.podId || !!this.store.db.prepare('SELECT 1 FROM data_readers WHERE path=? AND pod_id=?').get(namespace.path, principal.podId)
  }

  private assertRead(principal: DataPrincipal, namespace: NamespaceRow): void {
    if (!this.canRead(principal, namespace)) throw new Error(`This Pod may not read ${namespace.path}`)
  }

  private view(row: Record<string, unknown>): DataEntryView {
    return {
      key: `${String(row.namespace)}/${String(row.key)}`,
      revision: Number(row.revision),
      value: JSON.parse(String(row.value)),
      author: String(row.author),
      updatedAt: Number(row.updated_at),
      ...(row.result ? { result: JSON.parse(String(row.result)) as DataResultBinding } : {}),
    }
  }

  get(principal: DataPrincipal, key: string): DataEntryView | null {
    const { namespace, record } = this.resolve(key)
    this.assertRead(principal, namespace)
    const row = this.store.db.prepare('SELECT * FROM data_entries WHERE namespace=? AND key=? AND deleted=0').get(namespace.path, record)
    return row ? this.view(row) : null
  }

  /** The stored revision of a key, also after deletion; 0 when it never existed. */
  revision(key: string): number {
    const { namespace, record } = this.resolve(key)
    return Number(this.store.db.prepare('SELECT revision FROM data_entries WHERE namespace=? AND key=?').get(namespace.path, record)?.revision ?? 0)
  }

  /** Entries of one namespace in ascending key order; `cursor` is the last key of the previous page. */
  list(principal: DataPrincipal, path: string, options: { cursor?: string | null, limit?: number } = {}): { entries: DataEntryView[], cursor: string | null } {
    const namespace = this.row(path)
    this.assertRead(principal, namespace)
    const limit = options.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > dataLimits.listEntries) throw new Error(`A data list returns 1 to ${dataLimits.listEntries} entries`)
    const after = options.cursor === undefined || options.cursor === null ? '' : recordKey(options.cursor)
    const rows = this.store.db.prepare('SELECT * FROM data_entries WHERE namespace=? AND deleted=0 AND key>? ORDER BY key LIMIT ?').all(namespace.path, after, limit + 1)
    const entries: DataEntryView[] = []; let bytes = 0
    for (const row of rows.slice(0, limit)) {
      const size = encoder.encode(String(row.value)).length + 512
      if (entries.length && bytes + size > dataLimits.listBytes) break
      entries.push(this.view(row)); bytes += size
    }
    return { entries, cursor: rows.length > entries.length ? String(rows[entries.length - 1]!.key) : null }
  }

  private assertWriter(principal: DataPrincipal, namespace: NamespaceRow): void {
    if (author(principal) !== namespace.writer) throw new Error(`Only the assigned writer may write ${namespace.path}`)
  }

  private encode(namespace: NamespaceRow, value: unknown): string {
    const clean = plainJson(value)
    if (namespace.schema) assertRecordSchema(clean, parseRecordSchema(JSON.parse(namespace.schema)))
    const body = canonicalJson(clean)
    if (encoder.encode(body).length > dataLimits.valueBytes) throw new Error(`A data value is limited to ${dataLimits.valueBytes} bytes`)
    return body
  }

  /** Ordinary writes go to record namespaces only; results come from work completion with their completion marker. */
  set(principal: DataPrincipal, key: string, value: unknown, expectedRevision: number, deleting = false): { revision: number } {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('A data write needs the expected revision (0 creates)')
    return this.store.transaction(() => {
      const { namespace, record } = this.resolve(key)
      this.assertWriter(principal, namespace)
      if (namespace.mode === 'results') throw new Error(`${namespace.path} holds results; complete the claimed work instead`)
      if (principal !== ownerWriter) this.assertRunning(principal)
      return this.write(namespace, record, deleting ? null : this.encode(namespace, value), expectedRevision, principal, null)
    })
  }

  /** The result entry of a completed work item; the caller holds the transaction and has verified the claim. */
  writeResult(principal: { podId: string, runId: string }, output: string, record: string, value: unknown, binding: DataResultBinding): { revision: number } {
    const namespace = this.row(output)
    this.assertWriter(principal, namespace)
    if (namespace.mode !== 'results') throw new Error(`${namespace.path} is not a results namespace`)
    const current = Number(this.store.db.prepare('SELECT revision FROM data_entries WHERE namespace=? AND key=?').get(namespace.path, recordKey(record))?.revision ?? 0)
    return this.write(namespace, record, this.encode(namespace, value), current, principal, binding)
  }

  private assertRunning(principal: { podId: string, runId: string }): void {
    if (!this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? AND run_id=? AND boot_id NOT LIKE \'fenced:%\'').get(principal.podId, principal.runId)) throw new Error('Data writes require the Pod\'s active run')
  }

  private write(namespace: NamespaceRow, record: string, body: string | null, expectedRevision: number, principal: DataPrincipal, binding: DataResultBinding | null): { revision: number } {
    const current = this.store.db.prepare('SELECT revision,deleted FROM data_entries WHERE namespace=? AND key=?').get(namespace.path, record)
    const revision = Number(current?.revision ?? 0)
    if (revision !== expectedRevision) throw new DataConflict(`${namespace.path}/${record}`, revision)
    if (body === null && (!current || current.deleted)) throw new Error('Cannot delete a missing data record')
    const sequence = Number(this.store.db.prepare('UPDATE data_sequence SET value=value+1 WHERE id=1 RETURNING value').get()!.value)
    const now = Date.now(); const next = revision + 1
    const hash = digest(body ?? 'deleted')
    const result = binding ? canonicalJson(binding) : null
    const runId = principal === ownerWriter ? null : principal.runId
    this.store.db.prepare(`INSERT INTO data_entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,sequence=excluded.sequence,value=excluded.value,
      deleted=excluded.deleted,digest=excluded.digest,author=excluded.author,run_id=excluded.run_id,writer_epoch=excluded.writer_epoch,result=excluded.result,updated_at=excluded.updated_at`)
      .run(namespace.path, record, next, sequence, body, body === null ? 1 : 0, hash, author(principal), runId, namespace.writer_epoch, result, now)
    this.store.db.prepare('INSERT INTO data_entry_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(namespace.path, record, next, body, body === null ? 1 : 0, hash, author(principal), runId, result, now)
    this.store.db.prepare('DELETE FROM data_entry_revisions WHERE namespace=? AND key=? AND revision<=?').run(namespace.path, record, next - dataLimits.history)
    return { revision: next }
  }
}
