import type { ConnectionView } from '../../contracts/onboarding'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { OnboardingStore } from './store'
import { reconcileAccounts, revokeConnectionUse } from './reconcile'

export type SetupInternal = { type: 'list' } | { type: 'reconcile' } | { type: 'save', connection: Omit<ConnectionView, 'login'>, metadata: Record<string, unknown> } | { type: 'metadata', id: string } | { type: 'finish' } | { type: 'revoke', id: string }

export class SetupControl {
  readonly connections: OnboardingStore
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) { this.connections = new OnboardingStore(store) }
  execute(command: SetupInternal): unknown {
    if (!['list', 'reconcile', 'save', 'metadata', 'finish', 'revoke'].includes(command.type)) throw new Error('Unsupported setup command; assign external applications instead')
    if (command.type === 'reconcile') return reconcileAccounts(this.store, this.resources)
    if (command.type === 'save') this.connections.save(command.connection, command.metadata)
    if (command.type === 'metadata') return this.connections.metadata(command.id)
    if (command.type === 'finish') this.connections.finish()
    if (command.type === 'revoke') revokeConnectionUse(this.store, this.resources, command.id)
    return { connections: this.connections.connections(), owner: this.connections.owner(), complete: this.connections.complete() }
  }
}
