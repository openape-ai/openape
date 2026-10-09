import type { PodDatabase } from '../storage/database'

/**
 * Run leases that use an execution slot. A run whose latest approval is pending waits for the owner's
 * decision at the IdP and executes nothing meanwhile, so it does not hold back other Pods.
 */
export function occupiedRunSlots(store: PodDatabase): number {
  return Number(store.db.prepare(`SELECT count(*) AS count FROM run_leases l WHERE NOT EXISTS(
    SELECT 1 FROM run_events e WHERE e.run_id=l.run_id AND e.type='approval' AND json_extract(e.data,'$.state')='pending'
      AND e.sequence=(SELECT max(latest.sequence) FROM run_events latest WHERE latest.run_id=l.run_id AND latest.type='approval'))`).get()!.count)
}
