import type { ConnectionView, MailSetup } from '../../contracts/onboarding'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { PodIdentityReference } from '../../main/connections/agent'
import type { MailAssignment } from '../../main/mail/service'
import { OnboardingStore } from './store'

export type SetupInternal = { type: 'list' } | { type: 'save', connection: Omit<ConnectionView, 'login'>, metadata: Record<string, unknown> } | { type: 'metadata', id: string } | { type: 'finish' } | { type: 'revoke', id: string } | { type: 'assign', setup: MailSetup, identity: PodIdentityReference, grants: MailAssignment['grants'] }
export class SetupControl {
  readonly connections: OnboardingStore
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) { this.connections = new OnboardingStore(store) }
  execute(command: SetupInternal): unknown {
    if (command.type === 'save') this.connections.save(command.connection, command.metadata)
    if (command.type === 'metadata') return this.connections.metadata(command.id)
    if (command.type === 'finish') this.connections.finish()
    if (command.type === 'revoke') {
      for (const pod of this.store.listPods()) {
        for (const resource of this.resources.list(pod.id)) {
          if (resource.state !== 'revoked' && [resource.configuration.connectionId, resource.configuration.ownerConnection].includes(command.id)) this.resources.revoke(pod.id, resource.id, resource.revision)
        }
      }
    }
    if (command.type === 'assign') {
      const { setup, identity, grants } = command
      const pod = this.store.getPod(setup.podId)
      if (pod.revision !== setup.revision || pod.lifecycle === 'archived' || identity.podId !== pod.id) throw new Error('Pod changed during permission review; inspect and retry')
      const connections = this.connections.connections()
      if (!connections.some(item => item.id === setup.mailConnection && item.provider === 'microsoft' && item.account === setup.account && item.state === 'ready') || !connections.some(item => item.id === setup.ownerConnection && item.provider === 'openape' && item.state === 'ready' && item.account === identity.owner)) throw new Error('Connection changed during permission review')
      this.resources.replaceMail(pod.id, [
        { kind: 'connection', name: 'OpenApe pod agent', configuration: { provider: 'openape', identity, ownerConnection: setup.ownerConnection } },
        { kind: 'connection', name: setup.account, configuration: { provider: 'microsoft', account: setup.account, connectionId: setup.mailConnection } },
        { kind: 'tool', name: 'Read-only Microsoft mail', configuration: { capability: 'mail.read', account: setup.account, connectionId: setup.mailConnection, folders: setup.folders.map(folder => folder.id), folderNames: setup.folders, since: setup.since, attachments: setup.attachments, grants } },
      ])
    }
    return { connections: this.connections.connections(), complete: this.connections.complete() }
  }
}
