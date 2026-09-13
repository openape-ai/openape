import type { PodResource } from '../../contracts/resources'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'
import { createSnapshotSet } from './snapshots'
import type { FileAssignment, SnapshotSet } from './snapshots'

export class ResourceRegistry {
  constructor(private readonly store: PodDatabase, private readonly revokeActive: (podId: string) => void) {}

  list(podId: string): PodResource[] {
    this.store.getPod(podId)
    return this.store.db.prepare('SELECT * FROM resources WHERE pod_id=? ORDER BY rowid').all(podId).map(row => ({ id: row.id as string, podId: row.pod_id as string, revision: row.revision as number, kind: row.kind as PodResource['kind'], state: row.state as PodResource['state'], name: row.name as string, configuration: JSON.parse(row.configuration as string) }))
  }

  epoch(podId: string): number {
    this.store.getPod(podId)
    return this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(podId)?.epoch as number ?? 0
  }

  private advance(podId: string): void {
    this.store.db.prepare('INSERT INTO resource_epochs VALUES(?,1) ON CONFLICT(pod_id) DO UPDATE SET epoch=epoch+1').run(podId)
  }

  assignReference(podId: string, name: string, path: string): PodResource {
    this.store.getPod(podId)
    if (!name.trim() || name.length > 255 || !path.startsWith('/') || /[\0\r\n]/.test(path)) throw new Error('Invalid reference assignment')
    const id = randomUUID()
    this.store.transaction(() => {
      this.store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(id, podId, 'reference', 'ready', name, JSON.stringify({ path }))
      this.advance(podId)
    })
    this.revokeActive(podId)
    return this.list(podId).find(resource => resource.id === id) as PodResource
  }

  revoke(podId: string, id: string, revision: number): void {
    this.store.transaction(() => {
      const result = this.store.db.prepare('UPDATE resources SET state=\'revoked\',revision=revision+1 WHERE pod_id=? AND id=? AND revision=? AND state!=\'revoked\'').run(podId, id, revision)
      if (result.changes !== 1) throw new Error('Stale or unavailable resource')
      this.advance(podId)
    })
    this.revokeActive(podId)
  }

  assertCurrent(podId: string, epoch: number): void {
    if (this.epoch(podId) !== epoch) throw new Error('Resource permissions changed; stop this run')
  }

  async capture(podId: string, helper: string): Promise<SnapshotSet> {
    const epoch = this.epoch(podId)
    const assigned = this.list(podId).filter(resource => resource.kind === 'reference' && resource.state === 'ready')
    const files: FileAssignment[] = assigned.map(resource => ({ id: resource.id, revision: resource.revision, path: resource.configuration.path as string }))
    const set = await createSnapshotSet(helper, join(this.store.root, 'snapshots', podId), files)
    this.store.transaction(() => {
      this.assertCurrent(podId, epoch)
      this.store.db.prepare('INSERT INTO snapshot_sets VALUES(?,?,?,?)').run(set.id, podId, epoch, JSON.stringify(set))
    })
    return set
  }
}
