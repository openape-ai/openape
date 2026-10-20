import type { PodDatabase } from '../storage/database'

/** Retry old held input events once their previous run no longer holds a lease. */
export function releaseHeldWork(store: PodDatabase): void {
  store.db.prepare(`UPDATE accepted_events SET state='pending',error=NULL WHERE state='blocked'
    AND (run_id IS NULL OR NOT EXISTS(SELECT 1 FROM run_leases l WHERE l.run_id=accepted_events.run_id))`).run()
}
