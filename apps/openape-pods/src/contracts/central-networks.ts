import type { CentralCommand } from './central'
import { parseNetworkCommand, parseNetworkView } from './networks'
import type { NetworkCommand, NetworkView } from './networks'

export type CentralNetworkRead = Extract<NetworkCommand, { type: 'list' | 'detail' | 'trace' | 'records' }>
export const centralReadLimit = 2 * 1024 * 1024
export const centralReadLifetime = 20000

export function parseCentralNetworkRead(value: unknown): CentralNetworkRead {
  const command = parseNetworkCommand(value)
  if (!['list', 'detail', 'trace', 'records'].includes(command.type)) throw new Error('Unsupported network action: requires the local desktop')
  return command as CentralNetworkRead
}

export function parseCentralNetworkResult(value: unknown): NetworkView {
  if (new TextEncoder().encode(JSON.stringify(value)).length > centralReadLimit) throw new Error('Network response exceeds its read limit')
  const view = parseNetworkView(value)
  if (view.conversion || view.setup || view.preview || view.createdId || view.processId) throw new Error('Invalid read-only network response')
  if (view.gates) view.gates = view.gates.map(gate => ({ ...gate, url: null }))
  return view
}

export function networkBrowserMutationAllowed(command: CentralCommand): boolean {
  if (command.channel === 'workspace') return command.body.type === 'create'
  if (command.channel === 'runs') return command.body.type === 'cancel'
  return command.channel === 'scheduling' && command.body.type === 'lifecycle' && command.body.lifecycle === 'paused'
}

export function publicNetworkOverview(view: NetworkView): NetworkView {
  return { networks: view.networks.map(network => ({ ...network, health: {
    ...network.health,
    intakeError: network.health.intakeError === null ? null : 'Runtime needs attention',
    lastSchedulerError: network.health.lastSchedulerError === null ? null : 'Runtime needs attention',
    lastFailure: network.health.lastFailure === null ? null : { ...network.health.lastFailure, reason: 'Runtime needs attention' },
  } })) }
}
