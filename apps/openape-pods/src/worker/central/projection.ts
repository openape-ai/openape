import { jevAvailability } from '../onboarding/store'
import type { Owner } from '@openape/pods-protocol'
import { sameOwner } from '@openape/pods-protocol'
import { centralMaxBytes, centralTables, parseCentralSnapshot } from '../../contracts/central'
import type { CentralSnapshot } from '../../contracts/central'
import type { PodDatabase } from '../storage/database'
import { schemaVersion } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { ScriptWorkspace } from '../workspace/scripts'
import type { RunDispatcher } from '../runs/dispatcher'
import type { Scheduler } from '../scheduling/scheduler'
import { WorkspaceDetails } from '../workspace/details'
import { PodGroups } from '../workspace/groups'
import { PodVariables } from '../resources/variables'

export class CentralProjection {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly scripts: ScriptWorkspace, private readonly runs: RunDispatcher, private readonly scheduler: Scheduler) {}

  snapshot(owner: Owner): CentralSnapshot {
    const result = this.store.transaction(() => {
      const pods = this.store.listPods()
      for (const pod of pods) {
        const binding = this.store.db.prepare('SELECT owner FROM remote_pods WHERE pod_id=?').get(pod.id)
        if (!binding || !sameOwner(JSON.parse(String(binding.owner)), owner)) throw new Error('Every Pod must belong to the connected owner before adopting this workspace')
      }
      const tables = Object.fromEntries(centralTables.map(table => [table, this.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
      const details = new WorkspaceDetails(this.store, this.resources)
      return {
        version: 1 as const, workspace: { jev: jevAvailability(this.store), pods, organization: new PodGroups(this.store).view() }, archive: { schema: schemaVersion, tables }, artifacts: [],
        pods: pods.map((pod) => {
          const scripts = this.scripts.view(pod.id)
          const { timing: _timing, ...runs } = this.runs.view(pod.id)
          return {
            id: pod.id, ready: true, details: details.execute({ type: 'list', podId: pod.id }), scripts, runs,
            scheduling: this.scheduler.view(pod.id), resources: { jev: jevAvailability(this.store), resources: this.resources.list(pod.id), variables: new PodVariables(this.store).list(pod.id), epoch: this.resources.epoch(pod.id) },
            versions: Object.fromEntries([...scripts.versions.map(version => ({ kind: 'version' as const, id: version.hash })), ...scripts.drafts.map(draft => ({ kind: 'draft' as const, id: draft.id }))].map(selection => [selection.id, this.scripts.view(pod.id, selection)])),
            history: Object.fromEntries(runs.runs.map(run => [run.id, { runs: [run], events: this.runs.runs.recentEvents(pod.id, run.id) }])),
          }
        }),
      }
    })
    if (Buffer.byteLength(JSON.stringify(result)) > centralMaxBytes) throw new Error('Workspace exceeds the central snapshot limit; review retention before connecting')
    return parseCentralSnapshot(result)
  }
}
