import type { NetworkDefinition } from '../../contracts/networks'
import type { ArchivePreview, LegacyItemsPage } from '../../contracts/network-retirement'
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
    [`SELECT 1 FROM workflow_call_requests WHERE network_id=? AND state NOT IN ('completed','failed','cancelled')`, 'Settle workflow calls before changing the composition'],
    [`SELECT 1 FROM workflow_call_requests r LEFT JOIN workflow_call_controls c ON c.request_id=r.id WHERE r.network_id=? AND r.result IS NOT NULL AND (c.delivery_state IS NULL OR c.delivery_state!='delivered')`, 'Deliver completed workflow results before changing the composition'],
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

export function previewNetworkArchive(store: PodDatabase, definition: NetworkDefinition): ArchivePreview {
  const row = store.db.prepare('SELECT * FROM networks WHERE id=?').get(definition.id)!
  const issues = networkSettlementIssues(store, definition.id)
  if (row.state !== 'paused') issues.unshift('Pause the network before reviewing archival')
  const retainedDeliveries = Number(store.db.prepare(`SELECT coalesce(json_array_length(body,'$.pending.items'),0) AS count FROM network_trace_events WHERE network_id=? AND kind='legacy-conversion-reviewed' ORDER BY id LIMIT 1`).get(definition.id)?.count ?? 0)
  const lastTrace = store.db.prepare('SELECT max(id) AS id FROM network_trace_events WHERE network_id=?').get(definition.id)!.id
  return { fingerprint: digest(canonicalNetworkJson({ row, definition, issues, lastTrace, retainedDeliveries })), issues, members: Number(store.db.prepare('SELECT count(*) AS count FROM network_members WHERE network_id=?').get(definition.id)!.count), retainedDeliveries }
}

export function retainedLegacyItems(store: PodDatabase, networkId: string, after: number | null): LegacyItemsPage {
  const ancestor = store.db.prepare('SELECT ancestor_workflow_id FROM networks WHERE id=?').get(networkId)!.ancestor_workflow_id as string | null
  if (!ancestor) return { workflowId: null, items: [], after: null }
  const rows = store.db.prepare(`SELECT CAST(j.key AS INTEGER) AS position,json_extract(j.value,'$.itemId') AS item_id,json_extract(j.value,'$.node') AS pod_id,json_extract(j.value,'$.key') AS item_key,json_extract(j.value,'$.payloadHash') AS original_hash,i.payload,d.state
    FROM network_trace_events t,json_each(t.body,'$.pending.items') j
    LEFT JOIN graph_items i ON i.id=json_extract(j.value,'$.itemId') AND i.workflow_id=?
    LEFT JOIN graph_deliveries d ON d.item_id=i.id AND d.node=json_extract(j.value,'$.node')
    WHERE t.network_id=? AND t.kind='legacy-conversion-reviewed' AND CAST(j.key AS INTEGER)>? ORDER BY CAST(j.key AS INTEGER) LIMIT 6`).all(ancestor, networkId, after ?? -1)
  return { workflowId: ancestor, items: rows.slice(0, 5).map(row => ({ itemId: row.item_id as string, podId: row.pod_id as string, key: row.item_key as string, payload: typeof row.payload === 'string' ? payloadPreview(row.payload) : null, truncated: typeof row.payload === 'string' && row.payload.length > 16384, originalHash: row.original_hash as string, currentHash: typeof row.payload === 'string' ? digest(row.payload) : null, state: row.state as string ?? 'missing' })), after: rows.length > 5 ? Number(rows[4]!.position) : null }
}

function payloadPreview(value: string): string {
  const prefix = value.slice(0, 16384)
  const last = prefix.charCodeAt(prefix.length - 1)
  return last >= 0xD800 && last <= 0xDBFF ? prefix.slice(0, -1) : prefix
}
