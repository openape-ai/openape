import type { CentralRuntime } from '../../contracts/central'

type Pod = CentralRuntime['workspace']['pods'][number]
export interface Connection { failures: number, since: number | null, error: string }
export const connected: Connection = { failures: 0, since: null, error: '' }
export const offlineAfterFailures = 3

// One failed read is a hiccup; only repeated failures mean the workspace is unreachable.
export function connectionAfter(previous: Connection, error: string | null, now: number): Connection {
  if (error === null) return connected
  return { failures: previous.failures + 1, since: previous.since ?? now, error }
}

export function connectionLevel(connection: Connection): 'online' | 'reconnecting' | 'offline' {
  if (!connection.failures) return 'online'
  return connection.failures < offlineAfterFailures ? 'reconnecting' : 'offline'
}

export function sidebar(host: CentralRuntime): { groups: { id: string, name: string, pods: Pod[] }[], archived: Pod[] } {
  const active = host.workspace.pods.filter(pod => pod.lifecycle !== 'archived')
  const groups = host.workspace.organization.groups.map(group => ({ id: group.id, name: group.name, pods: active.filter(pod => group.podIds.includes(pod.id)) }))
  const ungrouped = active.filter(pod => !host.workspace.organization.groups.some(group => group.podIds.includes(pod.id)))
  return { groups: [...groups, { id: '', name: '', pods: ungrouped }].filter(group => group.pods.length), archived: host.workspace.pods.filter(pod => pod.lifecycle === 'archived') }
}
