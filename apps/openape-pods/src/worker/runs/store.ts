import { basename, join, sep, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RunEvent, RunRecord, RunState } from '../../contracts/runs'
import type { PodDatabase } from '../storage/database'

function fromRow(row: Record<string, unknown>): RunRecord {
  return { id: row.id as string, podId: row.pod_id as string, scriptHash: row.script_hash as string, state: row.state as RunState, startedAt: row.started_at as number, finishedAt: row.finished_at as number | null, summary: row.summary as string, error: row.error as string | null, checkpointRevision: row.checkpoint_revision as number, recovery: row.recovery_state ? { state: row.recovery_state as 'ready' | 'needsReview' | 'retryQueued', error: row.recovery_error as string | null } : null }
}
export interface RunTrigger { reason: 'manual' | 'schedule' | 'event', eventIds: string[] }
export class RunStore {
  readonly bootId = randomUUID()
  constructor(readonly store: PodDatabase) {}

  list(podId: string): RunRecord[] { this.store.getPod(podId); return this.store.db.prepare('SELECT r.*,v.state AS recovery_state,v.error AS recovery_error FROM runs r LEFT JOIN recovery_reviews v ON v.run_id=r.id WHERE r.pod_id=? ORDER BY r.started_at DESC,r.rowid DESC LIMIT 100').all(podId).map(fromRow) }

  get(id: string): RunRecord {
    const row = this.store.db.prepare('SELECT r.*,v.state AS recovery_state,v.error AS recovery_error FROM runs r LEFT JOIN recovery_reviews v ON v.run_id=r.id WHERE r.id=?').get(id)
    if (!row) throw new Error('Run not found')
    return fromRow(row)
  }

  reserve(podId: string, scriptHash: string, epoch: number, trigger: RunTrigger = { reason: 'manual', eventIds: [] }): { run: RunRecord, existing: boolean } {
    return this.store.transaction(() => {
      const active = this.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(podId)
      if (active) return { run: this.get(active.run_id as string), existing: true }
      const count = this.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count as number
      const maximum = this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number
      if (count >= maximum) throw new Error('All run slots are occupied')
      const pod = this.store.getPod(podId)
      if (pod.lifecycle === 'archived' || pod.activeScript !== scriptHash) throw new Error('Script is no longer active')
      const validation = this.store.db.prepare('SELECT evidence FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, scriptHash, pod.revision, epoch)
      if (!validation) throw new Error('Script needs validation for the current assignment and resources')
      const id = randomUUID(); const now = Date.now()
      const checkpoint = this.store.db.prepare('SELECT revision FROM checkpoints WHERE pod_id=?').get(podId)!.revision as number
      this.store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, podId, scriptHash, 'running', now, null, '', null, checkpoint, pod.revision)
      this.store.db.prepare('INSERT INTO run_inputs VALUES(?,?,?)').run(id, trigger.reason, JSON.stringify(trigger.eventIds))
      for (const eventId of trigger.eventIds) {
        const claimed = this.store.db.prepare('UPDATE accepted_events SET state=\'claimed\',run_id=? WHERE id=? AND pod_id=? AND state=\'pending\'').run(id, eventId, podId)
        if (claimed.changes !== 1) throw new Error('Event is no longer available for this run')
      }
      this.store.db.prepare('INSERT INTO run_leases VALUES(?,?,?,?,?)').run(podId, id, this.bootId, now, null)
      this.append(id, 'started', { scriptHash, assignmentRevision: pod.revision, resourceEpoch: epoch })
      return { run: this.get(id), existing: false }
    })
  }

  assertLease(id: string): void {
    if (!this.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=? AND boot_id=?').get(id, this.bootId)) throw new Error('Run lease is no longer owned by this worker')
  }

  registerDomain(id: string, path: string, ownerPid: number): void {
    const prefix = join(this.store.root, 'runs', id) + sep
    if (resolve(path) !== path || !path.startsWith(prefix) || !/^domain-[a-f0-9-]{36}\.record$/.test(basename(path)) || !Number.isSafeInteger(ownerPid) || ownerPid < 2) throw new Error('Invalid execution domain registration')
    if ((this.store.db.prepare('SELECT count(*) AS count FROM execution_domains WHERE run_id=?').get(id)!.count as number) >= 128) throw new Error('Run exceeded its execution-domain limit')
    const saved = this.store.db.prepare('INSERT INTO execution_domains SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM run_leases WHERE run_id=? AND boot_id=?)').run(path, id, ownerPid, id, this.bootId)
    if (saved.changes !== 1) throw new Error('Run was fenced before domain registration')
  }

  append(id: string, type: string, data: unknown): void {
    const sequence = this.store.db.prepare('SELECT coalesce(max(sequence),0)+1 AS next FROM run_events WHERE run_id=?').get(id)!.next as number
    const body = JSON.stringify(data)
    if (body.length > 256 * 1024) throw new Error('Run event exceeds its size limit')
    this.store.db.prepare('INSERT INTO run_events VALUES(?,?,?,?,?)').run(id, sequence, type, body, Date.now())
  }

  events(podId: string, id: string, after = 0): RunEvent[] {
    if (this.get(id).podId !== podId) throw new Error('Run belongs to a different pod')
    return this.store.db.prepare('SELECT * FROM run_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 500').all(id, after).map(row => ({ sequence: row.sequence as number, type: row.type as string, data: JSON.parse(row.data as string), at: row.at as number }))
  }

  interrupt(id: string, error: string): void {
    this.store.transaction(() => {
      this.assertLease(id)
      this.store.db.prepare('UPDATE runs SET state=\'interrupted\',error=?,summary=\'Execution cleanup needs review\' WHERE id=?').run(error, id)
      this.store.db.prepare('UPDATE run_leases SET boot_id=? WHERE run_id=?').run(`fenced:${this.bootId}`, id)
      this.append(id, 'interrupted', { error })
    })
  }

  finish(id: string, state: RunState, summary: string, error: string | null, completedInputIds: string[] = []): void {
    this.store.transaction(() => {
      this.assertLease(id)
      const run = this.get(id)
      const revision = this.store.db.prepare('SELECT revision FROM checkpoints WHERE pod_id=?').get(run.podId)!.revision as number
      this.store.db.prepare('UPDATE runs SET state=?,summary=?,error=?,finished_at=?,checkpoint_revision=? WHERE id=?').run(state, summary, error, Date.now(), revision, id)
      for (const eventId of completedInputIds) {
        const result = this.store.db.prepare('UPDATE accepted_events SET state=\'processed\' WHERE id=? AND run_id=? AND state=\'claimed\'').run(eventId, id)
        if (result.changes !== 1) throw new Error('Completed input is not assigned to this run')
      }
      this.store.db.prepare('UPDATE accepted_events SET state=\'blocked\',error=? WHERE run_id=? AND state=\'claimed\'').run(error ?? 'Input was not completed; explicit retry is required', id)
      this.append(id, 'finished', { state, summary, error, checkpointRevision: revision })
      this.store.db.prepare('DELETE FROM run_leases WHERE run_id=? AND boot_id=?').run(id, this.bootId)
    })
  }
}
