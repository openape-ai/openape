import { assertIntegrity } from '../storage/integrity'
import { restoreNetworkStorage } from '../storage/network-restore'
import { assertSupportedSchema, upgradeToBaseline } from '../storage/upgrade'
import { DependencyStore, removePackageTree } from '../dependencies/store'
import { checkLock, packageDigest, packageFiles } from '../dependencies/tree'
import { parsePackages } from '../../contracts/dependencies'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { PodDatabase } from '../storage/database'
import { digest, schemaVersion } from '../storage/database'
import { copyVerified, durableJSON, files, privateTarget, relativePath, syncDirectory, syncTree } from './files'
import type { FileRecord } from './files'

export interface BackupManifest { format: 'openape-pods-backup', version: 1, schema: number, createdAt: string, sourceRoot: string, files: FileRecord[] }
const uuid = (value: string) => /^[a-f0-9-]{36}$/.test(value)
// MCP journal entries (including the command calling here) are receipts, not work: their real work holds
// leases. Other running actions, such as a script validation on the dependency tree, are real work.
export const activeMasterAction = 'id NOT LIKE \'codex-admin:%\' AND id NOT LIKE \'codex-network:%\''
export function networkDataBusy(store: PodDatabase): boolean {
  return !!store.db.prepare('SELECT 1 FROM network_invocations WHERE state IN (\'running\',\'stopping\') UNION ALL SELECT 1 FROM network_gate_task_attempts WHERE state=\'running\' UNION ALL SELECT 1 FROM network_deliveries WHERE state=\'claimed\' UNION ALL SELECT 1 FROM network_gate_tasks WHERE state=\'consuming\' LIMIT 1').get()
}
export function assertDataIdle(store: PodDatabase): void {
  if (networkDataBusy(store)) throw new Error('Finish or recover network work before changing application data')
  if (store.db.prepare('SELECT 1 FROM dependency_domains LIMIT 1').get()) throw new Error('Finish dependency preparation before changing application data')
  if (store.db.prepare('SELECT 1 FROM pod_descriptions WHERE state=\'running\'').get()) throw new Error('Wait for the description update before changing stored data')
  if (store.db.prepare('SELECT 1 FROM program_leases LIMIT 1').get() || store.db.prepare('SELECT 1 FROM run_leases LIMIT 1').get() || store.db.prepare(`SELECT 1 FROM master_actions WHERE state='running' AND ${activeMasterAction} LIMIT 1`).get()) throw new Error('Finish or recover active work before changing application data')
}
function allowed(path: string): boolean {
  relativePath(path)
  if (path === 'control.sqlite') return true
  const parts = path.split('/')
  if (parts[0] === 'blobs' || parts[0] === 'artifacts') return parts.length === 2 && /^[a-f0-9]{64}$/.test(parts[1])
  if (parts[0] === 'dependencies') return uuid(parts[1] ?? '') && /^[a-f0-9]{64}$/.test(parts[2] ?? '') && parts.length > 3
  if (parts[0] === 'pods') return uuid(parts[1] ?? '') && parts[2] === 'workspace' && parts.length > 3
  return parts[0] === 'snapshots' && parts.length === 4 && uuid(parts[1]) && uuid(parts[2]) && (uuid(parts[3]) || parts[3] === 'manifest.json')
}
export function parseBackupManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup manifest')
  const manifest = value as BackupManifest
  if (manifest.format !== 'openape-pods-backup' || manifest.version !== 1 || !Number.isSafeInteger(manifest.schema) || manifest.schema < 1 || typeof manifest.sourceRoot !== 'string' || !manifest.sourceRoot.startsWith('/') || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100000) throw new Error('Unsupported backup format')
  const seen = new Set<string>(); let size = 0
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !allowed(file.path) || seen.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 256 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.hash)) throw new Error('Invalid backup file record')
    seen.add(file.path); size += file.size
  }
  if (!seen.has('control.sqlite') || size > 10 * 1024 ** 3) throw new Error('Backup exceeds supported limits')
  return manifest
}
function checkDatabase(database: DatabaseSync, schema: number): void {
  database.exec('PRAGMA trusted_schema=OFF;')
  if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || database.prepare('PRAGMA user_version').get()?.user_version !== schema) throw new Error('Backup database integrity or schema check failed')
  if (database.prepare('SELECT 1 FROM sqlite_schema WHERE type IN (\'view\',\'trigger\') LIMIT 1').get()) throw new Error('Backup contains unsupported database programs')
}
function requiredBlobs(database: DatabaseSync): string[] {
  return database.prepare('SELECT hash FROM sources UNION SELECT hash FROM scripts UNION SELECT content_hash AS hash FROM pod_definition_versions').all().map(row => row.hash as string)
}
function retainedArtifacts(database: DatabaseSync): { path: string, hash: string, size: number }[] {
  return database.prepare('SELECT content_hash,storage_ref,size FROM artifacts UNION ALL SELECT content_hash,storage_ref,size FROM network_artifact_staging').all().map((row) => {
    const hash = String(row.content_hash); const path = String(row.storage_ref); const size = Number(row.size)
    if (!/^[a-f0-9]{64}$/.test(hash) || path !== `artifacts/${hash}` || !Number.isSafeInteger(size) || size < 0 || size > 256 * 1024 * 1024) throw new Error('Invalid retained artifact storage')
    return { path, hash, size }
  })
}
/** A schema-45 backup is rebuilt as the current baseline before anything else reads it. */
function upgradeRestored(database: DatabaseSync, schema: number): void {
  if (schema === schemaVersion) return
  database.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;')
  try { upgradeToBaseline(database); database.exec(`PRAGMA user_version=${schemaVersion}; COMMIT;`) }
  catch (error) { database.exec('ROLLBACK'); throw error }
}

export async function createBackup(store: PodDatabase, parent: string, observe: (path: string) => void = () => {}): Promise<string> {
  assertDataIdle(store)
  const sourceRoot = await realpath(store.root); const destination = await realpath(parent)
  if (destination === sourceRoot || destination.startsWith(sourceRoot + sep)) throw new Error('Choose a backup destination outside this application profile')
  const name = `OpenApe-Pods-${new Date().toISOString().slice(0, 10)}-${randomUUID()}`
  const stage = await privateTarget(destination, `.partial-${name}`); const target = join(destination, name)
  try {
    const databasePath = join(stage, 'control.sqlite'); store.db.prepare('VACUUM INTO ?').run(databasePath); await chmod(databasePath, 0o600)
    const saved = await open(databasePath, 'r'); try { await saved.sync() }
    finally { await saved.close() }
    const database = new DatabaseSync(databasePath, { readOnly: true })
    const paths = new Map<string, string | undefined>(); const artifactSizes = new Map<string, number>(); let schema: number
    try {
      schema = database.prepare('PRAGMA user_version').get()!.user_version as number; checkDatabase(database, schema); assertIntegrity(database, true)
      for (const hash of requiredBlobs(database)) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid referenced blob'); paths.set(`blobs/${hash}`, hash) }
      for (const artifact of retainedArtifacts(database)) {
        if (artifactSizes.has(artifact.path) && artifactSizes.get(artifact.path) !== artifact.size) throw new Error('Invalid retained artifact storage')
        paths.set(artifact.path, artifact.hash); artifactSizes.set(artifact.path, artifact.size)
      }
      for (const row of database.prepare('SELECT id FROM pods').all()) {
        if (!uuid(row.id as string)) throw new Error('Invalid pod identity in backup')
        for (const path of await files(sourceRoot, `pods/${row.id}/workspace`)) paths.set(path, undefined)
      }
      for (const set of new DependencyStore(store).inventory()) {
        await new DependencyStore(store).verify(set.podId, set.hash)
        for (const file of set.files) paths.set(`dependencies/${set.podId}/${set.hash}/${file.path}`, file.hash)
      }
      for (const row of database.prepare('SELECT * FROM snapshot_sets').all()) {
        if (!uuid(row.id as string) || !uuid(row.pod_id as string)) throw new Error('Invalid snapshot identity')
        const snapshot = JSON.parse(row.manifest as string) as { files: { id: string, hash: string }[] }
        if (!Array.isArray(snapshot.files) || snapshot.files.length > 100) throw new Error('Invalid retained snapshot')
        for (const file of snapshot.files) { if (!uuid(file.id) || !/^[a-f0-9]{64}$/.test(file.hash)) throw new Error('Invalid snapshot file'); paths.set(`snapshots/${row.pod_id}/${row.id}/${file.id}`, file.hash) }
      }
    }
    finally { database.close() }
    const records: FileRecord[] = []; let size = 0
    for (const [path, expected] of paths) {
      if (!allowed(path) || paths.size > 100000) throw new Error('Unsupported backup inventory')
      observe(path); const file = await copyVerified(sourceRoot, path, stage)
      if (artifactSizes.has(path) && artifactSizes.get(path) !== file.size) throw new Error(`Retained artifact size mismatch: ${path}`)
      if (expected && file.hash !== expected) throw new Error(`Referenced evidence is corrupt: ${path}`)
      size += file.size; if (size > 10 * 1024 ** 3) throw new Error('Backup exceeds 10 GiB')
      records.push(file)
    }
    if ((await lstat(databasePath)).size > 256 * 1024 * 1024) throw new Error('Backup database exceeds 256 MiB')
    const bytes = await readFile(databasePath)
    records.push({ path: 'control.sqlite', size: bytes.length, hash: digest(bytes) })
    const manifest = parseBackupManifest({ format: 'openape-pods-backup', version: 1, schema, createdAt: new Date().toISOString(), sourceRoot, files: records })
    await durableJSON(join(stage, 'backup.json'), manifest)
    await syncTree(stage); observe('publish'); await rename(stage, target); await syncDirectory(destination)
    return target
  }
  catch (error) { await removePackageTree(stage); throw error }
}
export async function restoreBackup(backup: string, parent: string, maximumSchema: number): Promise<string> {
  const sourceRoot = await realpath(backup)
  const manifestPath = join(sourceRoot, 'backup.json')
  const info = await lstat(manifestPath)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 32 * 1024 * 1024) throw new Error('Backup manifest is not a supported regular file')
  const manifest = parseBackupManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  if (manifest.schema > maximumSchema) throw new Error('This backup needs a newer application')
  assertSupportedSchema(manifest.schema)
  const id = randomUUID(); const stage = await privateTarget(parent, `.restore-${id}`); const target = join(await realpath(parent), id)
  try {
    for (const file of manifest.files) await copyVerified(sourceRoot, file.path, stage, file)
    const database = new DatabaseSync(join(stage, 'control.sqlite'))
    try {
      checkDatabase(database, manifest.schema)
      upgradeRestored(database, manifest.schema)
      assertIntegrity(database, true)
      const records = new Map(manifest.files.map(file => [file.path, file]))
      const names = new Set(records.keys())
      for (const hash of requiredBlobs(database)) {
        if (records.get(`blobs/${hash}`)?.hash !== hash) throw new Error('Backup omits referenced evidence')
      }
      for (const artifact of retainedArtifacts(database)) {
        const file = manifest.files.find(file => file.path === artifact.path)
        if (!file || file.hash !== artifact.hash || file.size !== artifact.size) throw new Error('Backup omits retained artifact evidence')
      }
      database.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;')
      database.exec('UPDATE pods SET lifecycle=\'paused\' WHERE lifecycle!=\'archived\'; UPDATE schedules SET enabled=0,error=\'Restored profile: review before enabling\'; DELETE FROM run_leases; DELETE FROM execution_domains; DELETE FROM validations; UPDATE resource_epochs SET epoch=epoch+1; UPDATE resources SET state=\'refreshRequired\',revision=revision+1 WHERE state!=\'revoked\'; UPDATE connections SET state=\'revoked\',error=\'Restored profile: reconnect\',metadata=\'{}\'; UPDATE onboarding SET complete=0; UPDATE master_actions SET state=\'interrupted\',error=\'Restored action requires inspection\' WHERE state=\'running\'; UPDATE master_messages SET state=\'interrupted\' WHERE state=\'streaming\'; UPDATE runs SET state=\'interrupted\',error=\'Restored run requires inspection\' WHERE state=\'running\'; UPDATE accepted_events SET state=\'blocked\',error=\'Restored input requires review\' WHERE state IN (\'pending\',\'claimed\');')
      for (const row of database.prepare('SELECT * FROM snapshot_sets').all()) {
        if (!uuid(row.id as string) || !uuid(row.pod_id as string)) throw new Error('Invalid restored snapshot identity')
        const snapshot = JSON.parse(row.manifest as string) as { id: string, files: { id: string, content: string, hash: string }[] }
        if (!Array.isArray(snapshot.files) || snapshot.files.length > 100) throw new Error('Invalid restored snapshot files')
        for (const file of snapshot.files) {
          if (!uuid(file.id)) throw new Error('Invalid restored snapshot file identity')
          const path = `snapshots/${row.pod_id}/${row.id}/${file.id}`
          if (!names.has(path) || manifest.files.find(item => item.path === path)?.hash !== file.hash) throw new Error('Backup omits a retained reference snapshot')
          await chmod(join(stage, path), 0o400)
          file.content = join(target, path)
        }
        database.prepare('UPDATE snapshot_sets SET manifest=? WHERE id=?').run(JSON.stringify(snapshot), row.id as string)
        const directory = join(stage, 'snapshots', row.pod_id as string, row.id as string); await mkdir(directory, { recursive: true, mode: 0o700 })
        await rm(join(directory, 'manifest.json'), { force: true }); await durableJSON(join(directory, 'manifest.json'), snapshot, 0o400)
      }
      // Imported assets are references into this profile's own Pod storage and move with it.
      database.prepare('UPDATE resources SET configuration=json_set(configuration,\'$.path\',?1||substr(json_extract(configuration,\'$.path\'),length(?2)+1)) WHERE kind=\'reference\' AND substr(json_extract(configuration,\'$.path\'),1,length(?2))=?2').run(join(target, 'pods/'), `${manifest.sourceRoot}/pods/`)
      // Package archives are not part of a backup; an unfinished import restarts from its file.
      database.exec('DELETE FROM portable_import_pods WHERE import_id IN (SELECT id FROM portable_imports WHERE state=\'staged\'); UPDATE portable_imports SET archive_hash=NULL,error=\'Restored profile: import the package again\',state=CASE state WHEN \'staged\' THEN \'cancelled\' ELSE state END,revision=revision+1 WHERE state IN (\'staged\',\'committed\');')
      database.exec('UPDATE definition_instance_requests SET state=\'failed\',error=\'Restored instance: recover its existing identity on desktop before retrying\';')
      database.exec('DELETE FROM run_deletion_jobs;')
      database.exec('UPDATE remote_pods SET phase=\'needs_desktop_action\',error=\'Restored profile: original agent credentials must be recovered on desktop\'; DELETE FROM remote_registration;')
      database.exec('DELETE FROM dependency_domains;')
      for (const row of database.prepare('SELECT * FROM dependency_sets').all()) {
        if (!uuid(row.pod_id as string) || !/^[a-f0-9]{64}$/.test(row.hash as string)) throw new Error('Invalid dependency set identity')
        const path = join(stage, 'dependencies', row.pod_id as string, row.hash as string)
        const contents = await packageFiles(path, true)
        if (packageDigest(contents) !== row.hash || JSON.stringify(contents) !== row.files) throw new Error('Backup omits prepared dependencies')
        checkLock(JSON.parse(await readFile(join(path, 'package-lock.json'), 'utf8')), parsePackages(JSON.parse(row.manifest as string)))
      }
      database.exec('DELETE FROM summary_domains; UPDATE pod_descriptions SET state=\'failed\',error=\'Restored description update; reconnect and retry.\' WHERE state IN (\'pending\',\'running\');')
      database.exec('UPDATE master_contexts SET thread_id=NULL,state=\'interrupted\',error=\'Restored chat history; new model context required\';')
      database.exec('DELETE FROM script_credential_approvals;')
      database.exec('DELETE FROM deletion_jobs; UPDATE data_settings SET used_bytes=0,error=NULL;')
      restoreNetworkStorage(database)
      database.exec('COMMIT;')
    }
    finally { database.close() }
    await syncTree(stage); await rename(stage, target); await syncDirectory(await realpath(parent)); return target
  }
  catch (error) { await removePackageTree(stage); throw error }
}
