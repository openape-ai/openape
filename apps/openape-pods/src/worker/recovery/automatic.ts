import type { PodDatabase } from '../storage/database'
import { confirmDomainsStopped } from './domains'
import { RunStore } from '../runs/store'
import { DomainData } from '../data/domain'
import { WorkLedger } from '../data/work'

/** A run whose previous process may still be present is checked again after this delay, never held. */
export const stoppedRunRecheckMs = 30000
const rechecks = new WeakMap<PodDatabase, Map<string, number>>()
// Earlier versions held a run for owner review with a 'hold' recovery event; such runs are recovered like any other.
const settled = 'EXISTS(SELECT 1 FROM run_events e WHERE e.run_id=r.id AND e.type=\'recovery\' AND json_extract(e.data,\'$.disposition\') IS NOT \'hold\')'

export async function recoverStoppedRuns(store: PodDatabase, helper: string, limit = 10): Promise<void> {
  const due = rechecks.get(store) ?? new Map<string, number>(); rechecks.set(store, due)
  const candidates = store.db.prepare(`SELECT r.* FROM runs r
    WHERE r.state IN ('interrupted','failed','cancelled','blocked','completedWithGaps') AND NOT ${settled}
      AND (EXISTS(SELECT 1 FROM accepted_events e WHERE e.run_id=r.id AND e.state IN ('blocked','claimed'))
        OR EXISTS(SELECT 1 FROM run_leases l WHERE l.run_id=r.id))
    ORDER BY r.started_at DESC LIMIT 100`).all().filter(run => (due.get(String(run.id)) ?? 0) <= Date.now()).slice(0, limit)
  const runs = new RunStore(store)
  const work = new WorkLedger(store, new DomainData(store))
  for (const run of candidates) {
    const id = String(run.id); const podId = String(run.pod_id)
    try { await confirmDomainsStopped(store, id, helper) }
    catch (error) {
      // The lease stays, so no second process of this Pod can start meanwhile.
      due.set(id, Date.now() + stoppedRunRecheckMs)
      console.warn(`Run ${id} keeps its lease until its previous process is confirmed stopped:`, error instanceof Error ? error.message : error)
      continue
    }
    due.delete(id)
    const started = store.db.prepare('SELECT data FROM run_events WHERE run_id=? AND type=\'started\' ORDER BY sequence LIMIT 1').get(id)
    const epoch = started ? (JSON.parse(String(started.data)) as { resourceEpoch?: number }).resourceEpoch : undefined
    store.transaction(() => {
      if (store.db.prepare(`SELECT 1 FROM runs WHERE pod_id=? AND state='running' UNION ALL SELECT 1 FROM runs r WHERE r.id=? AND ${settled} LIMIT 1`).get(podId, id)) return
      store.db.prepare('DELETE FROM run_leases WHERE run_id=?').run(id)
      store.db.prepare('UPDATE runs SET finished_at=coalesce(finished_at,?) WHERE id=?').run(Date.now(), id)
      const ownerCancelled = run.state === 'cancelled' && run.error !== 'Application is quitting'
      runs.recover(id, epoch, { cause: ownerCancelled ? 'owner-cancelled' : 'shutdown' })
      // The run's processes are proven stopped, so its work claims can no longer race a new claimant.
      work.settleRun(id)
    })
  }
}
