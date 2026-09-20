import { removePackageTree } from '../dependencies/store'
import { lstat, readdir, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'
import type { DataView } from '../../contracts/data'
import { assertDataIdle } from './backup'
import { confirmDomainsStopped } from '../recovery/domains'
import { storageBytes } from './files'

export interface DeletionJob { podId: string, runIds: string[], keyIds: string[] }
const validId = (value: string) => /^[a-f0-9-]{36}$/.test(value)
export class DataRetention {
  constructor(private readonly store: PodDatabase, private readonly helper: string) {}
  async view(): Promise<DataView> {
    let usedBytes = 0
    for (const directory of ['blobs', 'pods', 'snapshots', 'runs', 'dependencies', 'dependency-staging']) {
      usedBytes += await storageBytes(join(this.store.root, directory))
    }
    for (const name of ['control.sqlite', 'control.sqlite-wal']) {
      try { usedBytes += (await lstat(join(this.store.root, name))).size }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const disk = await statfs(this.store.root); const limitBytes = this.store.db.prepare('SELECT limit_bytes FROM data_settings WHERE id=1').get()!.limit_bytes as number
    const view: DataView = { usedBytes, freeBytes: disk.bavail * disk.bsize, limitBytes, pendingDeletion: this.jobs().length, busy: !!this.store.db.prepare('SELECT 1 FROM program_leases UNION ALL SELECT 1 FROM run_leases UNION ALL SELECT 1 FROM master_session WHERE state=\'running\' UNION ALL SELECT 1 FROM master_actions WHERE state=\'running\' LIMIT 1').get(), error: usedBytes >= limitBytes ? 'Storage limit reached. Export a backup and remove unused data before continuing.' : disk.bavail * disk.bsize < 256 * 1024 * 1024 ? 'Less than 256 MiB free disk space remains. Free space before continuing.' : this.store.db.prepare('SELECT error FROM deletion_jobs WHERE error IS NOT NULL LIMIT 1').get()?.error as string | null ?? null }
    this.store.db.prepare('UPDATE data_settings SET used_bytes=?,error=? WHERE id=1').run(usedBytes, usedBytes >= limitBytes || view.freeBytes < 256 * 1024 * 1024 ? view.error : null)
    return view
  }

  limit(bytes: number): void { this.store.db.prepare('UPDATE data_settings SET limit_bytes=? WHERE id=1').run(bytes) }
  jobs(): DeletionJob[] {
    return this.store.db.prepare('SELECT * FROM deletion_jobs').all().map((row) => {
      const job = JSON.parse(row.payload as string) as DeletionJob
      if (job.podId !== row.pod_id || !validId(job.podId) || !Array.isArray(job.runIds) || !Array.isArray(job.keyIds) || [...job.runIds, ...job.keyIds].some(id => !validId(id))) throw new Error('Invalid pending deletion record')
      return job
    })
  }

  async deletePod(podId: string, revision: number, name: string): Promise<void> {
    assertDataIdle(this.store)
    if (this.store.db.prepare('SELECT 1 FROM workflow_members WHERE pod_id=? UNION ALL SELECT 1 FROM workflow_nodes WHERE pod_id=? LIMIT 1').get(podId, podId)) throw new Error('Pod is referenced by workflow configuration or history')
    const pod = this.store.getPod(podId)
    if (pod.lifecycle !== 'archived' || pod.revision !== revision || pod.name !== name) throw new Error('Archive and review the current pod before deleting it')
    const runIds = this.store.db.prepare('SELECT id FROM runs WHERE pod_id=?').all(podId).map(row => row.id as string)
    if (runIds.some(id => !validId(id))) throw new Error('Invalid run identity')
    for (const id of runIds) await confirmDomainsStopped(this.store, id, this.helper)
    const keyIds = this.store.db.prepare('SELECT configuration FROM resources WHERE pod_id=? AND kind=\'connection\'').all(podId).flatMap((row) => {
      const config = JSON.parse(row.configuration as string) as { identity?: { connectionId?: string, podId?: string } }
      if (!config.identity) return []
      if (config.identity.podId !== podId || !config.identity.connectionId || !validId(config.identity.connectionId)) throw new Error('Invalid pod key binding')
      return [config.identity.connectionId]
    })
    for (const row of this.store.db.prepare('SELECT configuration FROM resources WHERE pod_id=? AND (kind=\'credential\' OR json_extract(configuration,\'$.type\')=\'program\')').all(podId)) {
      const config = JSON.parse(row.configuration as string) as { credentialId?: string, stateId?: string }; const id = config.credentialId ?? config.stateId
      if (!id || !validId(id)) throw new Error('Invalid credential deletion binding')
      keyIds.push(id)
    }
    this.store.transaction(() => {
      const current = this.store.getPod(podId)
      if (current.revision !== revision || current.lifecycle !== 'archived' || current.name !== name) throw new Error('Pod changed during deletion review')
      this.store.db.prepare('INSERT INTO deletion_jobs VALUES(?,?,NULL)').run(podId, JSON.stringify({ podId, runIds, keyIds: [...new Set(keyIds)] }))
      for (const table of ['run_events', 'run_inputs', 'execution_domains', 'recovery_reviews']) this.store.db.prepare(`DELETE FROM ${table} WHERE run_id IN (SELECT id FROM runs WHERE pod_id=?)`).run(podId)
      for (const table of ['script_dependencies', 'dependency_sets', 'program_leases', 'run_leases', 'effect_ledger', 'runs', 'validations', 'scripts', 'assignments', 'checkpoints', 'claims', 'sources', 'mail_inventory', 'mail_items', 'mail_receipts', 'mail_extractions', 'mail_contexts', 'source_derivations', 'resources', 'resource_epochs', 'snapshot_sets', 'schedules', 'accepted_events', 'reference_observations', 'script_drafts', 'access_proposals']) this.store.db.prepare(`DELETE FROM ${table} WHERE pod_id=?`).run(podId)
      this.store.db.prepare('UPDATE master_contexts SET thread_id=NULL,state=\'interrupted\',error=\'Referenced Pod was deleted\' WHERE scope=?').run(podId)
      this.store.db.prepare('DELETE FROM pods WHERE id=?').run(podId)
    })
    await this.cleanup()
  }

  async cleanDeletedFiles(): Promise<void> {
    for (const job of this.jobs()) {
      try {
        await removePackageTree(join(this.store.root, 'dependencies', job.podId))
        await rm(join(this.store.root, 'shell-launchers', job.podId), { recursive: true, force: true })
        await rm(join(this.store.root, 'pods', job.podId), { recursive: true, force: true })
        await rm(join(this.store.root, 'snapshots', job.podId), { recursive: true, force: true })
        for (const id of job.runIds) await rm(join(this.store.root, 'runs', id), { recursive: true, force: true })
        this.store.db.prepare('UPDATE deletion_jobs SET error=NULL WHERE pod_id=?').run(job.podId)
      }
      catch (error) { const message = error instanceof Error ? error.message : 'Local deletion failed'; this.store.db.prepare('UPDATE deletion_jobs SET error=? WHERE pod_id=?').run(message, job.podId); throw error }
    }
  }

  finishDeletion(podId: string): void { this.store.db.prepare('DELETE FROM deletion_jobs WHERE pod_id=? AND error IS NULL').run(podId) }
  async cleanup(): Promise<void> {
    assertDataIdle(this.store); await this.cleanDeletedFiles()
    const retained = new Set(this.store.db.prepare('SELECT hash FROM sources UNION SELECT hash FROM scripts').all().map(row => row.hash as string))
    for (const name of await readdir(this.store.blobs)) {
      if ((/^[a-f0-9]{64}$/.test(name) && !retained.has(name)) || /^\.stage-[a-f0-9-]{36}$/.test(name)) await rm(join(this.store.blobs, name), { force: true })
    }
    const snapshots = new Set(this.store.db.prepare('SELECT pod_id,id FROM snapshot_sets').all().map(row => `${row.pod_id}/${row.id}`))
    let pods: string[] = []
    try { pods = await readdir(join(this.store.root, 'snapshots')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    for (const podId of pods) {
      if (!validId(podId)) throw new Error('Invalid snapshot directory')
      const root = join(this.store.root, 'snapshots', podId)
      if (!(await lstat(root)).isDirectory()) throw new Error('Unsupported snapshot directory')
      for (const id of await readdir(root)) {
        if ((validId(id) && !snapshots.has(`${podId}/${id}`)) || /^\.stage-[a-f0-9-]{36}$/.test(id)) await rm(join(root, id), { recursive: true, force: true })
      }
    }
  }
}
