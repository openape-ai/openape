import { confirmDomainsStopped } from './domains'
import type { PodDatabase } from '../storage/database'
import { parseManifest } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { Scheduler } from '../scheduling/scheduler'

export class Recovery {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly scheduler: Scheduler, private readonly helper: string) {}

  private validate(podId: string): void {
    const pod = this.store.getPod(podId)
    if (pod.lifecycle === 'archived' || !pod.activeScript) throw new Error('Choose a validated script before retrying')
    const row = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript)
    if (!row || parseManifest(JSON.parse(row.manifest as string)).effects !== 'readOnly') throw new Error('Effectful scripts require a registered reconciliation adapter')
    if (!this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, pod.activeScript, pod.revision, this.resources.epoch(podId))) throw new Error('Validate the script for current permissions before retrying')
  }

  async inspect(podId: string, runId: string): Promise<void> {
    const run = this.store.db.prepare('SELECT * FROM runs WHERE id=? AND pod_id=?').get(runId, podId)
    if (!run || !['interrupted', 'failed', 'cancelled', 'blocked'].includes(run.state as string)) throw new Error('Only stopped or interrupted runs can be recovered')
    try {
      if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(runId) && !this.store.db.prepare('SELECT 1 FROM execution_domains WHERE run_id=?').get(runId)) throw new Error('This legacy run has no process-domain evidence; manual investigation is required')
      await confirmDomainsStopped(this.store, runId, this.helper)
      if (this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE run_id=? AND state IN (\'intent\',\'unknown\')').get(runId)) throw new Error('An external effect has an unknown outcome; reconciliation evidence is required')
      this.store.transaction(() => {
        this.store.db.prepare('DELETE FROM run_leases WHERE run_id=?').run(runId)
        this.store.db.prepare('UPDATE accepted_events SET state=\'blocked\',error=\'Interrupted input requires explicit retry\' WHERE run_id=? AND state=\'claimed\'').run(runId)
        this.store.db.prepare('UPDATE runs SET finished_at=coalesce(finished_at,?) WHERE id=?').run(Date.now(), runId)
        this.store.db.prepare('INSERT INTO recovery_reviews VALUES(?,\'ready\',NULL,?,NULL) ON CONFLICT(run_id) DO UPDATE SET state=CASE WHEN request_event_id IS NULL THEN \'ready\' ELSE state END,error=NULL,checked_at=excluded.checked_at').run(runId, Date.now())
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Recovery inspection failed'
      this.store.db.prepare('INSERT INTO recovery_reviews VALUES(?,\'needsReview\',?,?,NULL) ON CONFLICT(run_id) DO UPDATE SET state=\'needsReview\',error=excluded.error,checked_at=excluded.checked_at').run(runId, message, Date.now())
      throw error
    }
  }

  async retry(podId: string, runId: string): Promise<void> {
    await this.inspect(podId, runId); this.validate(podId)
    this.store.transaction(() => {
      const previous = this.store.db.prepare('SELECT request_event_id FROM recovery_reviews WHERE run_id=?').get(runId)?.request_event_id
      if (previous) return
      this.store.db.prepare('UPDATE accepted_events SET state=\'pending\',run_id=NULL,error=NULL WHERE run_id=? AND state=\'blocked\'').run(runId)
      const event = this.scheduler.acceptEvent(podId, 'manual', `recovery:${runId}`, {})
      this.store.db.prepare('UPDATE recovery_reviews SET state=\'retryQueued\',request_event_id=? WHERE run_id=?').run(event, runId)
    })
    this.scheduler.drain()
  }

  retryQueue(podId: string): void {
    this.validate(podId)
    if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(podId)) throw new Error('Recover or finish the active run first')
    if (this.store.db.prepare('SELECT 1 FROM accepted_events WHERE pod_id=? AND state=\'blocked\' AND run_id IS NOT NULL').get(podId)) throw new Error('Recover the failed run before retrying queued input')
    this.store.db.prepare('UPDATE accepted_events SET state=\'pending\',error=NULL WHERE pod_id=? AND state=\'blocked\' AND run_id IS NULL').run(podId)
    this.scheduler.requestManual(podId)
  }
}
