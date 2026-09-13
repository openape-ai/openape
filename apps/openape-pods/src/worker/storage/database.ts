import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface Pod {
  id: string
  name: string
  assignment: string
  revision: number
  lifecycle: 'active' | 'paused' | 'archived'
  activeScript: string | null
}
export interface ScriptManifest {
  schemaVersion: 1
  contentHash: string
  entrypoint: 'run.mjs'
  dependencyLockHash: string
  runtimeVersion: string
  capabilities: string[]
  triggers: ('manual' | 'schedule' | 'event')[]
  inputSchemaHash: string
  outputSchemaHash: string
  checkpointSchemaVersion: number
  assignmentRevision: number
  effects: 'readOnly' | 'reconciledEffects'
}
export interface SourceInput { id: string, locator: string, version: string, content: string }
export interface ClaimInput { id: string, matter: string, kind: 'finding' | 'question' | 'gap', text: string, sourceIds: string[], supersedes?: string }
export interface ProgressInput {
  podId: string
  expectedRevision: number
  checkpoint: Record<string, unknown>
  sources: SourceInput[]
  claims: ClaimInput[]
}
export type CommitPoint = 'staged' | 'renamed' | 'beforeCommit' | 'committed'
const schemaVersion = 6
export const digest = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')

function record(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid object schema')
}
function text(value: unknown, name: string, max = 20000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${name}`)
}
function integer(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('Invalid revision')
}
function hash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid content hash')
}
export function parseManifest(value: unknown): ScriptManifest {
  record(value, ['schemaVersion', 'contentHash', 'entrypoint', 'dependencyLockHash', 'runtimeVersion', 'capabilities', 'triggers', 'inputSchemaHash', 'outputSchemaHash', 'checkpointSchemaVersion', 'assignmentRevision', 'effects'])
  if (value.schemaVersion !== 1 || value.entrypoint !== 'run.mjs' || !['readOnly', 'reconciledEffects'].includes(value.effects as string)) throw new Error('Unsupported script contract')
  for (const key of ['contentHash', 'dependencyLockHash', 'inputSchemaHash', 'outputSchemaHash']) hash(value[key])
  text(value.runtimeVersion, 'runtime', 100); integer(value.checkpointSchemaVersion); integer(value.assignmentRevision)
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 100 || value.capabilities.some(cap => typeof cap !== 'string' || !/^[a-z][a-zA-Z0-9.-]{0,100}$/.test(cap))) throw new Error('Invalid capabilities')
  if (!Array.isArray(value.triggers) || !value.triggers.length || value.triggers.some(trigger => !['manual', 'schedule', 'event'].includes(trigger))) throw new Error('Invalid triggers')
  return structuredClone(value) as unknown as ScriptManifest
}
function syncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) }
  finally { closeSync(fd) }
}
function podFromRow(row: Record<string, unknown>): Pod {
  return { id: row.id as string, name: row.name as string, assignment: row.assignment as string, revision: row.revision as number, lifecycle: row.lifecycle as Pod['lifecycle'], activeScript: row.active_script as string | null }
}

export class PodDatabase {
  readonly db: DatabaseSync
  readonly blobs: string
  readonly path: string
  constructor(readonly root: string) {
    this.path = join(root, 'control.sqlite')
    if (existsSync(this.path)) {
      const probe = new DatabaseSync(this.path, { readOnly: true })
      try {
        const version = probe.prepare('PRAGMA user_version').get()?.user_version as number
        if (version > schemaVersion) throw new Error(`Database schema ${version} needs a newer application`)
        if (probe.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Database integrity check failed')
      }
      finally { probe.close() }
    }
    mkdirSync(root, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(this.path)
    this.blobs = join(root, 'blobs')
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
      this.migrate()
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      mkdirSync(this.blobs, { recursive: true, mode: 0o700 })
    }
    catch (error) { this.db.close(); throw error }
  }

  private migrate(): void {
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version as number
    if (version === schemaVersion) return
    if (version > 0) this.db.prepare('VACUUM INTO ?').run(join(this.root, `before-v${version}-${randomUUID()}.sqlite`))
    this.transaction(() => {
      if (version < 1) {
        this.db.exec(`
        CREATE TABLE pods(id TEXT PRIMARY KEY, name TEXT NOT NULL, assignment TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, lifecycle TEXT NOT NULL DEFAULT 'paused' CHECK(lifecycle IN ('active','paused','archived')), active_script TEXT);
        CREATE TABLE assignments(pod_id TEXT NOT NULL REFERENCES pods(id), revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(pod_id,revision));
        CREATE TABLE scripts(pod_id TEXT NOT NULL REFERENCES pods(id), hash TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(pod_id,hash));
        CREATE TABLE checkpoints(pod_id TEXT PRIMARY KEY REFERENCES pods(id), revision INTEGER NOT NULL, body TEXT NOT NULL);
        CREATE TABLE sources(pod_id TEXT NOT NULL REFERENCES pods(id), id TEXT NOT NULL, version TEXT NOT NULL, locator TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(pod_id,id,version));
        CREATE TABLE claims(pod_id TEXT NOT NULL REFERENCES pods(id), id TEXT NOT NULL, matter TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('finding','question','gap')), body TEXT NOT NULL, citations TEXT NOT NULL, supersedes TEXT, revision INTEGER NOT NULL, PRIMARY KEY(pod_id,id));
      `)
      }
      if (version < 2) {
        this.db.exec(`
        CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, concurrency INTEGER NOT NULL CHECK(concurrency BETWEEN 1 AND 8));
        INSERT INTO settings VALUES(1,1,2);
        CREATE TABLE validations(pod_id TEXT NOT NULL, script_hash TEXT NOT NULL, assignment_revision INTEGER NOT NULL, resource_epoch INTEGER NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(pod_id,script_hash,assignment_revision,resource_epoch), FOREIGN KEY(pod_id,script_hash) REFERENCES scripts(pod_id,hash));
        PRAGMA user_version=2;
      `)
      }
      if (version < 3) {
        this.db.exec(`
        CREATE TABLE resources(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id), revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reference','tool','connection')), state TEXT NOT NULL CHECK(state IN ('ready','missing','expired','revoked','refreshRequired')), name TEXT NOT NULL, configuration TEXT NOT NULL);
        CREATE TABLE resource_epochs(pod_id TEXT PRIMARY KEY REFERENCES pods(id), epoch INTEGER NOT NULL);
        CREATE TABLE snapshot_sets(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id), epoch INTEGER NOT NULL, manifest TEXT NOT NULL);
        PRAGMA user_version=3;
      `)
      }
      if (version < 4) {
        this.db.exec(`
        CREATE TABLE runs(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id), script_hash TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, summary TEXT NOT NULL, error TEXT, checkpoint_revision INTEGER NOT NULL, assignment_revision INTEGER NOT NULL);
        CREATE TABLE run_leases(pod_id TEXT PRIMARY KEY REFERENCES pods(id), run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), boot_id TEXT NOT NULL, heartbeat INTEGER NOT NULL, process_id INTEGER);
        CREATE TABLE run_events(run_id TEXT NOT NULL REFERENCES runs(id), sequence INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(run_id,sequence));
        PRAGMA user_version=4;
        `)
      }
      if (version < 5) {
        this.db.exec(`
          CREATE TABLE schedules(pod_id TEXT PRIMARY KEY REFERENCES pods(id),revision INTEGER NOT NULL,spec TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,next_at INTEGER,error TEXT);
          CREATE TABLE accepted_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,pod_id TEXT NOT NULL REFERENCES pods(id),source TEXT NOT NULL,dedupe_key TEXT NOT NULL,payload TEXT NOT NULL,accepted_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',run_id TEXT,error TEXT,UNIQUE(pod_id,source,dedupe_key));
          CREATE INDEX ready_events ON accepted_events(state,pod_id,sequence);
          CREATE TABLE run_inputs(run_id TEXT PRIMARY KEY REFERENCES runs(id),reason TEXT NOT NULL,event_ids TEXT NOT NULL);
          CREATE TABLE reference_observations(pod_id TEXT NOT NULL REFERENCES pods(id),resource_id TEXT NOT NULL,revision INTEGER NOT NULL,hash TEXT NOT NULL,generation INTEGER NOT NULL,error TEXT,PRIMARY KEY(pod_id,resource_id));
          PRAGMA user_version=5;
        `)
      }
      if (version < 6) {
        this.db.exec(`
          CREATE TABLE execution_domains(path TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),owner_pid INTEGER NOT NULL);
          CREATE TABLE recovery_reviews(run_id TEXT PRIMARY KEY REFERENCES runs(id),state TEXT NOT NULL,error TEXT,checked_at INTEGER NOT NULL,request_event_id TEXT);
          CREATE TABLE effect_ledger(pod_id TEXT NOT NULL REFERENCES pods(id),effect_key TEXT NOT NULL,operation TEXT NOT NULL,input_hash TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),state TEXT NOT NULL,result TEXT,PRIMARY KEY(pod_id,effect_key));
          PRAGMA user_version=6;
        `)
      }

    })
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  close(): void { this.db.close() }
  listPods(): Pod[] { return this.db.prepare('SELECT * FROM pods ORDER BY rowid').all().map(podFromRow) }
  getPod(id: string): Pod {
    const row = this.db.prepare('SELECT * FROM pods WHERE id=?').get(id)
    if (!row) throw new Error('Pod not found')
    return podFromRow(row)
  }

  createPod(input: unknown): Pod {
    record(input, ['name', 'assignment']); text(input.name, 'name', 100); text(input.assignment, 'assignment')
    const { name, assignment } = input
    const id = randomUUID()
    this.transaction(() => {
      this.db.prepare('INSERT INTO pods(id,name,assignment) VALUES(?,?,?)').run(id, name, assignment)
      this.db.prepare('INSERT INTO assignments VALUES(?,?,?)').run(id, 1, assignment)
      this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?)').run(id, 0, '{}')
    })
    return this.getPod(id)
  }

  updatePod(id: string, expectedRevision: number, input: unknown): Pod {
    record(input, ['name', 'assignment', 'lifecycle']); text(input.name, 'name', 100); text(input.assignment, 'assignment'); integer(expectedRevision)
    if (!['active', 'paused', 'archived'].includes(input.lifecycle as string)) throw new Error('Invalid lifecycle')
    const { name, assignment, lifecycle } = input
    this.transaction(() => {
      const update = this.db.prepare('UPDATE pods SET name=?,assignment=?,lifecycle=?,revision=revision+1 WHERE id=? AND revision=?').run(name, assignment, lifecycle as string, id, expectedRevision)
      if (update.changes !== 1) throw new Error('Stale pod revision')
      this.db.prepare('INSERT INTO assignments VALUES(?,?,?)').run(id, expectedRevision + 1, assignment)
    })
    return this.getPod(id)
  }

  putBlob(content: string | Buffer, observe: (point: CommitPoint) => void = () => {}): string {
    const key = digest(content); const target = join(this.blobs, key)
    if (existsSync(target)) {
      if (digest(readFileSync(target)) !== key) throw new Error('Corrupt stored blob')
      return key
    }
    const stage = join(this.blobs, `.stage-${randomUUID()}`)
    const fd = openSync(stage, 'wx', 0o600)
    try { writeFileSync(fd, content); fsyncSync(fd) }
    finally { closeSync(fd) }
    observe('staged')
    renameSync(stage, target); syncDirectory(this.blobs); observe('renamed')
    return key
  }

  readBlob(key: string): Buffer {
    hash(key)
    const content = readFileSync(join(this.blobs, key))
    if (digest(content) !== key) throw new Error('Corrupt stored blob')
    return content
  }

  storeScript(podId: string, input: unknown, artifact: string): ScriptManifest {
    const manifest = parseManifest(input)
    const pod = this.getPod(podId)
    if (manifest.assignmentRevision !== pod.revision) throw new Error('Stale assignment revision')
    if (digest(artifact) !== manifest.contentHash) throw new Error('Artifact hash mismatch')
    const existing = this.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, manifest.contentHash)
    if (existing && existing.manifest !== JSON.stringify(manifest)) throw new Error('Immutable script manifest conflict')
    this.putBlob(artifact)
    this.db.prepare('INSERT OR IGNORE INTO scripts VALUES(?,?,?)').run(podId, manifest.contentHash, JSON.stringify(manifest))
    return manifest
  }

  checkpoint(podId: string): { revision: number, body: Record<string, unknown> } {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE pod_id=?').get(podId)
    if (!row) throw new Error('Pod checkpoint not found')
    return { revision: row.revision as number, body: JSON.parse(row.body as string) }
  }

  commitProgress(input: ProgressInput, observe: (point: CommitPoint) => void = () => {}): number {
    this.getPod(input.podId)
    if (JSON.stringify(input).length > 1024 * 1024) throw new Error('Progress exceeds frame limit')
    const sources = input.sources.map((source) => {
      text(source.id, 'source ID'); text(source.version, 'source version'); text(source.locator, 'source locator'); text(source.content, 'source content', 1024 * 1024)
      return { ...source, hash: this.putBlob(source.content, observe) }
    })
    const revision = this.transaction(() => {
      if (this.checkpoint(input.podId).revision !== input.expectedRevision) throw new Error('Stale checkpoint revision')
      for (const source of sources) {
        const prior = this.db.prepare('SELECT hash,locator FROM sources WHERE pod_id=? AND id=? AND version=?').get(input.podId, source.id, source.version)
        if (prior && (prior.hash !== source.hash || prior.locator !== source.locator)) throw new Error('Source version conflict')
        this.db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?)').run(input.podId, source.id, source.version, source.locator, source.hash)
      }
      for (const claim of input.claims) this.insertClaim(input.podId, input.expectedRevision + 1, claim)
      this.db.prepare('UPDATE checkpoints SET revision=revision+1,body=? WHERE pod_id=?').run(JSON.stringify(input.checkpoint), input.podId)
      observe('beforeCommit')
      return input.expectedRevision + 1
    })
    observe('committed')
    return revision
  }

  private insertClaim(podId: string, revision: number, claim: ClaimInput): void {
    text(claim.id, 'claim ID'); text(claim.matter, 'matter'); text(claim.text, 'claim')
    if (!['finding', 'question', 'gap'].includes(claim.kind) || !Array.isArray(claim.sourceIds) || !claim.sourceIds.length) throw new Error('Claim needs sources and a valid kind')
    const citations = claim.sourceIds.map((id) => {
      const row = this.db.prepare('SELECT id,version,hash,locator FROM sources WHERE pod_id=? AND id=? ORDER BY rowid DESC LIMIT 1').get(podId, id)
      if (!row) throw new Error('Claim references unavailable evidence')
      return row
    })
    if (claim.supersedes && !this.db.prepare('SELECT id FROM claims WHERE pod_id=? AND id=? AND matter=?').get(podId, claim.supersedes, claim.matter)) throw new Error('Superseded claim not found in matter')
    const prior = this.db.prepare('SELECT * FROM claims WHERE pod_id=? AND id=?').get(podId, claim.id)
    const values = [podId, claim.id, claim.matter, claim.kind, claim.text, JSON.stringify(citations), claim.supersedes ?? null, revision]
    if (prior) {
      if (prior.body !== claim.text || prior.citations !== JSON.stringify(citations) || prior.kind !== claim.kind || prior.matter !== claim.matter || prior.supersedes !== (claim.supersedes ?? null)) throw new Error('Immutable claim conflict')
      return
    }
    this.db.prepare('INSERT INTO claims VALUES(?,?,?,?,?,?,?,?)').run(...values)
  }

  knowledge(podId: string): Record<string, unknown>[] {
    this.getPod(podId)
    return this.db.prepare('SELECT * FROM claims WHERE pod_id=? ORDER BY revision,id').all(podId).map(row => ({ ...row, citations: JSON.parse(row.citations as string) }))
  }
}
