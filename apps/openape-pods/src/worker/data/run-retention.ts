import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'

export const retainedRunCount = 50
export const runRetentionBatch = 25

export class RunRetention {
  private cleaning = false
  constructor(private readonly store: PodDatabase) {}

  async prune(): Promise<void> {
    if (this.cleaning) return
    this.cleaning = true
    try {
      await this.cleanFiles()
      if (this.store.db.prepare('SELECT 1 FROM run_deletion_jobs LIMIT 1').get()) return
      this.removeHistory()
      await this.cleanFiles()
    }
    finally { this.cleaning = false }
  }

  async recover(): Promise<void> {
    if (this.cleaning) return
    this.cleaning = true
    try { await this.cleanFiles() }
    finally { this.cleaning = false }
  }

  private removeHistory(): void {
    this.store.transaction(() => {
      const candidates = this.store.db.prepare(`
        WITH ranked AS (
          SELECT id, state, finished_at, row_number() OVER (PARTITION BY pod_id ORDER BY started_at DESC, rowid DESC) AS position
          FROM runs
        )
        SELECT r.id FROM ranked r
        WHERE position > ? AND finished_at IS NOT NULL AND state != 'running'
          AND NOT EXISTS (SELECT 1 FROM run_leases WHERE run_id=r.id)
          AND NOT EXISTS (SELECT 1 FROM effect_ledger WHERE run_id=r.id AND state!='completed')
          AND NOT EXISTS (
            SELECT 1 FROM recovery_reviews v WHERE v.run_id=r.id AND
              (v.state!='retryQueued' OR NOT EXISTS (SELECT 1 FROM accepted_events a WHERE a.id=v.request_event_id AND a.state='processed'))
          )
          AND NOT EXISTS (SELECT 1 FROM accepted_events WHERE run_id=r.id AND state!='processed')
          AND NOT EXISTS (
            SELECT 1 FROM run_inputs i, json_each(i.event_ids) input
            JOIN accepted_events a ON a.id=input.value
            WHERE i.run_id=r.id AND a.state!='processed'
          )
          AND NOT EXISTS (
            SELECT 1 FROM run_events e WHERE e.run_id=r.id AND e.type='approval' AND json_extract(e.data,'$.state')='pending'
              AND NOT EXISTS (SELECT 1 FROM run_events newer WHERE newer.run_id=e.run_id AND newer.type='approval'
                AND newer.sequence>e.sequence AND json_extract(newer.data,'$.grantId')=json_extract(e.data,'$.grantId'))
          )
          AND NOT EXISTS (
            SELECT 1 FROM workflow_attempts a JOIN workflow_runs w ON w.id=a.workflow_run_id
            WHERE a.run_id=r.id AND w.finished_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM workflow_nodes n JOIN workflow_runs w ON w.id=n.workflow_run_id
            WHERE n.run_id=r.id AND w.finished_at IS NULL
          )
        LIMIT ?
      `).all(retainedRunCount, runRetentionBatch)
      for (const row of candidates) {
        const id = String(row.id)
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid run deletion identity')
        this.store.db.prepare('INSERT INTO run_deletion_jobs VALUES(?,NULL)').run(id)
        this.store.db.prepare('UPDATE effect_ledger SET run_id=NULL WHERE run_id=? AND state=\'completed\'').run(id)
        this.store.db.prepare('UPDATE accepted_events SET run_id=NULL WHERE run_id=? AND state=\'processed\'').run(id)
        this.store.db.prepare('UPDATE control_changes SET body=json_remove(body,\'$.results[0].result.runId\',\'$.execution\') WHERE id IN (SELECT id FROM control_runs WHERE kind=\'pod\' AND run_id=?)').run(id)
        this.store.db.prepare('DELETE FROM control_runs WHERE kind=\'pod\' AND run_id=?').run(id)
        this.store.db.prepare('UPDATE workflow_nodes SET run_id=NULL,output=NULL WHERE run_id=?').run(id)
        for (const table of ['workflow_attempts', 'run_events', 'run_inputs', 'execution_domains', 'recovery_reviews']) {
          this.store.db.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(id)
        }
        this.store.db.prepare('DELETE FROM runs WHERE id=?').run(id)
      }
    })
  }

  private async cleanFiles(): Promise<void> {
    const jobs = this.store.db.prepare('SELECT run_id FROM run_deletion_jobs ORDER BY rowid LIMIT ?').all(runRetentionBatch)
    for (const job of jobs) {
      const id = String(job.run_id)
      if (!/^[a-f0-9-]{36}$/.test(id) || this.store.db.prepare('SELECT 1 FROM runs WHERE id=?').get(id)) throw new Error('Invalid pending run deletion')
      try {
        await rm(join(this.store.root, 'runs', id), { recursive: true, force: true })
        this.store.db.prepare('DELETE FROM run_deletion_jobs WHERE run_id=?').run(id)
      }
      catch (error) {
        this.store.db.prepare('UPDATE run_deletion_jobs SET error=? WHERE run_id=?').run(error instanceof Error ? error.message : 'Run folder deletion failed', id)
        throw error
      }
    }
  }
}
