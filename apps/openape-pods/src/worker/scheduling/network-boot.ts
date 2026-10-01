import { randomUUID } from 'node:crypto'
import type { PodDatabase } from '../storage/database'

export function fenceNetworkBoot(store: PodDatabase): void {
  store.transaction(() => {
    store.db.prepare('UPDATE network_process_previews SET state=\'stopped\' WHERE state=\'running\'').run()
    const unfinished = store.db.prepare('SELECT run_id,network_id FROM network_invocations WHERE state IN (\'running\',\'stopping\')').all()
    for (const invocation of unfinished) {
      const unsafe = store.db.prepare('SELECT 1 FROM network_effect_attempts WHERE run_id=? AND state IN (\'intent\',\'unknown\') LIMIT 1').get(invocation.run_id!)
      for (const effect of store.db.prepare('SELECT logical_action_key,attempt FROM network_effect_attempts WHERE run_id=? AND state=\'intent\'').all(invocation.run_id!)) {
        const sequence = Number(store.db.prepare('SELECT coalesce(max(sequence),0)+1 AS sequence FROM network_effect_receipts WHERE logical_action_key=? AND attempt=?').get(effect.logical_action_key!, effect.attempt!)!.sequence)
        store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,?,?,\'unknown\',?,?)').run(effect.logical_action_key!, effect.attempt!, sequence, JSON.stringify({ reason: 'Worker stopped before effect settlement' }), Date.now())
      }
      store.db.prepare('UPDATE network_effect_attempts SET state=\'unknown\' WHERE run_id=? AND state=\'intent\'').run(invocation.run_id!)
      const nextState = unsafe ? 'unknown' : 'blocked'
      store.db.prepare('UPDATE network_deliveries SET state=?,generation=generation+1,claim_token=NULL,boot_nonce=NULL,reason=\'Previous worker stopped; network recovery is required\' WHERE run_id=? AND state=\'claimed\'').run(nextState, invocation.run_id!)
      store.db.prepare('UPDATE network_invocations SET state=?,generation=generation+1,claim_token=? WHERE run_id=?').run(unsafe ? 'unknown' : 'interrupted', randomUUID(), invocation.run_id!)
      store.db.prepare('UPDATE network_invocation_controls SET deadline=NULL,failure_kind=?,diagnostic=? WHERE run_id=?').run(unsafe ? 'uncertain' : 'recovery', 'Previous network worker stopped; process and effect inspection required', invocation.run_id!)
      store.db.prepare('UPDATE run_leases SET boot_id=\'fenced-network:\'||boot_id WHERE run_id=?').run(invocation.run_id!)
      store.db.prepare('UPDATE runs SET state=\'interrupted\',error=\'Network worker stopped; recovery is required\',summary=\'Network execution interrupted\' WHERE id=? AND state=\'running\'').run(invocation.run_id!)
      store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(invocation.network_id!, invocation.run_id!, 'worker-boot-fenced', JSON.stringify({ effectOutcome: unsafe ? 'unknown' : 'none', stagedCheckpointRetained: true, leaseRetained: true }), Date.now())
    }
    if (!unfinished.length) return
    store.db.prepare('DELETE FROM network_queue_counts').run()
    store.db.prepare('INSERT INTO network_queue_counts SELECT network_id,state,count(*) FROM network_deliveries GROUP BY network_id,state').run()
  })
}
