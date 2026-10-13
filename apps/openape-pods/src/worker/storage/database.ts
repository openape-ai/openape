import { assertIntegrity } from './integrity.ts'
import { baselineRows, baselineSchema, schemaVersion } from './schema.ts'
import { assertSupportedSchema, assertUpgradable, upgradeToCurrent } from './upgrade.ts'
import { restoreReviewGate } from './restore-fence.ts'
import { StorageError } from './errors.ts'
import { parseWorkDeclarations } from '../../contracts/work.ts'
import type { WorkDeclaration } from '../../contracts/work.ts'
import type { SandboxLevel } from '../../contracts/sandbox.ts'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface Pod {
  id: string
  name: string
  bindingRevision: number
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
  /** Retired network contract (takes/gives) kept only on archived script history; never executed (issue 1465). */
  contract?: unknown
  work?: WorkDeclaration[]
  /** The Pod also reads an external source on its schedule, so its scheduled runs are never skipped as idle. */
  polls?: true
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
export { schemaVersion }
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
  record(value, ['schemaVersion', 'contentHash', 'entrypoint', 'dependencyLockHash', 'runtimeVersion', 'capabilities', 'triggers', 'inputSchemaHash', 'outputSchemaHash', 'checkpointSchemaVersion', 'assignmentRevision', 'effects', 'contract', 'work', 'polls'])
  if (value.schemaVersion !== 1 || value.entrypoint !== 'run.mjs' || !['readOnly', 'reconciledEffects'].includes(value.effects as string)) throw new Error('Unsupported script contract')
  for (const key of ['contentHash', 'dependencyLockHash', 'inputSchemaHash', 'outputSchemaHash']) hash(value[key])
  text(value.runtimeVersion, 'runtime', 100); integer(value.checkpointSchemaVersion); integer(value.assignmentRevision)
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 100 || value.capabilities.some(cap => typeof cap !== 'string' || !/^[a-z][\w.-]{0,100}$/.test(cap))) throw new Error('Invalid capabilities')
  if (!Array.isArray(value.triggers) || !value.triggers.length || value.triggers.some(trigger => !['manual', 'schedule', 'event'].includes(trigger))) throw new Error('Invalid triggers')
  const manifest = structuredClone(value) as unknown as ScriptManifest
  if (value.work !== undefined) manifest.work = parseWorkDeclarations(value.work)
  if (value.polls !== undefined && value.polls !== true) throw new Error('Invalid polls declaration')
  return manifest
}
function syncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) }
  finally { closeSync(fd) }
}
function podFromRow(row: Record<string, unknown>): Pod {
  return { id: row.id as string, name: row.name as string, bindingRevision: row.revision as number, revision: row.metadata_revision as number, lifecycle: row.lifecycle as Pod['lifecycle'], activeScript: row.active_script as string | null }
}

export class PodDatabase {
  readonly db: DatabaseSync
  readonly blobs: string
  readonly path: string
  private transactionDepth = 0
  /** Runs after any write makes a Pod active; its paused-setup application terminal must end then (issue 1454). */
  onActivated: (podId: string) => void = () => {}
  constructor(readonly root: string) {
    this.path = join(root, 'control.sqlite')
    if (existsSync(this.path)) {
      const probe = new DatabaseSync(this.path, { readOnly: true })
      try {
        assertSupportedSchema(probe.prepare('PRAGMA user_version').get()?.user_version as number)
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
      assertIntegrity(this.db)
      // Converted data starts only with its conversion receipt (issue 1465).
      if (this.db.prepare('SELECT 1 FROM legacy_records LIMIT 1').get() && !this.db.prepare('SELECT 1 FROM storage_receipts WHERE kind=\'conversion\'').get()) throw new StorageError('invalid-data', 'Converted data has no conversion receipt')
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      this.db.function('pod_activated', (podId) => { this.onActivated(String(podId)); return null })
      this.db.exec('CREATE TEMP TRIGGER pod_activated AFTER UPDATE OF lifecycle ON pods WHEN NEW.lifecycle=\'active\' AND OLD.lifecycle<>\'active\' BEGIN SELECT pod_activated(NEW.id); END')
      this.db.exec(restoreReviewGate)
      mkdirSync(this.blobs, { recursive: true, mode: 0o700 })
    }
    catch (error) { this.db.close(); throw error }
  }

  private migrate(): void {
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version as number
    if (version === schemaVersion) return
    if (version === 0) {
      this.transaction(() => this.db.exec(`${baselineSchema}${baselineRows}PRAGMA user_version=${schemaVersion};`))
      return
    }
    // Refuse an unsupported database before writing a full copy of it on every start.
    assertUpgradable(this.db, version)
    const backup = join(this.root, `before-v${version}-${randomUUID()}.sqlite`)
    this.db.prepare('VACUUM INTO ?').run(backup); chmodSync(backup, 0o600)
    const copy = openSync(backup, 'r')
    try { fsyncSync(copy) }
    finally { closeSync(copy) }
    syncDirectory(this.root)
    const saved = new DatabaseSync(backup, { readOnly: true })
    try {
      if (saved.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || saved.prepare('PRAGMA user_version').get()?.user_version !== version) throw new Error('Pre-upgrade database backup failed verification')
    }
    finally { saved.close() }
    // Foreign keys stay off while the tables are rebuilt; upgradeToCurrent checks every reference afterwards.
    this.db.exec('PRAGMA foreign_keys=OFF')
    try { this.transaction(() => { upgradeToCurrent(this.db, version); this.db.exec(`PRAGMA user_version=${schemaVersion}`) }) }
    catch (error) {
      // The rolled-back database is unchanged, so its copy is redundant; repeated attempts never fill the disk.
      rmSync(backup, { force: true })
      throw error
    }
    finally { this.db.exec('PRAGMA foreign_keys=ON') }
    // The conversion drops the network tables; their pages return to the file system.
    this.db.exec('VACUUM')
  }

  transaction<T>(operation: () => T): T {
    const depth = this.transactionDepth
    const savepoint = `pods_transaction_${depth}`
    this.db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE')
    this.transactionDepth++
    try {
      const result = operation()
      this.db.exec(depth ? `RELEASE ${savepoint}` : 'COMMIT')
      return result
    }
    catch (error) {
      this.db.exec(depth ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK')
      throw error
    }
    finally { this.transactionDepth-- }
  }

  close(): void { this.db.close() }
  listPods(): Pod[] { return this.db.prepare('SELECT * FROM pods ORDER BY rowid').all().map(podFromRow) }
  getPod(id: string): Pod {
    const row = this.db.prepare('SELECT * FROM pods WHERE id=?').get(id)
    if (!row) throw new Error('Pod not found')
    return podFromRow(row)
  }

  /**
   * A new Pod runs its programs at the owner level with the owner's HOME unless the caller chooses `isolated`; the owner
   * decided this default for every Pod they create (issue 1468). Existing Pods keep their stored level.
   */
  createPod(input: unknown, id: string = randomUUID(), level: SandboxLevel = 'owner'): Pod {
    record(input, ['name']); text(input.name, 'name', 100)
    const { name } = input
    this.transaction(() => {
      this.db.prepare('INSERT INTO pods(id,name) VALUES(?,?)').run(id, name)
      // The table's CHECK constraint refuses any other level.
      this.db.prepare('INSERT INTO pod_sandbox VALUES(?,?)').run(id, level)
      this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?)').run(id, 0, '{}')
    })
    return this.getPod(id)
  }

  updatePod(id: string, expectedRevision: number, input: unknown): Pod {
    record(input, ['name', 'lifecycle']); text(input.name, 'name', 100); integer(expectedRevision)
    if (!['active', 'paused', 'archived'].includes(input.lifecycle as string)) throw new Error('Invalid lifecycle')
    const { name, lifecycle } = input
    this.transaction(() => {
      const update = this.db.prepare('UPDATE pods SET name=?,lifecycle=?,metadata_revision=metadata_revision+1 WHERE id=? AND metadata_revision=?').run(name, lifecycle as string, id, expectedRevision)
      if (update.changes !== 1) throw new Error('Stale pod revision')
    })
    return this.getPod(id)
  }

  assertStorage(additionalBytes = 0): void {
    const policy = this.db.prepare('SELECT * FROM data_settings WHERE id=1').get()!
    if (policy.error) throw new Error(policy.error as string)
    if ((policy.used_bytes as number) + additionalBytes >= (policy.limit_bytes as number)) throw new Error('Storage limit reached; clean unused data or raise the limit')
    const disk = statfsSync(this.root)
    if (disk.bavail * disk.bsize - additionalBytes < 256 * 1024 * 1024) throw new Error('Insufficient free disk space; at least 256 MiB must remain')
  }

  putBlob(content: string | Buffer, observe: (point: CommitPoint) => void = () => {}): string {
    const key = digest(content); const target = join(this.blobs, key)
    if (existsSync(target)) {
      if (digest(readFileSync(target)) !== key) throw new Error('Corrupt stored blob')
      return key
    }
    this.assertStorage(Buffer.byteLength(content))
    const stage = join(this.blobs, `.stage-${randomUUID()}`)
    const fd = openSync(stage, 'wx', 0o600)
    try { writeFileSync(fd, content); fsyncSync(fd) }
    finally { closeSync(fd) }
    observe('staged')
    renameSync(stage, target); syncDirectory(this.blobs); this.db.prepare('UPDATE data_settings SET used_bytes=used_bytes+? WHERE id=1').run(Buffer.byteLength(content)); observe('renamed')
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
    if (manifest.assignmentRevision !== pod.bindingRevision) throw new Error('Stale script binding')
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

  commitProgress(input: ProgressInput, observe: (point: CommitPoint) => void = () => {}, publish: (revision: number) => void = () => {}): number {
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
      publish(input.expectedRevision + 1)
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
