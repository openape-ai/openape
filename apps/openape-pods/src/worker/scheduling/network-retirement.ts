import type { NetworkDefinition } from '../../contracts/networks'
import type { ArchivePreview } from '../../contracts/network-retirement'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'

export function networkSettlementIssues(store: PodDatabase, id: string): string[] {
  const issues: string[] = []
  const checks = [
    [`SELECT 1 FROM network_choices WHERE network_id=? AND decided_at IS NULL`, 'Resolve pending owner choices before changing the composition'],
    [`SELECT 1 FROM network_deliveries WHERE network_id=? AND state NOT IN ('done','discarded')`, 'Resolve pending network deliveries before changing the composition'],
    [`SELECT 1 FROM network_invocations i LEFT JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.network_id=? AND (i.state IN ('running','stopping','interrupted','unknown') OR (i.state='blocked' AND c.resolved_receipt IS NULL AND c.retry_consumed_at IS NULL))`, 'Settle network executions before changing the composition'],
    [`SELECT 1 FROM network_gate_tasks WHERE network_id=? AND state IN ('preparing','pending','consuming','unknown')`, 'Resolve pending or uncertain approvals before changing the composition'],
    [`SELECT 1 FROM network_joins WHERE network_id=? AND state IN ('pending','blocked')`, 'Resolve pending joins before changing the composition'],
    [`SELECT 1 FROM network_effect_attempts e WHERE e.network_id=? AND (e.state IN ('intent','unknown') OR NOT EXISTS(SELECT 1 FROM network_effect_receipts r WHERE r.logical_action_key=e.logical_action_key AND r.attempt=e.attempt AND r.outcome=e.state))`, 'Reconcile external effect receipts before changing the composition'],
    [`SELECT 1 FROM network_process_previews WHERE network_id=? AND state='running'`, 'Stop bounded processing before changing the composition'],
    [`SELECT 1 FROM network_members m JOIN run_leases l ON l.pod_id=m.pod_id WHERE m.network_id=?`, 'Wait for member process leases to settle'],
    [`SELECT 1 FROM network_members m JOIN program_leases l ON l.pod_id=m.pod_id WHERE m.network_id=?`, 'Wait for member program leases to settle'],
    [`SELECT 1 FROM network_members m JOIN effect_ledger e ON e.pod_id=m.pod_id WHERE m.network_id=? AND e.state IN ('intent','unknown')`, 'Reconcile retained legacy effects before changing the composition'],
  ] as const
  for (const [sql, issue] of checks) {
    if (store.db.prepare(`${sql} LIMIT 1`).get(id)) issues.push(issue)
  }
  return issues
}

// Only the updated member must be idle; other members keep their open decisions because channels and contracts stay unchanged.
export function memberScriptIssues(store: PodDatabase, networkId: string, podId: string): string[] {
  const checks = [
    [`SELECT 1 FROM network_invocations WHERE network_id=? AND pod_id=? AND state IN ('running','stopping','interrupted','unknown')`, 'Wait for this Pod\'s network executions to settle'],
    [`SELECT 1 FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE d.network_id=? AND s.pod_id=? AND d.state IN ('claimed','unknown')`, 'Settle this Pod\'s claimed or uncertain inputs'],
    [`SELECT 1 FROM network_gate_tasks task WHERE task.network_id=? AND task.pod_id=? AND (task.state IN ('preparing','pending','consuming','unknown')
      OR (task.state IN ('approved','superseded') AND EXISTS(SELECT 1 FROM network_gate_items item JOIN network_deliveries delivery ON delivery.id=item.delivery_id WHERE item.task_id=task.id AND item.outcome IN ('held','released','unknown') AND delivery.state IN ('pending','claimed','retry_wait','blocked','unknown'))))`, 'Resolve this Pod\'s pending, approved or uncertain approvals'],
    [`SELECT 1 FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.network_id=? AND i.pod_id=? AND c.review_required=1`, 'Resolve this Pod\'s source identity conflict'],
    [`SELECT 1 FROM network_effect_attempts e JOIN network_invocations i ON i.run_id=e.run_id WHERE e.network_id=? AND i.pod_id=? AND (e.state IN ('intent','unknown') OR NOT EXISTS(SELECT 1 FROM network_effect_receipts r WHERE r.logical_action_key=e.logical_action_key AND r.attempt=e.attempt AND r.outcome=e.state))`, 'Reconcile this Pod\'s external effect receipts'],
    [`SELECT 1 FROM network_members m JOIN run_leases l ON l.pod_id=m.pod_id WHERE m.network_id=? AND m.pod_id=?`, 'Wait for this Pod\'s process lease to settle'],
    [`SELECT 1 FROM network_members m JOIN program_leases l ON l.pod_id=m.pod_id WHERE m.network_id=? AND m.pod_id=?`, 'Wait for this Pod\'s program lease to settle'],
    [`SELECT 1 FROM network_members m JOIN effect_ledger e ON e.pod_id=m.pod_id WHERE m.network_id=? AND m.pod_id=? AND e.state IN ('intent','unknown')`, 'Reconcile this Pod\'s retained legacy effects'],
  ] as const
  const issues: string[] = checks.filter(([sql]) => store.db.prepare(`${sql} LIMIT 1`).get(networkId, podId)).map(([, issue]) => issue)
  if (store.db.prepare(`SELECT 1 FROM network_process_previews WHERE network_id=? AND state='running' LIMIT 1`).get(networkId)) issues.push('Stop bounded processing first')
  return issues
}

export function previewNetworkArchive(store: PodDatabase, definition: NetworkDefinition): ArchivePreview {
  const row = store.db.prepare('SELECT * FROM networks WHERE id=?').get(definition.id)!
  const issues = networkSettlementIssues(store, definition.id)
  if (row.state !== 'paused') issues.unshift('Pause the network before reviewing archival')
  const lastTrace = store.db.prepare('SELECT max(id) AS id FROM network_trace_events WHERE network_id=?').get(definition.id)!.id
  return { fingerprint: digest(canonicalNetworkJson({ row, definition, issues, lastTrace })), issues, members: Number(store.db.prepare('SELECT count(*) AS count FROM network_members WHERE network_id=?').get(definition.id)!.count) }
}
