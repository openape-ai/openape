import { privatePods } from './projection-policy'
import { jevAvailability } from '../onboarding/store'
import type { Owner } from '@openape/pods-protocol'
import { sameOwner } from '@openape/pods-protocol'
import { centralMaxBytes, legacyOrganization, parseCentralSnapshot } from '../../contracts/central'
import type { CentralSnapshot } from '../../contracts/central'
import type { PodDatabase } from '../storage/database'
import { schemaVersion } from '../storage/database'
import { ItemTagStore } from '../workspace/item-tags'
import type { ResourceRegistry } from '../resources/registry'
import type { ScriptWorkspace } from '../workspace/scripts'
import type { RunDispatcher } from '../runs/dispatcher'
import type { Scheduler } from '../scheduling/scheduler'
import { WorkspaceDetails } from '../workspace/details'
import { listedPods } from '../workspace/pod-list'
import { mapView } from '../workspace/map-view'
import { PodVariables } from '../resources/variables'

export class CentralProjection {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly scripts: ScriptWorkspace, private readonly runs: RunDispatcher, private readonly scheduler: Scheduler) {}

  assertOwner(owner: Owner): void {
    for (const pod of this.store.listPods()) {
      const binding = this.store.db.prepare('SELECT owner FROM remote_pods WHERE pod_id=?').get(pod.id)
      if (!binding || !sameOwner(JSON.parse(String(binding.owner)), owner)) throw new Error('Every Pod must belong to the connected owner before adopting this workspace')
    }
  }

  snapshot(owner: Owner): CentralSnapshot {
    const result = this.store.transaction(() => {
      const pods = listedPods(this.store)
      this.assertOwner(owner)
      const details = new WorkspaceDetails(this.store, this.resources)
      const blobs = this.store.db.prepare(`SELECT pod_id AS podId,hash FROM scripts WHERE pod_id NOT IN (${privatePods}) UNION SELECT pod_id,hash FROM sources WHERE pod_id NOT IN (${privatePods}) ORDER BY 1,2`).all() as { podId: string, hash: string }[]
      return {
        version: 1 as const, schema: schemaVersion, workspace: { jev: jevAvailability(this.store), pods, organization: legacyOrganization, tags: new ItemTagStore(this.store).view(), map: mapView(this.store, Date.now(), true) }, artifacts: [], blobs,
        pods: pods.map((pod) => {
          if (this.store.db.prepare('SELECT 1 FROM local_only_pods WHERE pod_id=?').get(pod.id)) {
            return {
              id: pod.id, localOnly: true as const, ready: true,
              details: { claims: [], counts: { finding: 0, question: 0, gap: 0 }, total: 0, versions: [], checkpointRevision: 0, source: null },
              scripts: { pod, resourceEpoch: this.resources.epoch(pod.id), credentialAliases: [], versions: [], drafts: [], source: null },
              resources: { resources: [], variables: [], epoch: this.resources.epoch(pod.id) },
              scheduling: { spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: this.scheduler.view(pod.id).concurrency },
              runs: { runs: [], events: [] }, versions: {}, history: {},
            }
          }
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
