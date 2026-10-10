import { networkBrowserMutationAllowed } from '../../contracts/central-networks'
import type { CentralCommand } from '../../contracts/central'
import { commandPodIds } from '../../contracts/central'
import type { PodDatabase } from '../storage/database'
import { privatePods } from './projection-policy'

export { privatePods }

export function podNetwork(store: PodDatabase, podId: string): string | null {
  return store.db.prepare(`SELECT network_id FROM network_members WHERE pod_id=? UNION SELECT network_id FROM network_invocations WHERE pod_id=? LIMIT 1`).get(podId, podId)?.network_id as string | undefined ?? null
}

export function assertNetworkBrowserCommand(store: PodDatabase, command: CentralCommand): void {
  if (networkBrowserMutationAllowed(command)) return
  const targets = commandPodIds(command, { workspace: { pods: store.listPods() } })
  if (targets.some(id => podNetwork(store, id))) throw new Error('Network member changes require desktop review')
}
