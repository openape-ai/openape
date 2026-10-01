import { randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'
import type { NetworkAuthority, NetworkEvents } from './network-events'
import { artifactReference, dataFields } from '../../contracts/network-data'
import type { ArtifactReference } from '../../contracts/network-data'
import { assertNetworkQuota } from './network-quota'

type CurrentScope = ReturnType<NetworkEvents['authority']>

export class ArtifactCleanupError extends Error {
  constructor(readonly files: { name: string, error: string }[]) { super('Managed artifact cleanup failed; inspect the retained files') }
}

export class NetworkArtifacts {
  private orphanCursor = ''
  constructor(private readonly store: PodDatabase, private readonly current: (authority: NetworkAuthority, finishing?: boolean) => CurrentScope) {}

  private permission(authority: NetworkAuthority, scopeId: unknown, operation: 'read' | 'create', finishing = false): CurrentScope {
    const scope = this.current(authority, finishing)
    if (typeof scopeId !== 'string') throw new Error('Artifact operation requires an explicit scope')
    const binding = this.store.db.prepare(`SELECT 1 FROM artifact_permissions p JOIN artifact_scopes s ON s.id=p.scope_id AND s.owner_issuer=p.owner_issuer AND s.owner_subject=p.owner_subject AND s.group_id=p.group_id
      WHERE p.network_id=? AND p.pod_id=? AND p.scope_id=? AND p.operation=? AND s.owner_issuer=? AND s.owner_subject=? AND s.group_id=?`).get(scope.definition.id, scope.member.podId, scopeId, operation, scope.row.owner_issuer!, scope.row.owner_subject!, scope.row.group_id!)
    if (!binding) throw new Error('Artifact operation requires an explicit same-company scope binding')
    return scope
  }

  create(authority: NetworkAuthority, value: unknown) {
    const input = dataFields(value, ['scope', 'bytesBase64', 'mediaType'])
    if (typeof input.bytesBase64 !== 'string' || input.bytesBase64.length > 174764 || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(input.bytesBase64)) throw new Error('Artifact requires canonical base64 within 128 KiB')
    const bytes = Buffer.from(input.bytesBase64, 'base64')
    if (bytes.length > 131072 || bytes.toString('base64') !== input.bytesBase64 || typeof input.mediaType !== 'string' || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(input.mediaType) || input.mediaType.length > 128) throw new Error('Invalid managed artifact bytes or media type')
    return this.store.transaction(() => {
      this.permission(authority, input.scope, 'create')
      if (Number(this.store.db.prepare('SELECT count(*) AS count FROM network_artifact_staging WHERE run_id=?').get(authority.runId)!.count) >= 32) throw new Error('Network invocation exceeds 32 staged artifacts')
      assertNetworkQuota(this.store, 8192)
      const hash = digest(bytes); const directory = this.directory(); const path = join(directory, hash)
      if (!existsSync(path)) {
        this.assertQuota(bytes.length)
        const temporary = join(directory, `.staging-${randomUUID()}`)
        const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try { writeFileSync(descriptor, bytes); fchmodSync(descriptor, 0o400); fsyncSync(descriptor) }
        finally { closeSync(descriptor) }
        try { renameSync(temporary, path); this.syncDirectory(directory) }
        finally { if (existsSync(temporary)) unlinkSync(temporary) }
      }
      this.bytes(path, hash, bytes.length)
      this.permission(authority, input.scope, 'create')
      const id = randomUUID()
      this.store.db.prepare('INSERT INTO network_artifact_staging VALUES(?,?,?,?,?,?,?)').run(authority.runId, id, input.scope as string, hash, bytes.length, input.mediaType as string, `artifacts/${hash}`)
      return { id, scope: input.scope as string, hash, size: bytes.length, mediaType: input.mediaType }
    })
  }

  read(authority: NetworkAuthority, value: unknown) {
    return this.store.transaction(() => {
      const reference = artifactReference(value)
      this.permission(authority, reference.scope, 'read')
      const row = this.row(authority, reference)
      if (Number(row.size) > 131072) throw new Error('Artifact exceeds the bounded read frame')
      const bytes = this.bytes(join(this.directory(), row.content_hash as string), row.content_hash as string, Number(row.size))
      return { ...reference, hash: row.content_hash, size: row.size, mediaType: row.media_type, bytesBase64: bytes.toString('base64') }
    })
  }

  reference(authority: NetworkAuthority, reference: ArtifactReference, finishing = false): void {
    this.permission(authority, reference.scope, 'read', finishing)
    this.row(authority, reference)
  }

  private row(authority: NetworkAuthority, reference: ArtifactReference) {
    const row = this.store.db.prepare('SELECT * FROM artifacts WHERE id=? AND scope_id=? UNION ALL SELECT id,scope_id,content_hash,size,media_type,storage_ref,NULL AS created_at FROM network_artifact_staging WHERE id=? AND scope_id=? AND run_id=?').get(reference.id, reference.scope, reference.id, reference.scope, authority.runId)
    if (!row || row.storage_ref !== `artifacts/${row.content_hash}` || !/^[a-f0-9]{64}$/.test(row.content_hash as string)) throw new Error('Artifact reference is missing or outside this invocation')
    return row
  }

  commit(authority: NetworkAuthority): void {
    const rows = this.store.db.prepare('SELECT * FROM network_artifact_staging WHERE run_id=? ORDER BY id').all(authority.runId)
    for (const row of rows) {
      this.permission(authority, row.scope_id, 'create', true)
      this.bytes(join(this.directory(), row.content_hash as string), row.content_hash as string, Number(row.size))
      this.store.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)').run(row.id!, row.scope_id!, row.content_hash!, row.size!, row.media_type!, row.storage_ref!, Date.now())
      this.retain({ id: row.id as string, scope: row.scope_id as string }, 'invocation', authority.runId)
    }
  }

  retain(reference: ArtifactReference, kind: 'record' | 'event' | 'invocation' | 'gate' | 'definition', id: string): void {
    this.store.db.prepare('INSERT OR IGNORE INTO artifact_references VALUES(?,?,?)').run(reference.id, kind, id)
  }

  prune(now = Date.now()): void {
    this.store.transaction(() => {
      this.store.db.prepare(`DELETE FROM artifact_references WHERE reference_kind='invocation' AND reference_id IN (
        SELECT i.run_id FROM network_invocations i JOIN runs r ON r.id=i.run_id JOIN network_invocation_controls c ON c.run_id=i.run_id
        WHERE r.finished_at<? AND i.state IN ('completed','blocked') AND (i.state='completed' OR c.resolved_receipt IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM run_leases l WHERE l.run_id=i.run_id)
        AND NOT EXISTS(SELECT 1 FROM network_deliveries d WHERE d.run_id=i.run_id AND d.state NOT IN ('done','discarded'))
        AND NOT EXISTS(SELECT 1 FROM network_effect_attempts e WHERE e.run_id=i.run_id AND e.state IN ('intent','unknown'))
      )`).run(now - 90 * 86400000)
      const obsolete = this.store.db.prepare(`SELECT id FROM artifacts a WHERE a.created_at<? AND NOT EXISTS(SELECT 1 FROM artifact_references r WHERE r.artifact_id=a.id) LIMIT 25`).all(now - 90 * 86400000)
      for (const row of obsolete) this.store.db.prepare('DELETE FROM artifacts WHERE id=?').run(row.id!)
    })
    if (!existsSync(join(this.store.root, 'artifacts'))) return
    const directory = this.directory()
    const names = readdirSync(directory).filter(name => /^[a-f0-9]{64}$/.test(name) || /^\.staging-[a-f0-9-]{36}$/.test(name)).sort()
    const page = names.filter(name => name > this.orphanCursor).slice(0, 100)
    this.orphanCursor = page.length === 100 ? page.at(-1)! : ''
    const failures: { name: string, error: string }[] = []
    this.store.transaction(() => {
      for (const name of page) {
        try {
          if (this.store.db.prepare('SELECT 1 FROM artifacts WHERE content_hash=? UNION ALL SELECT 1 FROM network_artifact_staging WHERE content_hash=?').get(name, name)) continue
          const path = join(directory, name); const stat = lstatSync(path)
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid managed artifact file')
          if (stat.mtimeMs < now - 86400000) unlinkSync(path)
        }
        catch (failure) { failures.push({ name, error: failure instanceof Error ? failure.message : 'Managed artifact cleanup failed; inspect the retained files' }) }
      }
      this.syncDirectory(directory)
    })
    if (failures.length) throw new ArtifactCleanupError(failures)
  }

  private directory(): string {
    const directory = join(this.store.root, 'artifacts')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Managed artifact directory must be private')
    return directory
  }

  private bytes(path: string, hash: string, size: number): Buffer {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(descriptor)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== size) throw new Error('Managed artifact size or file type changed')
      const bytes = readFileSync(descriptor)
      if (digest(bytes) !== hash) throw new Error('Managed artifact content hash changed')
      return bytes
    }
    finally { closeSync(descriptor) }
  }

  private syncDirectory(directory: string): void {
    const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(descriptor) }
    finally { closeSync(descriptor) }
  }

  private assertQuota(additionalBytes: number): void {
    const settings = this.store.db.prepare('SELECT used_bytes,limit_bytes FROM data_settings WHERE id=1').get()!
    const directory = this.directory()
    const retained = readdirSync(directory).reduce((total, name) => total + lstatSync(join(directory, name)).size, 0)
    const database = Number(this.store.db.prepare('PRAGMA page_count').get()!.page_count) * Number(this.store.db.prepare('PRAGMA page_size').get()!.page_size)
    const disk = statfsSync(this.store.root)
    if (Math.max(Number(settings.used_bytes), retained + database) + additionalBytes >= Number(settings.limit_bytes) || disk.bavail * disk.bsize - additionalBytes < 256 * 1024 * 1024) throw new Error('Managed artifact storage quota reached')
  }
}
