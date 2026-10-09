import type { PodDatabase } from '../storage/database'
import { confirmDomainsStopped } from './domains'
import { recoveryHold } from './policy'
import { RunStore } from '../runs/store'

export async function recoverStoppedRuns(store: PodDatabase, helper: string, limit = 10): Promise<void> {
  const candidates = store.db.prepare(`SELECT r.* FROM runs r
    WHERE r.state IN ('interrupted','failed','cancelled','blocked','completedWithGaps')
      AND NOT EXISTS(SELECT 1 FROM network_invocations n WHERE n.run_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM recovery_reviews review WHERE review.run_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM run_events e WHERE e.run_id=r.id AND e.type='recovery')
      AND (EXISTS(SELECT 1 FROM accepted_events e WHERE e.run_id=r.id AND e.state IN ('blocked','claimed'))
        OR EXISTS(SELECT 1 FROM run_leases l WHERE l.run_id=r.id))
    ORDER BY r.started_at DESC LIMIT ?`).all(limit)
  const runs = new RunStore(store)
  for (const run of candidates) {
    const id = String(run.id); const podId = String(run.pod_id)
    let hold = recoveryHold(store, podId, id)
    const started = store.db.prepare('SELECT data FROM run_events WHERE run_id=? AND type=\'started\' ORDER BY sequence LIMIT 1').get(id)
    const epoch = started ? (JSON.parse(String(started.data)) as { resourceEpoch?: number }).resourceEpoch : undefined
    if (epoch === undefined) hold ??= 'Previous run has no permission binding evidence'
    const process = store.db.prepare('SELECT 1 FROM run_events WHERE run_id=? AND type=\'process\' UNION ALL SELECT 1 FROM run_leases WHERE run_id=? LIMIT 1').get(id, id)
    if (process && !store.db.prepare('SELECT 1 FROM execution_domains WHERE run_id=?').get(id)) hold ??= 'Previous process has no termination evidence'
    const script = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, run.script_hash!)
    if (!script) {
      hold ??= 'Pinned script is missing'
    }
    else {
      const manifest = JSON.parse(String(script.manifest)) as { capabilities: string[] }
      if (manifest.capabilities.includes('mail.archive') && store.db.prepare('SELECT 1 FROM run_events WHERE run_id=? AND type=\'operation\' AND json_extract(data,\'$.operation\')=\'mail.archive\' LIMIT 1').get(id)) hold ??= 'Legacy operation requires replay evidence'
    }
    if (!hold) {
      try { await confirmDomainsStopped(store, id, helper) }
      catch (error) { hold = error instanceof Error ? error.message : 'Previous execution termination is unverified' }
    }
    store.transaction(() => {
      if (store.db.prepare('SELECT 1 FROM runs WHERE pod_id=? AND state=\'running\' UNION ALL SELECT 1 FROM run_events WHERE run_id=? AND type=\'recovery\' LIMIT 1').get(podId, id)) return
      if (hold) {
        runs.append(id, 'recovery', { disposition: 'hold', reason: hold, cause: 'failure', nextAt: null, attempt: 0 })
        store.db.prepare('UPDATE accepted_events SET state=\'blocked\',error=? WHERE run_id=? AND state IN (\'blocked\',\'claimed\')').run(hold, id)
        return
      }
      store.db.prepare('DELETE FROM run_leases WHERE run_id=?').run(id)
      store.db.prepare('UPDATE runs SET finished_at=coalesce(finished_at,?) WHERE id=?').run(Date.now(), id)
      const ownerCancelled = run.state === 'cancelled' && run.error !== 'Application is quitting'
      runs.recover(id, epoch!, { cause: ownerCancelled ? 'owner-cancelled' : 'shutdown' })
    })
  }
}
