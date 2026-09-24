import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Owner } from '@openape/pods-protocol'
import { ProtocolError } from '@openape/pods-protocol'
import { centralId, centralLeaseMs, centralMaxBytes, centralRevision, commandPodIds, parseCentralCommand, parseCentralSnapshot, parseRuntimeCentralCommand } from '../../../openape-pods/src/contracts/central'
import type { CentralCommand, CentralOperation, CentralRuntime, CentralSnapshot } from '../../../openape-pods/src/contracts/central'

export interface WorkspaceActor { id: string, generation: string, owner: Owner }
interface RuntimeRow { id: string, owner: string, generation: string, lease: string, heartbeat: number, revision: number, hash: string, snapshot: string | null }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const ownerKey = (owner: Owner) => JSON.stringify([owner.issuer, owner.subject])

export class WorkspaceStore {
  readonly db: DatabaseSync
  constructor(path: string, readonly now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 1) { this.db.close(); throw new Error('Workspace database requires a newer server') }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runtimes(id TEXT PRIMARY KEY,owner TEXT NOT NULL,generation TEXT NOT NULL,lease TEXT NOT NULL,heartbeat INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,hash TEXT NOT NULL DEFAULT '',snapshot TEXT);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,runtime_id TEXT NOT NULL REFERENCES runtimes(id),request_hash TEXT NOT NULL,command TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT,revision INTEGER NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,runtime_id TEXT NOT NULL REFERENCES runtimes(id),hash TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,runtime_id TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(runtime_id TEXT NOT NULL REFERENCES runtimes(id),pod_id TEXT NOT NULL,hash TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(runtime_id,pod_id,hash));
      CREATE INDEX IF NOT EXISTS owner_changes ON changes(owner,sequence);
      PRAGMA user_version=1;`)
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

  private online(row: RuntimeRow): boolean { return row.heartbeat > 0 && row.heartbeat + centralLeaseMs > this.now() }
  private ready(owner: Owner, id: string, podIds: string[] = []): RuntimeRow {
    const row = this.row(owner, id)
    if (!this.online(row) || !row.snapshot) throw new ProtocolError('pod_offline', 409)
    const snapshot = JSON.parse(row.snapshot) as CentralSnapshot
    for (const id of podIds) {
      const pod = snapshot.pods.find(pod => pod.id === id)
      if (!pod) throw new ProtocolError('pod_not_found', 404)
      if (!pod.ready) throw new ProtocolError('pod_offline', 409)
    }
    return row
  }

  private runtime(actor: WorkspaceActor, lease: string): RuntimeRow {
    const row = this.row(actor.owner, actor.id)
    if (row.generation !== actor.generation || row.lease !== lease) throw new ProtocolError('stale_workspace_runtime', 409)
    return row
  }

  assertLease(actor: WorkspaceActor, lease: string): void { this.runtime(actor, lease) }

  begin(actor: WorkspaceActor): { lease: string, revision: number, hash: string, pending: CentralOperation[] } {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM runtimes WHERE id=?').get(actor.id) as unknown as RuntimeRow | undefined
      if (previous && (previous.owner !== ownerKey(actor.owner) || previous.generation !== actor.generation)) throw new ProtocolError('workspace_binding_changed', 409)
      if (previous && this.online(previous)) throw new ProtocolError('workspace_already_connected', 409)
      const lease = randomUUID()
      this.db.prepare('INSERT INTO runtimes(id,owner,generation,lease) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,heartbeat=0').run(actor.id, ownerKey(actor.owner), actor.generation, lease)
      this.db.prepare('UPDATE operations SET state=\'unknown\',error=\'Runtime disconnected; reconcile before retrying\' WHERE runtime_id=? AND state=\'started\'').run(actor.id)
      this.db.prepare('UPDATE operations SET state=\'failed\',error=\'Pod went offline before execution\' WHERE runtime_id=? AND state=\'accepted\'').run(actor.id)
      const row = this.row(actor.owner, actor.id); this.changed(row)
      const pending = this.db.prepare('SELECT id FROM operations WHERE runtime_id=? AND state=\'unknown\'').all(actor.id).map(item => this.operation(actor.owner, String(item.id)))
      return { lease, revision: row.revision, hash: row.hash, pending }
    })
  }

  heartbeat(actor: WorkspaceActor, lease: string, hash: string): void {
    const row = this.runtime(actor, lease)
    if (this.db.prepare('SELECT 1 FROM operations WHERE runtime_id=? AND state=\'unknown\'').get(row.id)) throw new ProtocolError('workspace_operation_unresolved', 409)
    if (!row.snapshot || row.hash !== hash) throw new ProtocolError('workspace_reconciliation_required', 409)
    const previouslyOnline = this.online(row)
    this.db.prepare('UPDATE runtimes SET heartbeat=? WHERE id=?').run(this.now(), row.id)
    if (!previouslyOnline) this.changed(row)
  }

  disconnect(actor: WorkspaceActor, lease: string): void {
    const row = this.runtime(actor, lease)
    this.db.prepare('UPDATE runtimes SET heartbeat=0 WHERE id=?').run(row.id); this.changed(row)
  }

  publish(actor: WorkspaceActor, lease: string, id: string, expected: number, value: unknown, completion?: { id: string, result: unknown, error: string | null }): { revision: number, hash: string } {
    centralId(id); centralRevision(expected)
    const snapshot = parseCentralSnapshot(value)
    const encoded = JSON.stringify(snapshot)
    if (Buffer.byteLength(encoded) > centralMaxBytes) throw new ProtocolError('workspace_too_large', 413)
    const hash = digest(encoded)
    const requestHash = digest(JSON.stringify([expected, hash, completion ?? null]))
    return this.transaction(() => {
      const row = this.runtime(actor, lease)
      const prior = this.db.prepare('SELECT * FROM publications WHERE id=?').get(id)
      if (prior) {
        if (prior.runtime_id !== row.id || prior.hash !== requestHash) throw new ProtocolError('publication_conflict', 409)
        return { revision: Number(prior.revision), hash }
      }
      if (row.revision !== expected) throw new ProtocolError('workspace_revision_conflict', 409)
      const other = this.db.prepare('SELECT id FROM operations WHERE runtime_id=? AND state IN (\'started\',\'unknown\') AND id!=?').get(row.id, completion?.id ?? '')
      if (other) throw new ProtocolError('workspace_operation_unresolved', 409)
      for (const file of snapshot.artifacts) {
        const stored = this.db.prepare('SELECT length(content) AS size FROM artifacts WHERE runtime_id=? AND pod_id=? AND hash=?').get(row.id, file.podId, file.hash)
        if (!stored || stored.size !== file.size) throw new ProtocolError('workspace_artifact_missing', 409)
      }
      if (row.hash !== hash) this.db.prepare('UPDATE runtimes SET snapshot=?,hash=?,revision=revision+1 WHERE id=?').run(encoded, hash, row.id)
      const revision = this.row(actor.owner, actor.id).revision
      if (completion) {
        const result = JSON.stringify(completion.result)
        if (Buffer.byteLength(result) > centralMaxBytes) throw new ProtocolError('workspace_result_too_large', 413)
        const operation = this.operation(actor.owner, centralId(completion.id))
        if (operation.runtimeId !== row.id || !['started', 'unknown'].includes(operation.state)) throw new ProtocolError('workspace_operation_conflict', 409)
        this.db.prepare('UPDATE operations SET state=?,result=?,error=?,revision=? WHERE id=?').run(completion.error ? 'failed' : 'applied', result, completion.error, revision, operation.id)
      }
      this.db.prepare('INSERT INTO publications VALUES(?,?,?,?)').run(id, row.id, requestHash, revision)
      if (row.hash !== hash || completion) this.changed(row)
      return { revision, hash }
    })
  }

  inventory(owner: Owner): CentralRuntime[] {
    return this.db.prepare('SELECT * FROM runtimes WHERE owner=? ORDER BY id').all(ownerKey(owner)).map((raw) => {
      const row = raw as unknown as RuntimeRow
      const snapshot = row.snapshot ? JSON.parse(row.snapshot) as CentralSnapshot : null
      const online = this.online(row)
      return { id: row.id, revision: row.revision, online, workspace: snapshot
        ? { ...snapshot.workspace, pods: snapshot.workspace.pods.map((pod) => {
            const available = online && snapshot.pods.some(item => item.id === pod.id && item.ready)
            return available ? { ...pod, online: true } : { id: pod.id, name: pod.name, online: false, revision: 1, lifecycle: 'paused' as const, activeScript: null }
          }) }
        : { pods: [], organization: { revision: 1, groups: [] } } }
    })
  }

  read(owner: Owner, runtimeId: string, podId: string) {
    const row = this.ready(owner, runtimeId, [centralId(podId)])
    const snapshot = JSON.parse(row.snapshot!) as CentralSnapshot
    return { revision: row.revision, pod: snapshot.pods.find(pod => pod.id === podId)! }
  }

  archive(actor: WorkspaceActor, lease: string): CentralSnapshot | null {
    const row = this.runtime(actor, lease)
    return row.snapshot ? JSON.parse(row.snapshot) as CentralSnapshot : null
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
      const snapshot = JSON.parse(row.snapshot!) as CentralSnapshot
      this.ready(owner, runtimeId, commandPodIds(command, snapshot))
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
      this.ready(actor.owner, row.id, commandPodIds(operation.command, JSON.parse(row.snapshot!) as CentralSnapshot))
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
    this.ready(owner, operation.runtimeId, commandPodIds(operation.command, JSON.parse(row.snapshot!) as CentralSnapshot))
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
    const snapshot = JSON.parse(row.snapshot!) as CentralSnapshot
    const file = snapshot.artifacts.find(item => item.podId === podId && item.path === path)
    if (!file) throw new ProtocolError('artifact_not_found', 404)
    const bytes = this.db.prepare('SELECT content FROM artifacts WHERE runtime_id=? AND pod_id=? AND hash=?').get(runtimeId, podId, file.hash)?.content
    if (!(bytes instanceof Uint8Array)) throw new Error('Committed artifact is missing')
    return bytes
  }
}
