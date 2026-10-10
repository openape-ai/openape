import { networkBrowserMutationAllowed } from '../../contracts/central-networks'
import type { CentralCommand } from '../../contracts/central'
import { commandPodIds, centralTables } from '../../contracts/central'
import type { PodDatabase } from '../storage/database'
import { privatePods } from './projection-policy'

export { privatePods }

type Policy = 'pod' | 'podId' | 'run' | 'public' | 'omit'
const policies = {
  pods: 'podId', remote_pods: 'pod', master_creations: 'pod', script_credential_approvals: 'pod', scripts: 'pod', checkpoints: 'pod', sources: 'pod', claims: 'pod', settings: 'omit', validations: 'pod', resources: 'pod', resource_epochs: 'pod',
  runs: 'pod', run_events: 'run', schedules: 'pod', accepted_events: 'pod', run_inputs: 'run', recovery_reviews: 'run', effect_ledger: 'pod',
  mail_inventory: 'pod', mail_items: 'pod', mail_receipts: 'pod', mail_contexts: 'pod', source_derivations: 'pod',
  master_messages: 'omit', script_drafts: 'pod', pod_organization: 'public', pod_groups: 'public', pod_memberships: 'public',
  pod_variables: 'pod', master_message_scopes: 'omit', pod_chat_origins: 'pod', pod_descriptions: 'pod', draft_packages: 'omit', dependency_sets: 'pod', script_dependencies: 'pod',
  chat_conversations: 'omit', chat_contexts: 'omit', chat_members: 'omit', chat_message_context: 'omit', control_runs: 'omit',
} as const satisfies Record<typeof centralTables[number], Policy>

const publicRuns = `SELECT id FROM runs WHERE pod_id NOT IN (${privatePods})`

export function networkPublicationTables(store: PodDatabase): Record<string, Record<string, unknown>[]> {
  const where: Record<Exclude<Policy, 'omit'>, string> = {
    pod: `pod_id NOT IN (${privatePods})`, podId: `id NOT IN (${privatePods})`, run: `run_id IN (${publicRuns})`, public: '1',
  }
  return Object.fromEntries(centralTables.map((table) => {
    const policy: Policy | undefined = policies[table]
    if (!policy) throw new Error(`Unclassified publication table: ${table}`)
    return [table, policy === 'omit' ? [] : store.db.prepare(`SELECT * FROM ${table} WHERE ${where[policy]} ORDER BY rowid`).all()]
  }))
}

export function podNetwork(store: PodDatabase, podId: string): string | null {
  return store.db.prepare(`SELECT network_id FROM network_members WHERE pod_id=? UNION SELECT network_id FROM network_invocations WHERE pod_id=? LIMIT 1`).get(podId, podId)?.network_id as string | undefined ?? null
}

export function assertNetworkBrowserCommand(store: PodDatabase, command: CentralCommand): void {
  if (networkBrowserMutationAllowed(command)) return
  const targets = commandPodIds(command, { workspace: { pods: store.listPods() } })
  if (targets.some(id => podNetwork(store, id))) throw new Error('Network member changes require desktop review')
}
