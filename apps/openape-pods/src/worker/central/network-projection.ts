import { networkBrowserMutationAllowed } from '../../contracts/central-networks'
import type { CentralCommand } from '../../contracts/central'
import { commandPodIds, centralTables } from '../../contracts/central'
import type { PodDatabase } from '../storage/database'

type Policy = 'pod' | 'podId' | 'run' | 'workflowRun' | 'workflowRunId' | 'workflow' | 'workflowId' | 'workflowHistory' | 'item' | 'public' | 'omit'
const policies = {
  pods: 'podId', remote_pods: 'pod', master_creations: 'pod', script_credential_approvals: 'pod', assignments: 'pod', scripts: 'pod', checkpoints: 'pod', sources: 'pod', claims: 'pod', settings: 'omit', validations: 'pod', resources: 'pod', resource_epochs: 'pod',
  runs: 'pod', run_events: 'run', schedules: 'pod', accepted_events: 'pod', run_inputs: 'run', recovery_reviews: 'run', effect_ledger: 'pod',
  mail_inventory: 'pod', mail_items: 'pod', mail_receipts: 'pod', mail_extractions: 'pod', mail_contexts: 'pod', source_derivations: 'pod',
  master_messages: 'omit', script_drafts: 'pod', access_proposals: 'pod', pod_organization: 'public', pod_groups: 'public', pod_memberships: 'public',
  pod_variables: 'pod', master_message_scopes: 'omit', pod_chat_origins: 'pod', pod_descriptions: 'pod', draft_packages: 'omit', dependency_sets: 'pod', script_dependencies: 'pod',
  workflow_channels: 'workflow', workflow_gates: 'workflow', workflow_values: 'workflow', graph_items: 'workflowHistory', graph_deliveries: 'item', graph_item_events: 'workflowHistory', graph_gate_batches: 'pod',
  workflows: 'workflowId', workflow_members: 'workflow', workflow_runs: 'workflowRunId', workflow_nodes: 'workflowRun', workflow_attempts: 'workflowRun', workflow_mail_scopes: 'omit',
  workflow_mail_pending: 'omit', workflow_mail_processed: 'omit', workflow_mail_participants: 'omit', workflow_mail_batches: 'omit', workflow_mail_audit: 'omit',
  chat_conversations: 'omit', chat_contexts: 'omit', chat_members: 'omit', chat_message_context: 'omit', control_runs: 'omit', control_changes: 'omit',
} as const satisfies Record<typeof centralTables[number], Policy>

export const privatePods = `SELECT pod_id FROM network_members UNION SELECT pod_id FROM network_invocations UNION SELECT m.pod_id FROM workflow_members m JOIN workflow_call_requests c ON c.workflow_id=m.workflow_id`
const publicRuns = `SELECT id FROM runs WHERE pod_id NOT IN (${privatePods})`
const privateWorkflows = `SELECT workflow_id FROM workflow_members WHERE pod_id IN (${privatePods}) UNION SELECT ancestor_workflow_id FROM networks WHERE ancestor_workflow_id IS NOT NULL`
const privateWorkflowRuns = `SELECT workflow_run_id FROM workflow_call_requests WHERE workflow_run_id IS NOT NULL UNION SELECT id FROM workflow_runs WHERE workflow_id IN (${privateWorkflows})`

export function networkPublicationTables(store: PodDatabase): Record<string, Record<string, unknown>[]> {
  const where: Record<Exclude<Policy, 'omit'>, string> = {
    pod: `pod_id NOT IN (${privatePods})`, podId: `id NOT IN (${privatePods})`, run: `run_id IN (${publicRuns})`,
    workflow: `workflow_id NOT IN (${privateWorkflows})`, workflowId: `id NOT IN (${privateWorkflows})`,
    workflowRun: `workflow_run_id NOT IN (${privateWorkflowRuns})`, workflowRunId: `id NOT IN (${privateWorkflowRuns})`,
    workflowHistory: `workflow_id NOT IN (${privateWorkflows}) AND workflow_run_id NOT IN (${privateWorkflowRuns})`,
    item: `node NOT IN (${privatePods}) AND item_id NOT IN (SELECT id FROM graph_items WHERE workflow_id IN (${privateWorkflows}) OR workflow_run_id IN (${privateWorkflowRuns})) AND (workflow_run_id IS NULL OR workflow_run_id NOT IN (${privateWorkflowRuns}))`, public: '1',
  }
  return Object.fromEntries(centralTables.map((table) => {
    const policy: Policy | undefined = policies[table]
    if (!policy) throw new Error(`Unclassified publication table: ${table}`)
    return [table, policy === 'omit' ? [] : store.db.prepare(`SELECT * FROM ${table} WHERE ${where[policy]} ORDER BY rowid`).all()]
  }))
}

export function podNetwork(store: PodDatabase, podId: string): string | null {
  return store.db.prepare(`SELECT network_id FROM network_members WHERE pod_id=? UNION SELECT network_id FROM network_invocations WHERE pod_id=? UNION SELECT c.network_id FROM workflow_call_requests c JOIN workflow_members m ON m.workflow_id=c.workflow_id WHERE m.pod_id=? LIMIT 1`).get(podId, podId, podId)?.network_id as string | undefined ?? null
}

export function assertNetworkBrowserCommand(store: PodDatabase, command: CentralCommand): void {
  if (networkBrowserMutationAllowed(command)) return
  const targets = commandPodIds(command, { workspace: { pods: store.listPods() } })
  if (targets.some(id => podNetwork(store, id))) throw new Error('Network member changes require desktop review')
}
