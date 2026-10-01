import type { PodDatabase } from '../storage/database'

const completedTrace = `((t.kind IN ('diagnostic','snapshot','process','invocation-settled','environment','log','operation','emission-explanation','infrastructure') AND EXISTS(
  SELECT 1 FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id
  WHERE i.run_id=t.run_id AND (i.state='completed' OR (i.state IN ('blocked','failed') AND (c.resolved_receipt IS NOT NULL OR c.retry_consumed_at IS NOT NULL)))
  AND (c.settlement_receipt IS NOT NULL OR c.resolved_receipt IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM run_leases l WHERE l.run_id=i.run_id)
  AND NOT EXISTS(SELECT 1 FROM network_effect_attempts e WHERE e.run_id=i.run_id AND (e.state IN ('intent','unknown') OR NOT EXISTS(SELECT 1 FROM network_effect_receipts r WHERE r.logical_action_key=e.logical_action_key AND r.attempt=e.attempt AND r.outcome=e.state)))
  AND NOT EXISTS(SELECT 1 FROM effect_ledger e WHERE e.run_id=i.run_id AND e.state IN ('intent','unknown'))
  AND NOT EXISTS(SELECT 1 FROM network_gate_task_attempts a WHERE a.run_id=i.run_id AND a.state='unknown')))
  OR t.kind IN ('network-created-paused','network-activated','network-paused','process-now-preview','process-now-started','process-now-finished','process-now-stopped'))`

export function pruneNetworkTraces(store: PodDatabase, now: number): number {
  let removed = 0
  store.transaction(() => {
    store.db.prepare(`UPDATE network_invocation_controls SET process_preview_id=NULL WHERE process_preview_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM network_invocations i WHERE i.run_id=network_invocation_controls.run_id AND (i.state='completed' OR (i.state IN ('blocked','failed') AND (network_invocation_controls.resolved_receipt IS NOT NULL OR network_invocation_controls.retry_consumed_at IS NOT NULL))))
      AND (json_extract(settlement_receipt,'$.processPreview.id')=process_preview_id OR json_extract(resolved_receipt,'$.processPreview.id')=process_preview_id)`).run()
    store.db.prepare(`DELETE FROM network_process_previews WHERE expires_at<? AND NOT EXISTS(
      SELECT 1 FROM network_invocation_controls c WHERE c.process_preview_id=network_process_previews.id)`).run(now)
  })
  for (const network of store.db.prepare('SELECT id FROM networks ORDER BY id LIMIT 64').all()) {
    store.transaction(() => {
      const limit = store.db.prepare(`SELECT t.id FROM network_trace_events t WHERE t.network_id=? AND ${completedTrace} ORDER BY t.id DESC LIMIT 1 OFFSET 9999`).get(network.id!)?.id ?? 0
      const expired = store.db.prepare(`SELECT t.id,t.kind,t.created_at FROM network_trace_events t WHERE t.network_id=? AND ${completedTrace}
        AND (t.created_at<? OR t.id<?) ORDER BY t.id LIMIT 500`).all(network.id!, now - 7 * 86400000, limit)
      for (const trace of expired) {
        const day = Math.floor(Number(trace.created_at) / 86400000)
        store.db.prepare('INSERT INTO network_trace_history VALUES(?,?,?,1) ON CONFLICT(network_id,day,kind) DO UPDATE SET count=count+1').run(network.id!, day, trace.kind!)
        store.db.prepare('DELETE FROM network_trace_events WHERE id=?').run(trace.id!)
      }
      removed += expired.length
      store.db.prepare('DELETE FROM network_trace_history WHERE network_id=? AND day<?').run(network.id!, Math.floor(now / 86400000) - 90)
    })
  }
  return removed
}
