// @vitest-environment node
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { classifyStorageError, openStorage } from '../../src/worker/storage/readiness'
import { PodDatabase, schemaVersion  } from '../../src/worker/storage/database'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { runAutomaticBackup, readBackupStatus } from '../../src/worker/data/automatic-backup'
import { listBackups, preserveRecoveryCopy, storageDiagnostics } from '../../src/main/storage-recovery'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (existsSync(join(root, 'control.sqlite'))) chmodSync(join(root, 'control.sqlite'), 0o600)
    rmSync(root, { recursive: true, force: true })
  }
})
function profile(): string {
  const root = mkdtempSync(join(tmpdir(), 'pods-readiness-')); roots.push(root)
  const store = openStorage(root); const pod = store.createPod({ name: 'Kept' }); store.close()
  mkdirSync(join(root, 'pods', pod.id), { recursive: true })
  return root
}
/** Every file of the database set with its digest, to prove diagnosis and failed opens leave them untouched. */
function databaseSet(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root).filter(name => name.startsWith('control.sqlite')).map(name => [name, createHash('sha256').update(readFileSync(join(root, name))).digest('hex')]))
}
/** A real schema-47 profile (desktop 7fab4b84) with one Pod; `change` runs before the version is set. */
function profile47(change = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'pods-readiness-')); roots.push(root)
  const database = new DatabaseSync(join(root, 'control.sqlite'), { enableForeignKeyConstraints: false })
  database.exec(readFileSync(join(import.meta.dirname, 'fixtures/schema-47.sql'), 'utf8'))
  database.exec(`INSERT INTO settings VALUES(1,1,2); INSERT INTO data_settings VALUES(1,10737418240,0,NULL); INSERT INTO onboarding VALUES(1,0,NULL); INSERT INTO pod_organization VALUES(1,1); INSERT INTO network_scheduler_state(id) VALUES(1);
    INSERT INTO pods VALUES('00000000-0000-4000-8000-000000000001','Kept',1,'paused',NULL,1); INSERT INTO checkpoints VALUES('00000000-0000-4000-8000-000000000001',0,'{}');
    ${change} PRAGMA user_version=47;`)
  database.close()
  return root
}
function failure(root: string) {
  try { openStorage(root, 1).close() }
  catch (error) { return classifyStorageError(error) }
  throw new Error('Storage opened unexpectedly')
}

describe('storage failures stay recoverable and leave the original data untouched', () => {
  it('classifies a damaged header as corruption without changing a byte', () => {
    const root = profile(); const path = join(root, 'control.sqlite')
    const bytes = readFileSync(path); bytes.write('Not SQLite at al', 0, 'latin1'); writeFileSync(path, bytes)
    const before = databaseSet(root)
    const started = Date.now()
    expect(failure(root).reason).toBe('corrupt')
    expect(Date.now() - started).toBeLessThan(5000)
    expect(databaseSet(root)).toEqual(before)
  })

  it('classifies a truncated database and keeps the remaining bytes', () => {
    const root = profile(); const path = join(root, 'control.sqlite')
    truncateSync(path, Math.floor(readFileSync(path).length / 3))
    const before = databaseSet(root)
    expect(['corrupt', 'invalid-data']).toContain(failure(root).reason)
    expect(databaseSet(root)).toEqual(before)
  })

  it('refuses to start an empty database over a profile whose database is missing', () => {
    const root = profile()
    rmSync(join(root, 'control.sqlite'))
    expect(failure(root).reason).toBe('missing')
    expect(existsSync(join(root, 'control.sqlite'))).toBe(false)
    // An empty profile is the explicit first start and creates its database.
    const fresh = mkdtempSync(join(tmpdir(), 'pods-readiness-fresh-')); roots.push(fresh)
    openStorage(fresh).close()
    expect(existsSync(join(fresh, 'storage.json'))).toBe(true)
  })

  it('refuses newer and older schemas without touching them', () => {
    for (const [version, reason] of [[schemaVersion + 1, 'schema-newer'], [40, 'schema-older']] as const) {
      const root = profile()
      const database = new DatabaseSync(join(root, 'control.sqlite')); database.exec(`PRAGMA user_version=${version}`); database.close()
      const before = databaseSet(root)
      expect(failure(root).reason).toBe(reason)
      expect(databaseSet(root)).toEqual(before)
    }
  })

  it('rolls an interrupted conversion back completely and succeeds once the cause is gone', () => {
    // The conversion stops after its backup because the network runtime still holds a delivery.
    const root = profile47('INSERT INTO network_deliveries(id,network_id,event_id,subscription_id,case_id,case_revision,state,ready_at,accepted_at) VALUES(\'d\',\'n\',\'e\',\'s\',\'c\',1,\'pending\',1,1);')
    expect(failure(root).reason).toBe('conversion-blocked')
    const after = new DatabaseSync(join(root, 'control.sqlite'))
    expect(after.prepare('PRAGMA user_version').get()!.user_version).toBe(47)
    expect(after.prepare('SELECT count(*) AS count FROM pods').get()!.count).toBe(1)
    expect(after.prepare('SELECT count(*) AS count FROM sqlite_schema WHERE name=\'legacy_records\'').get()!.count).toBe(0)
    after.exec('DELETE FROM network_deliveries')
    after.close()
    expect(readdirSync(root).filter(name => name.startsWith('before-v47-'))).toHaveLength(1)
    const store = openStorage(root, 1)
    expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
    store.close()
  })

  it('reports lock contention as busy and opens after the lock is released', () => {
    // A conversion must write; another process holds the write lock meanwhile.
    const root = profile47()
    const holder = new DatabaseSync(join(root, 'control.sqlite')); holder.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE; INSERT INTO pod_groups VALUES(\'held\',\'Held\',0)')
    expect(failure(root).reason).toBe('busy')
    holder.exec('ROLLBACK'); holder.close()
    openStorage(root, 1).close()
  }, 30000)

  it('reports denied file access as a permission problem', () => {
    const root = profile()
    chmodSync(join(root, 'control.sqlite'), 0o000)
    expect(failure(root).reason).toBe('permission')
  })

  it('classifies disk-full, I/O and unknown failures without calling them corruption', () => {
    expect(classifyStorageError(Object.assign(new Error('write failed'), { code: 'ENOSPC' })).reason).toBe('disk-full')
    expect(classifyStorageError(Object.assign(new Error('database or disk is full'), { errcode: 13 })).reason).toBe('disk-full')
    expect(classifyStorageError(Object.assign(new Error('disk I/O error'), { errcode: 522 })).reason).toBe('io')
    expect(classifyStorageError(new Error('Opening timed out')).reason).toBe('unknown')
  })

  it('diagnoses and preserves the damaged set read-only, beside the profile', async () => {
    const root = profile(); const path = join(root, 'control.sqlite')
    const bytes = readFileSync(path); bytes.write('Not SQLite at al', 0, 'latin1'); writeFileSync(path, bytes)
    const before = databaseSet(root)
    const diagnostics = await storageDiagnostics(root)
    expect(diagnostics.header).toMatchObject({ sqlite: false })
    expect(diagnostics.files.map(file => file.name)).toContain('control.sqlite')
    const copy = await preserveRecoveryCopy(root, join(root, 'base'))
    const receipt = JSON.parse(readFileSync(join(copy, 'recovery.json'), 'utf8')) as { files: { name: string, sha256: string }[] }
    expect(Object.fromEntries(receipt.files.map(file => [file.name, file.sha256]))).toEqual(before)
    expect(databaseSet(root)).toEqual(before)
  })
})

describe('backups and restore', () => {
  it('marks a corrupt newest backup as unusable, keeps the older verified one and never mixes a failed restore in', async () => {
    const root = profile(); const exports = mkdtempSync(join(tmpdir(), 'pods-backups-')); roots.push(exports)
    const store = new PodDatabase(root)
    const older = await createBackup(store, exports)
    await new Promise(resolve => setTimeout(resolve, 5))
    const newer = await createBackup(store, exports)
    store.close()
    const damaged = readFileSync(join(newer, 'control.sqlite')); damaged[5000] = damaged[5000]! ^ 0xFF; writeFileSync(join(newer, 'control.sqlite'), damaged)
    const listed = await listBackups(exports, false)
    const named = (path: string) => listed.find(backup => backup.path.endsWith(path.split('/').pop()!))
    expect(named(newer)).toMatchObject({ valid: false })
    expect(named(older)).toMatchObject({ valid: true })
    const parent = mkdtempSync(join(tmpdir(), 'pods-restore-target-')); roots.push(parent)
    await expect(restoreBackup(newer, parent, schemaVersion)).rejects.toThrow()
    expect(readdirSync(parent)).toEqual([])
    const restored = await restoreBackup(older, parent, schemaVersion)
    expect(readdirSync(parent)).toEqual([restored.split('/').pop()])
  })

  it('records a failed automatic backup and keeps every earlier verified generation', async () => {
    const root = profile(); const directory = join(mkdtempSync(join(tmpdir(), 'pods-auto-')), 'Backups'); roots.push(join(directory, '..'))
    const store = new PodDatabase(root)
    try {
      for (let index = 0; index < 5; index++) { await runAutomaticBackup(store, directory, Date.now() + index); await new Promise(resolve => setTimeout(resolve, 5)) }
      expect((await listBackups(directory, true)).filter(backup => backup.valid)).toHaveLength(4)
      chmodSync(directory, 0o500)
      await expect(runAutomaticBackup(store, directory)).rejects.toThrow()
      chmodSync(directory, 0o700)
      expect((await readBackupStatus(root)).lastError).toBeTruthy()
      expect((await listBackups(directory, true)).filter(backup => backup.valid)).toHaveLength(4)
      // Busy profiles are skipped, not recorded as failures.
      store.db.prepare('INSERT INTO dependency_domains VALUES(\'x\',2)').run()
      expect(await runAutomaticBackup(store, directory)).toBeNull()
    }
    finally { store.close() }
  })
})
