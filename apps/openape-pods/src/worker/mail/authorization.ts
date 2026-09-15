import { ScriptCredentials } from '../resources/script-credentials'
import { parseCredentialAlias } from '../../contracts/credentials'
import type { MailRead, MailScope } from '../../main/mail/contract'
import { parseServiceScope } from '../../contracts/services'
import type { ServiceCheck } from '../../contracts/services'
import type { ResourceState } from '../../contracts/resources'
import { parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { RunStore } from '../runs/store'

export function authorizeRunService(store: PodDatabase, registry: ResourceRegistry, runs: RunStore, check: ServiceCheck): ResourceState {
  const scope = parseServiceScope(check.scope)
  runs.assertLease(scope.runId)
  const run = runs.get(scope.runId)
  const revision = store.db.prepare('SELECT assignment_revision FROM runs WHERE id=?').get(scope.runId)?.assignment_revision
  if (run.podId !== scope.podId || store.getPod(scope.podId).bindingRevision !== scope.assignmentRevision || revision !== scope.assignmentRevision) throw new Error('Service binding changed')
  registry.assertCurrent(scope.podId, scope.epoch)
  const row = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(scope.podId, run.scriptHash)
  if (!row) throw new Error('Pinned service script is missing')
  const manifest = parseManifest(JSON.parse(row.manifest as string))
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(scope.capabilities)) throw new Error('Service capability is not declared by the pinned script')
  if (check.domain) runs.registerDomain(scope.runId, check.domain.path, check.domain.ownerPid)
  return { resources: registry.list(scope.podId), epoch: registry.epoch(scope.podId) }
}

export function authorizeMailService(store: PodDatabase, registry: ResourceRegistry, runs: RunStore, check: ServiceCheck): ResourceState {
  const state = authorizeRunService(store, registry, runs, check)
  if (!check.scope.capabilities.includes('mail.read')) throw new Error('Service capability is not declared by the pinned script')
  return state
}
export function authorizeCredentialService(store: PodDatabase, registry: ResourceRegistry, runs: RunStore, check: ServiceCheck, value: string): string {
  const alias = parseCredentialAlias(value)
  authorizeRunService(store, registry, runs, check)
  const { scope } = check
  if (!scope.capabilities.includes(`credential.${alias}`)) throw new Error('Credential capability is not declared by this script')
  const authority = new ScriptCredentials(store, registry)
  authority.assertApproved(scope.podId, runs.get(scope.runId).scriptHash, scope.capabilities)
  return authority.assigned(scope.podId, alias).configuration.credentialId as string
}

export function assertMailHistory(store: PodDatabase, podId: string, scope: MailScope, read: MailRead): void {
  if (!scope.since || read.operation === 'messages') return
  const parent = store.db.prepare('SELECT 1 FROM mail_items WHERE pod_id=? AND account=? AND folder=? AND id=? AND julianday(json_extract(metadata,\'$.receivedAt\'))>=julianday(?)').get(podId, scope.account, read.folder, read.message!, scope.since)
  if (!parent) throw new Error('Attachment parent has not been observed within the assigned mail history')
}
