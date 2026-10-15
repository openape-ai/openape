import type { CentralCommand, CentralRuntime } from '../contracts/central'
import type { DomainCommand, DomainOverview } from '../contracts/domain-admin'
import type { PodsBridge } from '../contracts/ipc'
import type { MapView } from '../contracts/map-view'
import type { SecretsCommand, SecretsView } from '../contracts/secrets'

export interface WorkspaceSnapshot {
  map: MapView | null
  domain: DomainOverview | null
  codex: 'connected' | 'disconnected' | undefined
  secrets: SecretsView | null
  live: boolean
}

export interface WorkspaceAccess {
  desktop: boolean
  inboxUrl?: string
  read: () => Promise<WorkspaceSnapshot>
  command: (command: CentralCommand) => Promise<unknown>
  domain?: (command: DomainCommand) => Promise<unknown>
  secrets?: (command: SecretsCommand) => Promise<unknown>
}

export function localWorkspaceAccess(bridge: PodsBridge): WorkspaceAccess {
  let reads = 0
  let codex: WorkspaceSnapshot['codex']
  let secrets: SecretsView | null = null
  return {
    desktop: true,
    async read() {
      const [inventory, domain] = await Promise.all([bridge.workspace({ type: 'map' }), bridge.domain({ type: 'list' })])
      if (reads++ % 10 === 0) {
        const [connection, requests] = await Promise.all([bridge.codex({ type: 'status' }), bridge.secrets?.({ type: 'list' })])
        codex = connection.state === 'connected' ? 'connected' : 'disconnected'
        secrets = requests ?? null
      }
      return { map: inventory.map ?? null, domain: domain as DomainOverview, codex, secrets, live: true }
    },
    async command(command) {
      if (command.channel === 'workspace') return bridge.workspace(command.body as Parameters<PodsBridge['workspace']>[0])
      if (command.channel === 'scheduling') return bridge.scheduling(command.body as Parameters<PodsBridge['scheduling']>[0])
      if (command.channel === 'runs') return bridge.runs(command.body as Parameters<PodsBridge['runs']>[0])
      throw new Error(`Unsupported workspace channel: ${command.channel}`)
    },
    domain: command => bridge.domain(command),
    ...(bridge.secrets ? { secrets: async (command: SecretsCommand) => { secrets = await bridge.secrets!(command); return secrets } } : {}),
  }
}

export function browserWorkspaceAccess(runtime: () => CentralRuntime | undefined, command: (command: CentralCommand) => Promise<unknown>): WorkspaceAccess {
  return {
    desktop: false,
    inboxUrl: '/inbox/',
    async read() { return { map: runtime()?.workspace.map ?? null, domain: null, codex: undefined, secrets: null, live: !!runtime()?.online } },
    async command(request) {
      if (!runtime()?.online) throw new Error('Desktop offline')
      return command(request)
    },
  }
}
