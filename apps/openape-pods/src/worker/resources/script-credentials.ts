import { parseCredentialAlias } from '../../contracts/credentials'
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

  approved(podId: string, hash: string): boolean {
    return !!this.store.db.prepare('SELECT 1 FROM scripts WHERE pod_id=? AND hash=?').get(podId, hash)
  }

  approve(podId: string, hash: string, revision: number, epoch: number): void {
    this.store.transaction(() => {
      const pod = this.store.getPod(podId)
      if (pod.lifecycle === 'archived' || pod.revision !== revision || this.resources.epoch(podId) !== epoch) throw new Error('Pod or resources changed during credential review')
      const row = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, hash)
      if (!row || !this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, hash, pod.bindingRevision, epoch)) throw new Error('Validate this script before reviewing credential access')
      const manifest = parseManifest(JSON.parse(row.manifest as string))
      if (manifest.assignmentRevision !== pod.bindingRevision) throw new Error('Script binding changed; save a new draft revision')
      this.store.readBlob(hash)
    })
  }
}
