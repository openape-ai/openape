import { occupiedRunSlots } from './slots'
import { recoveryDecision, recoveryHold } from '../recovery/policy'
import type { RecoveryFailure } from '../recovery/policy'
import { parseRunApproval } from '../../contracts/activity'
import { basename, join, sep, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AutomaticRecovery, RunEvent, RunRecord, RunState } from '../../contracts/runs'
import type { PodDatabase } from '../storage/database'

function fromRow(row: Record<string, unknown>): RunRecord {
  const automaticRecovery = row.automatic_recovery ? JSON.parse(String(row.automatic_recovery)) as AutomaticRecovery : undefined
  if (automaticRecovery?.disposition === 'retry' && !row.retry_pending) { automaticRecovery.disposition = 'continued'; automaticRecovery.nextAt = null; automaticRecovery.reason = 'Work continued in a later attempt' }
  return { ...(automaticRecovery ? { automaticRecovery } : {}), id: row.id as string, podId: row.pod_id as string, scriptHash: row.script_hash as string, state: row.state as RunState, startedAt: row.started_at as number, finishedAt: row.finished_at as number | null, summary: row.summary as string, error: row.error as string | null, checkpointRevision: row.checkpoint_revision as number, recovery: row.recovery_state ? { state: row.recovery_state as 'ready' | 'needsReview' | 'retryQueued', error: row.recovery_error as string | null } : null }
}
export interface RunTrigger { reason: 'manual' | 'schedule' | 'event', eventIds: string[], operationId?: string }
export class RunStore {
  readonly bootId = randomUUID()
  constructor(readonly store: PodDatabase) {}

  list(podId: string): RunRecord[] { this.store.getPod(podId); return this.store.db.prepare('SELECT r.*,(SELECT data FROM run_events e WHERE e.run_id=r.id AND e.type=\'recovery\' ORDER BY sequence DESC LIMIT 1) AS automatic_recovery,EXISTS(SELECT 1 FROM accepted_events e WHERE e.run_id=r.id AND e.state=\'pending\') AS retry_pending,v.state AS recovery_state,v.error AS recovery_error FROM runs r LEFT JOIN recovery_reviews v ON v.run_id=r.id WHERE r.pod_id=? AND NOT EXISTS(SELECT 1 FROM network_invocations i WHERE i.run_id=r.id AND i.execution_kind=\'gate_maintenance\') ORDER BY r.started_at DESC,r.rowid DESC LIMIT 100').all(podId).map(fromRow) }

  get(id: string): RunRecord {
    const row = this.store.db.prepare('SELECT r.*,(SELECT data FROM run_events e WHERE e.run_id=r.id AND e.type=\'recovery\' ORDER BY sequence DESC LIMIT 1) AS automatic_recovery,EXISTS(SELECT 1 FROM accepted_events e WHERE e.run_id=r.id AND e.state=\'pending\') AS retry_pending,v.state AS recovery_state,v.error AS recovery_error FROM runs r LEFT JOIN recovery_reviews v ON v.run_id=r.id WHERE r.id=?').get(id)
    if (!row) throw new Error('Run not found')
    return fromRow(row)
  }

  reserve(podId: string, scriptHash: string, epoch: number, trigger: RunTrigger = { reason: 'manual', eventIds: [] }): { run: RunRecord, existing: boolean } {
    return this.store.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM program_leases WHERE pod_id=?').get(podId)) throw new Error('Finish or recover the current pod run or terminal first')
      const active = this.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(podId)
      if (active) return { run: this.get(active.run_id as string), existing: true }
      const count = occupiedRunSlots(this.store)
      const maximum = this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number
      if (count >= maximum) throw new Error('All run slots are occupied')
      const pod = this.store.getPod(podId)
      if (pod.lifecycle === 'archived' || pod.activeScript !== scriptHash) throw new Error('Script is no longer active')
      const validation = this.store.db.prepare('SELECT evidence FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, scriptHash, pod.bindingRevision, epoch)
      if (!validation) throw new Error('Script needs validation for the current script and resources')
      const id = randomUUID(); const now = Date.now()
      const checkpoint = this.store.db.prepare('SELECT revision FROM checkpoints WHERE pod_id=?').get(podId)!.revision as number
      this.store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, podId, scriptHash, 'running', now, null, '', null, checkpoint, pod.bindingRevision)
      if (trigger.operationId) this.store.db.prepare('INSERT INTO control_runs VALUES(?,?,\'pod\')').run(trigger.operationId, id)
      const previousAttempts = trigger.eventIds.map(eventId => Number(this.store.db.prepare('SELECT i.retry_attempt FROM accepted_events e JOIN run_inputs i ON i.run_id=e.run_id WHERE e.id=?').get(eventId)?.retry_attempt ?? 0))
      this.store.db.prepare('INSERT INTO run_inputs(run_id,reason,event_ids,retry_attempt) VALUES(?,?,?,?)').run(id, trigger.reason, JSON.stringify(trigger.eventIds), Math.max(0, ...previousAttempts))
      for (const eventId of trigger.eventIds) {
        const claimed = this.store.db.prepare('UPDATE accepted_events SET state=\'claimed\',run_id=? WHERE id=? AND pod_id=? AND state=\'pending\'').run(id, eventId, podId)
        if (claimed.changes !== 1) throw new Error('Event is no longer available for this run')
      }
      this.store.db.prepare('INSERT INTO run_leases VALUES(?,?,?,?,?)').run(podId, id, this.bootId, now, null)
      this.append(id, 'started', { scriptHash, assignmentRevision: pod.bindingRevision, resourceEpoch: epoch, reason: trigger.reason })
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

  timing(podId: string, id: string): { activeMs: number, waitingMs: number } | undefined {
    const run = this.get(id)
    if (run.podId !== podId) throw new Error('Run belongs to a different pod')
    if (!this.store.db.prepare('SELECT 1 FROM run_events WHERE run_id=? AND type=\'started\' AND json_extract(data,\'$.reason\') IS NOT NULL').get(id)) return undefined
    const lastAt = this.store.db.prepare('SELECT max(at) AS at FROM run_events WHERE run_id=?').get(id)?.at as number | null
    const end = run.finishedAt ?? (run.state === 'running' ? Date.now() : lastAt ?? run.startedAt)
    const pending = new Set<string>(); let since: number | undefined; let waitingMs = 0
    for (const row of this.store.db.prepare('SELECT at,data FROM run_events WHERE run_id=? AND type=\'approval\' ORDER BY sequence').iterate(id)) {
      const approval = parseRunApproval(JSON.parse(row.data as string)); const at = row.at as number
      if (approval.state === 'pending') { if (!pending.size) since = at; pending.add(approval.grantId) }
      else { pending.delete(approval.grantId); if (!pending.size && since !== undefined) { waitingMs += Math.max(0, at - since); since = undefined } }
    }
    if (since !== undefined) waitingMs += Math.max(0, end - since)
    const total = Math.max(0, end - run.startedAt)
    return { activeMs: Math.max(0, total - waitingMs), waitingMs: Math.min(total, waitingMs) }
  }

  recentEvents(podId: string, id: string): RunEvent[] {
    if (this.get(id).podId !== podId) throw new Error('Run belongs to a different pod')
    const last = this.store.db.prepare('SELECT max(sequence) AS sequence FROM run_events WHERE run_id=?').get(id)?.sequence as number | null
    return this.events(podId, id, Math.max(0, (last ?? 0) - 500))
  }

  approvals(podId: string) {
    const rows = this.store.db.prepare('SELECT e.run_id,e.data FROM run_events e JOIN runs r ON r.id=e.run_id WHERE r.pod_id=? AND r.state=\'running\' AND e.type=\'approval\' AND e.sequence=(SELECT max(newer.sequence) FROM run_events newer WHERE newer.run_id=e.run_id AND newer.type=\'approval\' AND json_extract(newer.data,\'$.grantId\')=json_extract(e.data,\'$.grantId\')) AND json_extract(e.data,\'$.state\')=\'pending\' ORDER BY e.at LIMIT 32').all(podId)
    return rows.map(row => ({ runId: row.run_id as string, ...parseRunApproval(JSON.parse(row.data as string)) })).filter(item => item.state === 'pending')
  }

  interrupt(id: string, error: string): void {
    if (this.store.db.prepare('SELECT 1 FROM network_invocations WHERE run_id=?').get(id)) throw new Error('Network interruption requires network recovery')
    this.interruptOwned(id, error)
  }

  interruptNetwork(id: string, claimToken: string): void {
    if (!this.store.db.prepare('SELECT 1 FROM network_invocations WHERE run_id=? AND claim_token=? AND boot_nonce=? AND state IN (\'running\',\'stopping\')').get(id, claimToken, this.bootId)) throw new Error('Network interruption authority is no longer current')
    this.interruptOwned(id, 'Network execution cleanup requires inspection')
  }

  private interruptOwned(id: string, error: string): void {
    this.store.transaction(() => {
      this.assertLease(id)
      this.store.db.prepare('UPDATE runs SET state=\'interrupted\',error=?,summary=\'Execution cleanup needs review\' WHERE id=?').run(error, id)
      this.store.db.prepare('UPDATE run_leases SET boot_id=? WHERE run_id=?').run(`fenced:${this.bootId}`, id)
      this.append(id, 'interrupted', { error })
    })
  }

  recover(id: string, epoch: number, failure: RecoveryFailure): void {
    const run = this.get(id)
    const pod = this.store.getPod(run.podId)
    const inputs = this.store.db.prepare('SELECT * FROM run_inputs WHERE run_id=?').get(id)!
    const initial = this.store.db.prepare('SELECT assignment_revision FROM runs WHERE id=?').get(id)!
    const changed = pod.activeScript !== run.scriptHash || pod.bindingRevision !== initial.assignment_revision || (this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(pod.id)?.epoch ?? 0) !== epoch
    const hold = changed ? 'Script or permissions changed; review before retrying' : recoveryHold(this.store, pod.id, id)
    const decision = recoveryDecision(failure, Number(inputs.retry_attempt), hold, Date.now())
    const ids = JSON.parse(inputs.event_ids as string) as string[]
    if (!ids.length && decision.disposition === 'retry') {
      const eventId = randomUUID()
      this.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state,run_id) VALUES(?,?,\'manual\',?,\'{}\',?,\'blocked\',?)').run(eventId, pod.id, `recovery:${id}`, Date.now(), id)
      this.store.db.prepare('UPDATE run_inputs SET event_ids=? WHERE run_id=?').run(JSON.stringify([eventId]), id)
    }
    this.store.db.prepare('UPDATE accepted_events SET state=?,error=? WHERE run_id=? AND state IN (\'blocked\',\'claimed\')').run(decision.disposition === 'retry' ? 'pending' : decision.disposition === 'isolated' ? 'failed' : 'blocked', decision.disposition === 'hold' ? decision.reason : run.error, id)
    this.store.db.prepare('UPDATE run_inputs SET retry_at=?,retry_attempt=?,retry_epoch=? WHERE run_id=?').run(decision.nextAt, decision.attempt, epoch, id)
    this.append(id, 'recovery', { ...decision, cause: failure.cause, retainedInputs: !!this.store.db.prepare('SELECT 1 FROM accepted_events WHERE run_id=? AND state=\'failed\' AND source NOT IN (\'schedule\',\'manual\')').get(id) })
  }

  finish(id: string, state: RunState, summary: string, error: string | null, completedInputIds: string[] = [], retryEpoch?: number, failure?: RecoveryFailure): void {
    if (this.store.db.prepare('SELECT 1 FROM network_invocations WHERE run_id=?').get(id)) throw new Error('Network completion requires atomic network settlement')
    this.finishOwned(id, state, summary, error, completedInputIds, retryEpoch, failure)
  }

  finishNetwork(id: string, claimToken: string, state: RunState, error: string | null): void {
    if (!this.store.db.prepare('SELECT 1 FROM network_invocations WHERE run_id=? AND claim_token=? AND boot_nonce=? AND state IN (\'completed\',\'failed\',\'blocked\',\'unknown\')').get(id, claimToken, this.bootId)) throw new Error('Network completion authority is no longer current')
    this.finishOwned(id, state, 'Network invocation finished', error === null ? null : 'Network invocation requires inspection')
  }

  private finishOwned(id: string, state: RunState, summary: string, error: string | null, completedInputIds: string[] = [], retryEpoch?: number, failure?: RecoveryFailure): void {
    this.store.transaction(() => {
      this.assertLease(id)
      const run = this.get(id)
      const network = this.store.db.prepare('SELECT network_id FROM network_invocations WHERE run_id=?').get(id)
      const checkpoint = network
        ? this.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=? AND network_id=?').get(run.podId, network.network_id!)
        : this.store.db.prepare('SELECT revision FROM checkpoints WHERE pod_id=?').get(run.podId)
      if (!checkpoint) throw new Error('Run checkpoint is missing')
      const revision = checkpoint.revision as number
      this.store.db.prepare('UPDATE runs SET state=?,summary=?,error=?,finished_at=?,checkpoint_revision=? WHERE id=?').run(state, summary, error, Date.now(), revision, id)
      for (const eventId of completedInputIds) {
        const result = this.store.db.prepare('UPDATE accepted_events SET state=\'processed\' WHERE id=? AND run_id=? AND state=\'claimed\'').run(eventId, id)
        if (result.changes !== 1) throw new Error('Completed input is not assigned to this run')
      }
      this.store.db.prepare('UPDATE accepted_events SET state=\'blocked\',error=? WHERE run_id=? AND state=\'claimed\'').run(error ?? 'Input was not completed; explicit retry is required', id)
      if (!network && (state !== 'completed' || this.store.db.prepare('SELECT 1 FROM accepted_events WHERE run_id=? AND state=\'blocked\'').get(id))) this.recover(id, retryEpoch ?? Number(this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(run.podId)?.epoch ?? 0), failure ?? { cause: state === 'cancelled' ? 'owner-cancelled' : retryEpoch !== undefined ? 'infrastructure' : 'failure' })
      this.append(id, 'finished', { state, summary, error, checkpointRevision: revision })
      this.store.db.prepare('DELETE FROM run_leases WHERE run_id=? AND boot_id=?').run(id, this.bootId)
    })
  }
}
