import { credentialAliases, parseCredentialAlias } from '../../contracts/credentials'
import { parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from './registry'
import type { PodResource } from '../../contracts/resources'

export class ScriptCredentials {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) {}
  assigned(podId: string, value: string): PodResource {
    const alias = parseCredentialAlias(value)
    const resource = this.resources.list(podId).find(resource => resource.kind === 'credential' && resource.state === 'ready' && resource.configuration.alias === alias)
    if (!resource || typeof resource.configuration.credentialId !== 'string' || !/^[a-f0-9-]{36}$/.test(resource.configuration.credentialId)) throw new Error('Credential is missing, revoked or requires reassignment')
    return resource
  }

  required(podId: string, capabilities: string[]): PodResource[] { return credentialAliases(capabilities).map(alias => this.assigned(podId, alias)) }
  approved(podId: string, hash: string): boolean {
    const pod = this.store.getPod(podId)
    return !!this.store.db.prepare('SELECT 1 FROM script_credential_approvals WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, hash, pod.revision, this.resources.epoch(podId))
  }

  assertApproved(podId: string, hash: string, capabilities: string[]): void {
    if (!credentialAliases(capabilities).length) return
    this.required(podId, capabilities)
    if (!this.approved(podId, hash)) throw new Error('Approve credential access for this exact script version and current resources before activation or execution')
  }

  approve(podId: string, hash: string, revision: number, epoch: number): void {
    this.store.transaction(() => {
      const pod = this.store.getPod(podId)
      if (pod.lifecycle === 'archived' || pod.revision !== revision || this.resources.epoch(podId) !== epoch) throw new Error('Pod or resources changed during credential review')
      const row = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, hash)
      if (!row || !this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, hash, revision, epoch)) throw new Error('Validate this script before reviewing credential access')
      const manifest = parseManifest(JSON.parse(row.manifest as string))
      if (manifest.assignmentRevision !== revision || !this.required(podId, manifest.capabilities).length) throw new Error('This script has no assigned credential capability to approve')
      this.store.readBlob(hash)
      this.store.db.prepare('INSERT OR REPLACE INTO script_credential_approvals VALUES(?,?,?,?)').run(podId, hash, revision, epoch)
    })
  }
}
