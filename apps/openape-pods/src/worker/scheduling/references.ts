import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { createSnapshotSet } from '../resources/snapshots'
import type { Scheduler } from './scheduler'

export class ReferenceWatcher {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly scheduler: Scheduler, private readonly helper: string) {}

  async scan(): Promise<void> {
    for (const pod of this.store.listPods().filter(candidate => candidate.lifecycle === 'active')) {
      for (const resource of this.resources.list(pod.id).filter(candidate => candidate.kind === 'reference' && candidate.state === 'ready')) {
        const directory = await mkdtemp(join(this.store.root, 'reference-scan-'))
        try {
          const epoch = this.resources.epoch(pod.id)
          const snapshot = await createSnapshotSet(this.helper, directory, [{ id: resource.id, revision: resource.revision, path: resource.configuration.path as string }])
          this.resources.assertCurrent(pod.id, epoch)
          const file = snapshot.files[0]!
          this.store.transaction(() => {
            const previous = this.store.db.prepare('SELECT * FROM reference_observations WHERE pod_id=? AND resource_id=?').get(pod.id, resource.id)
            if (previous?.hash === file.hash && previous.revision === resource.revision) { this.store.db.prepare('UPDATE reference_observations SET error=NULL WHERE pod_id=? AND resource_id=?').run(pod.id, resource.id); return }
            const generation = (previous?.generation as number ?? 0) + 1
            this.scheduler.acceptEvent(pod.id, 'reference', `${resource.id}:${generation}`, { resourceId: resource.id, revision: resource.revision, hash: file.hash })
            this.store.db.prepare('INSERT INTO reference_observations VALUES(?,?,?,?,?,NULL) ON CONFLICT(pod_id,resource_id) DO UPDATE SET revision=excluded.revision,hash=excluded.hash,generation=excluded.generation,error=NULL').run(pod.id, resource.id, resource.revision, file.hash, generation)
          })
        }
        catch (error) {
          this.store.db.prepare('INSERT INTO reference_observations VALUES(?,?,?,\'\',0,?) ON CONFLICT(pod_id,resource_id) DO UPDATE SET error=excluded.error').run(pod.id, resource.id, resource.revision, error instanceof Error ? error.message : 'Reference scan failed')
        }
        finally { await rm(directory, { recursive: true, force: true }) }
      }
    }
  }
}
