import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Owner } from '@openape/pods-protocol'
import { ProtocolError } from '@openape/pods-protocol'
import { centralId, centralLeaseMs, centralMaxBytes, centralRevision, commandPodIds, parseCentralCommand, parseCentralSnapshot, parseRuntimeCentralCommand } from '../../../openape-pods/src/contracts/central'
import type { CentralCommand, CentralOperation, CentralPod, CentralRuntime, CentralSnapshot } from '../../../openape-pods/src/contracts/central'
import { assemblePod, assembleSnapshot, centralFormat, encodeParts, manifestDigest, parsePartKey, partHash, podRuns, splitSnapshot, validateManifest, validatePart } from '../../../openape-pods/src/contracts/central-parts'
import type { CentralManifest } from '../../../openape-pods/src/contracts/central-parts'
import type { WorkspaceState } from '../../../openape-pods/src/contracts/control'
import type { RunEvent, RunRecord } from '../../../openape-pods/src/contracts/runs'
import type { ScheduleView } from '../../../openape-pods/src/contracts/scheduling'
import type { ScriptView } from '../../../openape-pods/src/contracts/scripts'

export interface WorkspaceActor { id: string, generation: string, owner: Owner }
interface RuntimeRow { id: string, owner: string, generation: string, lease: string, heartbeat: number, revision: number, hash: string, snapshot: string | null, previous_hash: string, seen_at: number, parts_hash: string }
interface Completion { id: string, result: unknown, error: string | null }
interface PodView { id: string, ready: boolean, scheduling: ScheduleView, runs: { runIds: string[] } }
export type WorkspaceView = { view: 'summary' } | { view: 'runs', offset: number } | { view: 'run', runId: string } | { view: 'version', selection: string }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const ownerKey = (owner: Owner) => JSON.stringify([owner.issuer, owner.subject])
const stagedLimit = 256 * 1024 * 1024
export const runPage = 20

export class WorkspaceStore {
  readonly db: DatabaseSync
  constructor(path: string, readonly now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 1) { this.db.close(); throw new Error('Workspace database requires a newer server') }
    // Additive only, so an older server can still open this database after a rollback.
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runtimes(id TEXT PRIMARY KEY,owner TEXT NOT NULL,generation TEXT NOT NULL,lease TEXT NOT NULL,heartbeat INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,hash TEXT NOT NULL DEFAULT '',snapshot TEXT);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,runtime_id TEXT NOT NULL REFERENCES runtimes(id),request_hash TEXT NOT NULL,command TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT,revision INTEGER NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,runtime_id TEXT NOT NULL REFERENCES runtimes(id),hash TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,runtime_id TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(runtime_id TEXT NOT NULL REFERENCES runtimes(id),pod_id TEXT NOT NULL,hash TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(runtime_id,pod_id,hash));
      CREATE TABLE IF NOT EXISTS parts(runtime_id TEXT NOT NULL REFERENCES runtimes(id),key TEXT NOT NULL,hash TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(runtime_id,key));
      CREATE TABLE IF NOT EXISTS staged_parts(runtime_id TEXT NOT NULL REFERENCES runtimes(id),hash TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(runtime_id,hash));
      CREATE INDEX IF NOT EXISTS owner_changes ON changes(owner,sequence);
      PRAGMA user_version=1;`)
    const columns = new Set(this.db.prepare('PRAGMA table_info(runtimes)').all().map(column => String(column.name)))
    for (const [name, definition] of [['previous_hash', 'TEXT NOT NULL DEFAULT \'\''], ['seen_at', 'INTEGER NOT NULL DEFAULT 0'], ['parts_hash', 'TEXT NOT NULL DEFAULT \'\'']]) {
      if (!columns.has(name!)) this.db.exec(`ALTER TABLE runtimes ADD COLUMN ${name} ${definition}`)
    }
    // Snapshots written by an older server (or before this upgrade) are split once.
    for (const raw of this.db.prepare('SELECT * FROM runtimes WHERE snapshot IS NOT NULL AND parts_hash!=hash').all()) {
      const row = raw as unknown as RuntimeRow
      this.transaction(() => this.storeSnapshot(row.id, JSON.parse(row.snapshot!) as CentralSnapshot, row.hash))
    }
  }

  close(): void { this.db.close() }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = run(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  private changed(row: Pick<RuntimeRow, 'id' | 'owner'>): void {
    this.db.prepare('INSERT INTO changes(owner,runtime_id,at) VALUES(?,?,?)').run(row.owner, row.id, this.now())
  }

  private row(owner: Owner, id: string): RuntimeRow {
    const row = this.db.prepare('SELECT * FROM runtimes WHERE id=? AND owner=?').get(centralId(id), ownerKey(owner)) as unknown as RuntimeRow | undefined
    if (!row) throw new ProtocolError('workspace_not_found', 404)
    return row
  }

  private hasData(row: RuntimeRow): boolean { return row.hash !== '' && row.parts_hash === row.hash }
  private manifest(runtimeId: string): CentralManifest {
    return Object.fromEntries(this.db.prepare('SELECT key,hash FROM parts WHERE runtime_id=?').all(runtimeId).map(item => [String(item.key), String(item.hash)]))
  }

  private reader(runtimeId: string): (key: string) => unknown {
    const statement = this.db.prepare('SELECT value FROM parts WHERE runtime_id=? AND key=?')
    return (key) => {
      const value = statement.get(runtimeId, key)?.value
      if (typeof value !== 'string') throw new Error('Committed workspace part is missing')
      return JSON.parse(value)
    }
  }

  // Applies a complete part set by diffing hashes, so unchanged rows are not rewritten.
  private storeSnapshot(runtimeId: string, snapshot: CentralSnapshot, hash: string): void {
    const current = this.manifest(runtimeId)
    const next = encodeParts(splitSnapshot(snapshot))
    for (const key of Object.keys(current)) {
      if (!next.has(key)) this.db.prepare('DELETE FROM parts WHERE runtime_id=? AND key=?').run(runtimeId, key)
    }
    const upsert = this.db.prepare('INSERT INTO parts VALUES(?,?,?,?) ON CONFLICT(runtime_id,key) DO UPDATE SET hash=excluded.hash,value=excluded.value')
    for (const [key, part] of next) {
      if (current[key] !== part.hash) upsert.run(runtimeId, key, part.hash, part.text)
    }
    this.db.prepare('UPDATE runtimes SET parts_hash=? WHERE id=?').run(hash, runtimeId)
  }

  private online(row: RuntimeRow): boolean { return row.heartbeat > 0 && row.heartbeat + centralLeaseMs > this.now() }
  private ready(owner: Owner, id: string, podIds: string[] = []): RuntimeRow {
    const row = this.row(owner, id)
    if (!this.online(row) || !this.hasData(row)) throw new ProtocolError('pod_offline', 409)
    const read = this.reader(row.id)
    const workspace = read('workspace') as WorkspaceState
    for (const podId of podIds) {
      if (!workspace.pods.some(pod => pod.id === podId)) throw new ProtocolError('pod_not_found', 404)
      if (!(read(`pod/${podId}`) as PodView).ready) throw new ProtocolError('pod_offline', 409)
    }
    return row
  }

  private scope(row: RuntimeRow): CentralSnapshot { return { workspace: this.reader(row.id)('workspace') } as CentralSnapshot }

  private runtime(actor: WorkspaceActor, lease: string): RuntimeRow {
    const row = this.row(actor.owner, actor.id)
    if (row.generation !== actor.generation || row.lease !== lease) throw new ProtocolError('stale_workspace_runtime', 409)
    return row
  }

  assertLease(actor: WorkspaceActor, lease: string): void { this.runtime(actor, lease) }

  begin(actor: WorkspaceActor): { lease: string, revision: number, hash: string, pending: CentralOperation[], format: number, runtimeId: string, manifest: CentralManifest } {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM runtimes WHERE id=?').get(actor.id) as unknown as RuntimeRow | undefined
      if (previous && (previous.owner !== ownerKey(actor.owner) || previous.generation !== actor.generation)) throw new ProtocolError('workspace_binding_changed', 409)
      if (previous && this.online(previous)) throw new ProtocolError('workspace_already_connected', 409)
      const lease = randomUUID()
      this.db.prepare('INSERT INTO runtimes(id,owner,generation,lease) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,heartbeat=0').run(actor.id, ownerKey(actor.owner), actor.generation, lease)
      this.db.prepare('UPDATE operations SET state=\'unknown\',error=\'Runtime disconnected; reconcile before retrying\' WHERE runtime_id=? AND state=\'started\'').run(actor.id)
      this.db.prepare('UPDATE operations SET state=\'failed\',error=\'Pod went offline before execution\' WHERE runtime_id=? AND state=\'accepted\'').run(actor.id)
      this.db.prepare('DELETE FROM staged_parts WHERE runtime_id=?').run(actor.id)
      const row = this.row(actor.owner, actor.id); this.changed(row)
      const pending = this.db.prepare('SELECT id FROM operations WHERE runtime_id=? AND state=\'unknown\'').all(actor.id).map(item => this.operation(actor.owner, String(item.id)))
      return { lease, revision: row.revision, hash: row.hash, pending, format: centralFormat, runtimeId: row.id, manifest: this.hasData(row) ? this.manifest(row.id) : {} }
    })
  }

  // Accepts the previous hash too: a heartbeat can race the publication that replaced it.
  heartbeat(actor: WorkspaceActor, lease: string, hash: string): void {
    const row = this.runtime(actor, lease)
    if (this.db.prepare('SELECT 1 FROM operations WHERE runtime_id=? AND state=\'unknown\'').get(row.id)) throw new ProtocolError('workspace_operation_unresolved', 409)
    if (!this.hasData(row) || (row.hash !== hash && row.previous_hash !== hash)) throw new ProtocolError('workspace_reconciliation_required', 409)
    const previouslyOnline = this.online(row)
    this.db.prepare('UPDATE runtimes SET heartbeat=?,seen_at=? WHERE id=?').run(this.now(), this.now(), row.id)
    if (!previouslyOnline) this.changed(row)
  }

  disconnect(actor: WorkspaceActor, lease: string): void {
    const row = this.runtime(actor, lease)
    this.db.prepare('UPDATE runtimes SET heartbeat=0 WHERE id=?').run(row.id); this.changed(row)
  }

  private begunPublication(row: RuntimeRow, id: string, expected: number, requestHash: string, completion?: Completion): { revision: number } | null {
    const prior = this.db.prepare('SELECT * FROM publications WHERE id=?').get(id)
    if (prior) {
      if (prior.runtime_id !== row.id || prior.hash !== requestHash) throw new ProtocolError('publication_conflict', 409)
      return { revision: Number(prior.revision) }
    }
    if (row.revision !== expected) throw new ProtocolError('workspace_revision_conflict', 409)
    const other = this.db.prepare('SELECT id FROM operations WHERE runtime_id=? AND state IN (\'started\',\'unknown\') AND id!=?').get(row.id, completion?.id ?? '')
    if (other) throw new ProtocolError('workspace_operation_unresolved', 409)
    return null
  }

  private commitPublication(actor: WorkspaceActor, row: RuntimeRow, id: string, hash: string, requestHash: string, snapshot: string | null, completion?: Completion): { revision: number, hash: string } {
    const artifacts = this.reader(row.id)('artifacts') as CentralSnapshot['artifacts']
    for (const file of artifacts) {
      const stored = this.db.prepare('SELECT length(content) AS size FROM artifacts WHERE runtime_id=? AND pod_id=? AND hash=?').get(row.id, file.podId, file.hash)
      if (!stored || stored.size !== file.size) throw new ProtocolError('workspace_artifact_missing', 409)
    }
    if (row.hash !== hash) this.db.prepare('UPDATE runtimes SET snapshot=?,previous_hash=hash,hash=?,parts_hash=?,revision=revision+1 WHERE id=?').run(snapshot, hash, hash, row.id)
    else this.db.prepare('UPDATE runtimes SET parts_hash=? WHERE id=?').run(hash, row.id)
    const revision = this.row(actor.owner, actor.id).revision
    if (completion) {
      const result = JSON.stringify(completion.result)
      if (Buffer.byteLength(result) > centralMaxBytes) throw new ProtocolError('workspace_result_too_large', 413)
      const operation = this.operation(actor.owner, centralId(completion.id))
      if (operation.runtimeId !== row.id || !['started', 'unknown'].includes(operation.state)) throw new ProtocolError('workspace_operation_conflict', 409)
      this.db.prepare('UPDATE operations SET state=?,result=?,error=?,revision=? WHERE id=?').run(completion.error ? 'failed' : 'applied', result, completion.error, revision, operation.id)
    }
    this.db.prepare('INSERT INTO publications VALUES(?,?,?,?)').run(id, row.id, requestHash, revision)
    this.db.prepare('DELETE FROM staged_parts WHERE runtime_id=?').run(row.id)
    if (row.hash !== hash || completion) this.changed(row)
    return { revision, hash }
  }

  // Format 1: a complete snapshot from a desktop that predates format 2.
  publish(actor: WorkspaceActor, lease: string, id: string, expected: number, value: unknown, completion?: Completion): { revision: number, hash: string } {
    centralId(id); centralRevision(expected)
    const snapshot = parseCentralSnapshot(value)
    const encoded = JSON.stringify(snapshot)
    if (Buffer.byteLength(encoded) > centralMaxBytes) throw new ProtocolError('workspace_too_large', 413)
    const hash = digest(encoded)
    const requestHash = digest(JSON.stringify([expected, hash, completion ?? null]))
    return this.transaction(() => {
      const row = this.runtime(actor, lease)
      const prior = this.begunPublication(row, id, expected, requestHash, completion)
      if (prior) return { revision: prior.revision, hash }
      this.storeSnapshot(row.id, snapshot, hash)
      // An older server reads this column, so format 1 keeps it current for rollback.
      return this.commitPublication(actor, row, id, hash, requestHash, encoded, completion)
    })
  }

  stage(actor: WorkspaceActor, lease: string, parts: Record<string, unknown>): void {
    const row = this.runtime(actor, lease)
    const entries = Object.entries(parts).map(([hash, value]) => {
      const text = JSON.stringify(value)
      if (!/^[a-f0-9]{64}$/.test(hash) || partHash(text) !== hash) throw new ProtocolError('part_hash_mismatch')
      if (Buffer.byteLength(text) > centralMaxBytes) throw new ProtocolError('workspace_too_large', 413)
      return [hash, text] as const
    })
    this.transaction(() => {
      const size = Number(this.db.prepare('SELECT coalesce(sum(length(value)),0) AS size FROM staged_parts WHERE runtime_id=?').get(row.id)!.size)
      if (size + entries.reduce((total, [, text]) => total + Buffer.byteLength(text), 0) > stagedLimit) throw new ProtocolError('workspace_too_large', 413)
      const insert = this.db.prepare('INSERT OR IGNORE INTO staged_parts VALUES(?,?,?)')
      for (const [hash, text] of entries) insert.run(row.id, hash, text)
    })
  }

  // Format 2: applies a manifest delta whose parts were staged or are already committed.
  publishParts(actor: WorkspaceActor, lease: string, id: string, expected: number, changes: Record<string, string | null>, hash: string, completion?: Completion): { revision: number, hash: string } {
    centralId(id); centralRevision(expected)
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ProtocolError('invalid_workspace_request')
    const entries = Object.entries(changes)
    if (entries.length > 300000) throw new ProtocolError('workspace_too_large', 413)
    for (const [key, value] of entries) { parsePartKey(key); if (value !== null && !/^[a-f0-9]{64}$/.test(value)) throw new ProtocolError('invalid_workspace_request') }
    const requestHash = digest(JSON.stringify([expected, hash, completion ?? null]))
    return this.transaction(() => {
      const row = this.runtime(actor, lease)
      const prior = this.begunPublication(row, id, expected, requestHash, completion)
      if (prior) return { revision: prior.revision, hash }
      const current = this.manifest(row.id)
      const staged = this.db.prepare('SELECT value FROM staged_parts WHERE runtime_id=? AND hash=?')
      const committed = this.db.prepare('SELECT value FROM parts WHERE runtime_id=? AND hash=? LIMIT 1')
      const upsert = this.db.prepare('INSERT INTO parts VALUES(?,?,?,?) ON CONFLICT(runtime_id,key) DO UPDATE SET hash=excluded.hash,value=excluded.value')
      for (const [key, partHashValue] of entries) {
        if (partHashValue === null) { this.db.prepare('DELETE FROM parts WHERE runtime_id=? AND key=?').run(row.id, key); continue }
        if (current[key] === partHashValue) continue
        const text = (staged.get(row.id, partHashValue) ?? committed.get(row.id, partHashValue))?.value
        if (typeof text !== 'string') throw new ProtocolError('workspace_part_missing', 409)
        validatePart(key, JSON.parse(text))
        upsert.run(row.id, key, partHashValue, text)
      }
      if (manifestDigest(this.manifest(row.id)) !== hash) throw new ProtocolError('workspace_manifest_mismatch', 409)
      validateManifest(Object.keys(this.manifest(row.id)), this.reader(row.id))
      return this.commitPublication(actor, row, id, hash, requestHash, null, completion)
    })
  }

  inventory(owner: Owner): CentralRuntime[] {
    return this.db.prepare('SELECT * FROM runtimes WHERE owner=? ORDER BY id').all(ownerKey(owner)).map((raw) => {
      const row = raw as unknown as RuntimeRow
      const online = this.online(row)
      const lastSeenAt = row.seen_at || null
      if (!this.hasData(row)) return { id: row.id, revision: row.revision, online, lastSeenAt, workspace: { pods: [], organization: { revision: 1, groups: [] } } }
      const read = this.reader(row.id)
      const workspace = read('workspace') as WorkspaceState
      return { id: row.id, revision: row.revision, online, lastSeenAt, workspace: { ...workspace, pods: workspace.pods.map((pod) => {
        const view = read(`pod/${pod.id}`) as PodView
        if (!online || !view.ready) return { id: pod.id, name: pod.name, online: false, revision: 1, lifecycle: pod.lifecycle === 'archived' ? 'archived' as const : 'paused' as const, activeScript: null }
        const { blocked, blockedSince = null, error } = view.scheduling
        return { ...pod, online: true, queue: { blocked, since: blockedSince, error: blocked ? error : null } }
      }) } }
    })
  }

  read(owner: Owner, runtimeId: string, podId: string): { revision: number, pod: CentralPod } {
    const row = this.ready(owner, runtimeId, [centralId(podId)])
    const read = this.reader(row.id)
    return { revision: row.revision, pod: assemblePod(read, Object.keys(this.manifest(row.id)), podId) }
  }

  // Small reads for format-2 clients; `read` stays the complete legacy Pod.
  view(owner: Owner, runtimeId: string, podId: string, query: WorkspaceView): unknown {
    const row = this.ready(owner, runtimeId, [centralId(podId)])
    const read = this.reader(row.id)
    const pod = read(`pod/${podId}`) as PodView & Record<string, unknown>
    const runIds = pod.runs.runIds
    if (query.view === 'summary') {
      const { runIds: _runIds, ...runs } = pod.runs
      return { revision: row.revision, total: runIds.length, pod: { ...pod, runs: { ...runs, runs: podRuns(read, podId, runIds.slice(0, runPage)), events: [] }, versions: {}, history: {} } }
    }
    if (query.view === 'runs') return { revision: row.revision, total: runIds.length, runs: podRuns(read, podId, runIds.slice(query.offset, query.offset + runPage)) }
    if (query.view === 'run') {
      if (!runIds.includes(centralId(query.runId))) throw new ProtocolError('run_not_found', 404)
      return { revision: row.revision, run: read(`pod/${podId}/run/${query.runId}`) as RunRecord, events: read(`pod/${podId}/events/${query.runId}`) as RunEvent[] }
    }
    const key = `pod/${podId}/version/${query.selection}`
    parsePartKey(key)
    if (!this.db.prepare('SELECT 1 FROM parts WHERE runtime_id=? AND key=?').get(row.id, key)) throw new ProtocolError('version_not_found', 404)
    return { revision: row.revision, version: read(key) as ScriptView }
  }

  archive(actor: WorkspaceActor, lease: string): CentralSnapshot | null {
    const row = this.runtime(actor, lease)
    return this.hasData(row) ? assembleSnapshot(this.reader(row.id), Object.keys(this.manifest(row.id))) : null
  }

  submit(owner: Owner, runtimeId: string, revision: number, command: CentralCommand, id: string, trustedRuntime = false): CentralOperation {
    centralId(id); centralRevision(revision); command = trustedRuntime ? parseRuntimeCentralCommand(command) : parseCentralCommand(command)
    const requestHash = digest(JSON.stringify([runtimeId, revision, command]))
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id)
      if (prior) {
        if (prior.owner !== ownerKey(owner) || prior.request_hash !== requestHash) throw new ProtocolError('workspace_operation_conflict', 409)
        return this.operation(owner, id)
      }
      const row = this.ready(owner, runtimeId)
      this.ready(owner, runtimeId, commandPodIds(command, this.scope(row)))
      if (row.revision !== revision) throw new ProtocolError('workspace_revision_conflict', 409)
      if (this.db.prepare('SELECT 1 FROM operations WHERE runtime_id=? AND state IN (\'accepted\',\'started\',\'unknown\')').get(runtimeId)) throw new ProtocolError('workspace_busy', 409)
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,\'accepted\',NULL,NULL,?,?)').run(id, ownerKey(owner), runtimeId, requestHash, JSON.stringify(command), revision, this.now() + centralLeaseMs)
      this.changed(row)
      return this.operation(owner, id)
    })
  }

  claim(actor: WorkspaceActor, lease: string): CentralOperation | null {
    return this.transaction(() => {
      const row = this.runtime(actor, lease)
      this.ready(actor.owner, actor.id)
      const pending = this.db.prepare('SELECT id FROM operations WHERE runtime_id=? AND state=\'accepted\' ORDER BY rowid LIMIT 1').get(row.id)
      if (!pending) return null
      const operation = this.operation(actor.owner, String(pending.id))
      const expires = Number(this.db.prepare('SELECT expires FROM operations WHERE id=?').get(operation.id)!.expires)
      if (expires <= this.now()) {
        this.db.prepare('UPDATE operations SET state=\'failed\',error=\'Workspace changed or command expired\' WHERE id=?').run(operation.id); this.changed(row); return null
      }
      this.ready(actor.owner, row.id, commandPodIds(operation.command, this.scope(row)))
      this.db.prepare('UPDATE operations SET state=\'started\' WHERE id=?').run(operation.id); this.changed(row)
      return this.operation(actor.owner, operation.id)
    })
  }

  operation(owner: Owner, id: string): CentralOperation {
    const row = this.db.prepare('SELECT * FROM operations WHERE id=? AND owner=?').get(centralId(id), ownerKey(owner))
    if (!row) throw new ProtocolError('workspace_operation_not_found', 404)
    return { id, runtimeId: String(row.runtime_id), command: JSON.parse(String(row.command)), state: row.state as CentralOperation['state'], result: row.result ? JSON.parse(String(row.result)) : null, error: row.error as string | null, revision: Number(row.revision) }
  }

  visibleOperation(owner: Owner, id: string): CentralOperation {
    const operation = this.operation(owner, id)
    const row = this.ready(owner, operation.runtimeId)
    this.ready(owner, operation.runtimeId, commandPodIds(operation.command, this.scope(row)))
    return operation
  }

  cursor(owner: Owner): number {
    return Number(this.db.prepare('SELECT coalesce(max(sequence),0) AS cursor FROM changes WHERE owner=?').get(ownerKey(owner))!.cursor)
  }

  putArtifact(actor: WorkspaceActor, lease: string, podId: string, hash: string, content: Uint8Array): void {
    this.runtime(actor, lease); centralId(podId)
    if (content.length > centralMaxBytes) throw new ProtocolError('artifact_too_large', 413)
    if (digest(content) !== hash) throw new ProtocolError('artifact_hash_mismatch')
    this.db.prepare('INSERT OR IGNORE INTO artifacts VALUES(?,?,?,?)').run(actor.id, podId, hash, content)
  }

  artifact(owner: Owner, runtimeId: string, podId: string, path: string): Uint8Array {
    const row = this.ready(owner, runtimeId, [centralId(podId)])
    const file = (this.reader(row.id)('artifacts') as CentralSnapshot['artifacts']).find(item => item.podId === podId && item.path === path)
    if (!file) throw new ProtocolError('artifact_not_found', 404)
    const bytes = this.db.prepare('SELECT content FROM artifacts WHERE runtime_id=? AND pod_id=? AND hash=?').get(runtimeId, podId, file.hash)?.content
    if (!(bytes instanceof Uint8Array)) throw new Error('Committed artifact is missing')
    return bytes
  }
}
