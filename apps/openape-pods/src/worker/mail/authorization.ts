import { parseServiceScope } from '../../contracts/services'
import type { ServiceCheck } from '../../contracts/services'
import type { ResourceState } from '../../contracts/resources'
import { parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { RunStore } from '../runs/store'

export function authorizeMailService(store: PodDatabase, registry: ResourceRegistry, runs: RunStore, check: ServiceCheck): ResourceState {
  const scope = parseServiceScope(check.scope)
  runs.assertLease(scope.runId)
  const run = runs.get(scope.runId)
  const revision = store.db.prepare('SELECT assignment_revision FROM runs WHERE id=?').get(scope.runId)?.assignment_revision
  if (run.podId !== scope.podId || store.getPod(scope.podId).revision !== scope.assignmentRevision || revision !== scope.assignmentRevision) throw new Error('Service assignment changed')
  registry.assertCurrent(scope.podId, scope.epoch)
  const row = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(scope.podId, run.scriptHash)
  if (!row) throw new Error('Pinned service script is missing')
  const manifest = parseManifest(JSON.parse(row.manifest as string))
  if (!scope.capabilities.includes('mail.read') || JSON.stringify(manifest.capabilities) !== JSON.stringify(scope.capabilities)) throw new Error('Service capability is not declared by the pinned script')
  if (check.domain) runs.registerDomain(scope.runId, check.domain.path, check.domain.ownerPid)
  return { resources: registry.list(scope.podId), epoch: registry.epoch(scope.podId) }
}
