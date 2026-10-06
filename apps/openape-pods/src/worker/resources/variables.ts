import type { PodVariable } from '../../contracts/resources'
import { parseVariable } from '../../contracts/resources'
import type { PodDatabase } from '../storage/database'

export class PodVariables {
  constructor(private readonly store: PodDatabase) {}
  list(podId: string): PodVariable[] {
    this.store.getPod(podId)
    return this.store.db.prepare('SELECT name,value,revision FROM pod_variables WHERE pod_id=? ORDER BY name').all(podId) as unknown as PodVariable[]
  }

  values(podId: string): Record<string, string> { return Object.fromEntries(this.list(podId).map(item => [item.name, item.value])) }

  save(podId: string, name: string, value: string, revision: number): void {
    parseVariable({ name, value, revision })
    this.store.transaction(() => {
      if (this.store.getPod(podId).lifecycle === 'archived') throw new Error('Archived pod cannot be configured')
      const current = this.list(podId)
      if ((current.find(item => item.name === name)?.revision ?? 0) !== revision) throw new Error('Variable changed; reload before saving')
      if (!revision && current.length >= 32) throw new Error('A pod supports at most 32 variables')
      this.store.db.prepare('INSERT INTO pod_variables VALUES(?,?,?,?) ON CONFLICT(pod_id,name) DO UPDATE SET value=excluded.value,revision=excluded.revision').run(podId, name, value, revision + 1)
    })
  }

  remove(podId: string, name: string, revision: number): void {
    if (this.store.getPod(podId).lifecycle === 'archived') throw new Error('Archived pod cannot be configured')
    if (this.store.db.prepare('DELETE FROM pod_variables WHERE pod_id=? AND name=? AND revision=?').run(podId, name, revision).changes !== 1) throw new Error('Variable changed; reload before deleting')
  }
}
