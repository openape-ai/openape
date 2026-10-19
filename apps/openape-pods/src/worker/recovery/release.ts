import type { PodDatabase } from '../storage/database'

/**
 * Earlier versions held inputs and work items for owner review. Idempotent data step at worker start: inputs of a run
 * that still holds its lease stay for automatic recovery, which first confirms that run's processes stopped. Work the
 * restore fence holds (reason 'Restored backup: …') stays held for the owner's restore review.
 */
export function releaseHeldWork(store: PodDatabase): void {
  const now = Date.now()
  store.db.prepare(`UPDATE accepted_events SET state='pending',error=NULL WHERE state='blocked'
    AND (run_id IS NULL OR NOT EXISTS(SELECT 1 FROM run_leases l WHERE l.run_id=accepted_events.run_id))`).run()
  store.db.prepare(`UPDATE work_items SET state='retry_wait',claim_token=NULL,ready_at=?,reason='Held for owner review by an earlier version; retried automatically',updated_at=?
    WHERE (state='unknown' AND coalesce(reason,'') NOT LIKE 'Restored backup:%') OR (state='blocked' AND reason LIKE 'The run changed an application before it ended%')`).run(now, now)
}
