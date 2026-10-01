import { randomUUID } from 'node:crypto'
import { confirmDomainsStopped, ownerGone } from '../recovery/domains'
import type { PodDatabase } from '../storage/database'
import { canonicalNetworkJson } from './network-events'

export class NetworkRecovery {
  constructor(private readonly store: PodDatabase, private readonly helper: string) {}

  async inspect(networkId: string, runId: string, generation: number, assertCurrent: () => void): Promise<void> {
    assertCurrent()
    const invocation = this.invocation(networkId, runId, generation)
    const control = this.store.db.prepare('SELECT * FROM network_invocation_controls WHERE run_id=?').get(runId)
    const lease = this.store.db.prepare('SELECT process_id FROM run_leases WHERE run_id=?').get(runId)
    if (lease && !this.store.db.prepare('SELECT 1 FROM execution_domains WHERE run_id=?').get(runId)
      && !control?.stopped_receipt && !(lease.process_id === null && control?.creator_pid && ownerGone(Number(control.creator_pid)))) {
      throw new Error('Network process-domain evidence is missing; manual investigation is required')
    }
    await confirmDomainsStopped(this.store, runId, this.helper)
    this.store.transaction(() => {
      assertCurrent()
      this.invocation(networkId, runId, generation)
      const receipt = canonicalNetworkJson({ id: randomUUID(), inspectedAt: Date.now(), generation, processesStopped: true })
      this.store.db.prepare('INSERT INTO network_invocation_controls(run_id,stopped_receipt) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET stopped_receipt=excluded.stopped_receipt').run(runId, receipt)
      if (!this.unsafe(runId)) this.store.db.prepare('UPDATE network_invocations SET state=\'blocked\' WHERE run_id=?').run(runId)
      this.store.db.prepare('DELETE FROM run_leases WHERE run_id=? AND pod_id=?').run(runId, invocation.pod_id!)
      this.store.db.prepare('UPDATE runs SET finished_at=coalesce(finished_at,?) WHERE id=?').run(Date.now(), runId)
      this.trace(networkId, runId, 'recovery-processes-stopped', { receipt, effectsStillRequireReview: this.unsafe(runId) })
    })
  }

  requeue(networkId: string, runId: string, generation: number, authority: { fingerprint: string, resourceEpoch: number, assignmentRevision: number, scriptHash: string }, assertCurrent: () => void): void {
    this.store.transaction(() => {
      assertCurrent()
      const invocation = this.invocation(networkId, runId, generation)
      const control = this.store.db.prepare('SELECT * FROM network_invocation_controls WHERE run_id=?').get(runId)
      if (!control?.stopped_receipt || JSON.parse(control.stopped_receipt as string).generation !== generation || this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(invocation.pod_id!)) throw new Error('Inspect the stopped network process before retrying')
      if (this.unsafe(runId)) throw new Error('Unknown external effects require reconciliation before retrying')
      if (control.resolved_receipt !== null) throw new Error('The failed batch was discarded by owner; retry is disabled')
      if (control.retry_consumed_at !== null) throw new Error('Original network retry was already consumed; inspect its latest attempt')
      if (control.review_required) throw new Error('Source identity conflict requires a reviewed correction')
      if (Number(control.attempt) >= 3) throw new Error('Network retry attempts exhausted; explicit replay review is required')
      const inputs = this.store.db.prepare('SELECT * FROM network_deliveries WHERE run_id=? AND state IN (\'blocked\',\'unknown\')').all(runId)
      if (inputs.length !== (JSON.parse(invocation.manifest as string).inputClaims?.length ?? 0)) throw new Error('The original claim batch changed; retry requires review')
      const network = this.store.db.prepare('SELECT revision,activation_epoch,restore_nonce FROM networks WHERE id=?').get(networkId)!
      const namespace = { networkRevision: network.revision, activationEpoch: network.activation_epoch, restoreNonce: network.restore_nonce }
      const previousNamespace = { networkRevision: invocation.network_revision, activationEpoch: invocation.activation_epoch, restoreNonce: invocation.restore_nonce }
      const receipt = canonicalNetworkJson({ id: randomUUID(), reviewedAt: Date.now(), generation, ...authority, ...namespace, previousNamespace, namespaceChanged: canonicalNetworkJson(previousNamespace) !== canonicalNetworkJson(namespace), expiresAt: Date.now() + 300000, originalRunId: runId, effectsPermitted: false })
      for (const input of inputs) {
        this.store.db.prepare('UPDATE network_deliveries SET state=\'retry_wait\',ready_at=?,generation=generation+1,claim_token=NULL,boot_nonce=NULL,review_receipt=? WHERE id=?').run(Date.now(), receipt, input.id!)
        this.store.db.prepare('UPDATE network_queue_counts SET count=count-1 WHERE network_id=? AND state=?').run(networkId, input.state!)
      }
      if (inputs.length) this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,\'retry_wait\',?) ON CONFLICT(network_id,state) DO UPDATE SET count=count+excluded.count').run(networkId, inputs.length)
      this.store.db.prepare('UPDATE network_invocations SET state=\'blocked\',generation=generation+1,claim_token=? WHERE run_id=?').run(randomUUID(), runId)
      this.store.db.prepare('UPDATE network_invocation_controls SET retry_at=?,retry_authority=?,failure_kind=NULL WHERE run_id=?').run(Date.now(), canonicalNetworkJson({ ...authority, ...namespace, expiresAt: Date.now() + 300000 }), runId)
      this.trace(networkId, runId, 'owner-retry-reviewed', { receipt, originalBatchRetained: true })
    })
  }

  reconcileEffect(networkId: string, runId: string, generation: number, effect: { key: string, attempt: number, sequence: number, outcome: 'confirmed_applied' | 'confirmed_not_applied', evidence: string }, assertCurrent: () => void): void {
    this.store.transaction(() => {
      assertCurrent()
      this.invocation(networkId, runId, generation)
      const control = this.store.db.prepare('SELECT stopped_receipt FROM network_invocation_controls WHERE run_id=?').get(runId)
      if (!control?.stopped_receipt || JSON.parse(control.stopped_receipt as string).generation !== generation || this.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(runId)) throw new Error('Inspect the stopped process before effect reconciliation')
      const attempt = this.store.db.prepare('SELECT state FROM network_effect_attempts WHERE network_id=? AND run_id=? AND logical_action_key=? AND attempt=?').get(networkId, runId, effect.key, effect.attempt)
      const sequence = Number(this.store.db.prepare('SELECT coalesce(max(sequence),0) AS sequence FROM network_effect_receipts WHERE logical_action_key=? AND attempt=?').get(effect.key, effect.attempt)!.sequence)
      if (attempt?.state !== 'unknown' || sequence !== effect.sequence) throw new Error('Network effect reconciliation state changed')
      if (effect.outcome === 'confirmed_not_applied' && this.store.db.prepare('SELECT 1 FROM network_effect_receipts WHERE logical_action_key=? AND outcome=\'confirmed_applied\'').get(effect.key)) throw new Error('Confirmed applied effect evidence cannot be contradicted')
      const receipt = canonicalNetworkJson({ ownerEvidence: effect.evidence, reviewedAt: Date.now(), runId, generation, processesStopped: true })
      this.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,?,?,?,?,?)').run(effect.key, effect.attempt, sequence + 1, effect.outcome, receipt, Date.now())
      this.store.db.prepare('UPDATE network_effect_attempts SET state=? WHERE logical_action_key=? AND attempt=?').run(effect.outcome, effect.key, effect.attempt)
      if (!this.unsafe(runId)) {
        this.store.db.prepare('UPDATE network_invocations SET state=\'blocked\' WHERE run_id=?').run(runId)
        this.store.db.prepare('UPDATE network_invocation_controls SET failure_kind=\'recovery\',diagnostic=? WHERE run_id=?').run('External effects reconciled; explicit retry remains required', runId)
      }
      this.trace(networkId, runId, 'owner-effect-reconciled', { key: effect.key, attempt: effect.attempt, sequence: sequence + 1, outcome: effect.outcome, ownerEvidence: effect.evidence, automaticRetryPermitted: false })
    })
  }

  resolveConflict(networkId: string, runId: string, generation: number, identityHash: string, decision: 'retainOriginal' | 'discardBatch', evidence: string, assertCurrent: () => void): void {
    this.store.transaction(() => {
      assertCurrent()
      this.invocation(networkId, runId, generation)
      const control = this.store.db.prepare('SELECT * FROM network_invocation_controls WHERE run_id=?').get(runId)
      const conflict = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND run_id=? AND kind=\'source-identity-conflict-review\' ORDER BY id DESC LIMIT 1').get(networkId, runId)
      if (!control?.review_required || !control.stopped_receipt || JSON.parse(control.stopped_receipt as string).generation !== generation || this.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(runId)) throw new Error('Inspect the stopped identity conflict before resolving it')
      if (!conflict || JSON.parse(conflict.body as string).identityHash !== identityHash) throw new Error('Source identity conflict evidence changed')
      if (this.unsafe(runId)) throw new Error('Unknown external effects require reconciliation before conflict resolution')
      const detail = JSON.parse(conflict.body as string)
      const marker = this.store.db.prepare('SELECT event_id,payload_hash,schema_hash FROM network_event_identities WHERE network_id=? AND namespace=? AND identity_hash=?').get(networkId, detail.namespace, identityHash)
      if (marker && (marker.event_id !== detail.eventId || marker.payload_hash !== detail.previousPayloadHash || marker.schema_hash !== detail.previousSchemaHash)) throw new Error('Original conflict acceptance evidence changed')
      if (decision === 'retainOriginal' && !marker) throw new Error('Original acceptance rolled back; explicitly discard the conflicting batch instead')
      this.store.db.prepare('UPDATE network_invocation_controls SET review_required=0 WHERE run_id=?').run(runId)
      this.discardFailure(networkId, runId, generation, evidence, assertCurrent)
      this.trace(networkId, runId, 'owner-identity-conflict-resolved', { identityHash, generation, decision, evidence, reviewedAt: Date.now(), originalAcceptanceRetained: Boolean(marker), originalEventId: marker?.event_id ?? null, conflictingBatchRetryPermitted: false })
    })
  }

  discardFailure(networkId: string, runId: string, generation: number, evidence: string, assertCurrent: () => void): void {
    this.store.transaction(() => {
      assertCurrent()
      const invocation = this.invocation(networkId, runId, generation)
      const control = this.store.db.prepare('SELECT * FROM network_invocation_controls WHERE run_id=?').get(runId)!
      if (!control.stopped_receipt || JSON.parse(control.stopped_receipt as string).generation !== generation || this.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(runId)) throw new Error('Inspect the stopped failed invocation before discarding it')
      if (this.unsafe(runId)) throw new Error('Unknown external effects require reconciliation before discarding work')
      if (control.review_required || control.retry_consumed_at !== null) throw new Error('Resolve the identity conflict or inspect the latest retry before discarding work')
      const inputs = this.store.db.prepare('SELECT id,state FROM network_deliveries WHERE run_id=?').all(runId)
      const pins = JSON.parse(invocation.manifest as string).inputClaims ?? []
      if (inputs.length !== pins.length || inputs.some(input => !['blocked', 'unknown', 'retry_wait'].includes(input.state as string) || !pins.some((pin: { id: string }) => pin.id === input.id))) throw new Error('The original failed input batch changed')
      const process = this.store.db.prepare('SELECT preview,fingerprint,consumed_at FROM network_process_previews WHERE id=?').get(control.process_preview_id ?? '')
      const receipt = canonicalNetworkJson({ runId, generation, evidence, reviewedAt: Date.now(), inputIds: inputs.map(input => input.id), checkpointRetained: true, effectsPermitted: false, processPreview: process ? { ...JSON.parse(process.preview as string), fingerprint: process.fingerprint, consumedAt: process.consumed_at } : null })
      for (const input of inputs) {
        this.store.db.prepare('UPDATE network_deliveries SET state=\'discarded\',generation=generation+1,claim_token=NULL,boot_nonce=NULL,review_receipt=?,reason=? WHERE id=?').run(receipt, 'Failed delivery discarded by owner with retained evidence', input.id!)
        this.store.db.prepare('UPDATE network_queue_counts SET count=count-1 WHERE network_id=? AND state=?').run(networkId, input.state!)
      }
      if (inputs.length) this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,\'discarded\',?) ON CONFLICT(network_id,state) DO UPDATE SET count=count+excluded.count').run(networkId, inputs.length)
      this.store.db.prepare('UPDATE network_invocation_controls SET resolved_receipt=?,deadline=NULL,retry_at=NULL,retry_authority=NULL WHERE run_id=?').run(receipt, runId)
      this.store.db.prepare('UPDATE network_invocations SET state=\'failed\',generation=generation+1,claim_token=? WHERE run_id=?').run(randomUUID(), runId)
      this.trace(networkId, runId, 'owner-failed-invocation-discarded', { receipt, automaticRetryPermitted: false })
    })
  }

  private invocation(networkId: string, runId: string, generation: number) {
    const row = this.store.db.prepare('SELECT * FROM network_invocations WHERE network_id=? AND run_id=? AND generation=?').get(networkId, runId, generation)
    if (!row || !['interrupted', 'blocked', 'unknown'].includes(row.state as string)) throw new Error('Network recovery state changed or is not awaiting review')
    return row
  }

  private unsafe(runId: string): boolean {
    return Boolean(this.store.db.prepare('SELECT 1 FROM network_effect_attempts e WHERE e.run_id=? AND (e.state IN (\'intent\',\'unknown\') OR NOT EXISTS(SELECT 1 FROM network_effect_receipts r WHERE r.logical_action_key=e.logical_action_key AND r.attempt=e.attempt AND r.outcome=e.state)) UNION ALL SELECT 1 FROM effect_ledger WHERE run_id=? AND state IN (\'intent\',\'unknown\') UNION ALL SELECT 1 FROM network_gate_task_attempts WHERE run_id=? AND state=\'unknown\' LIMIT 1').get(runId, runId, runId))
  }

  private trace(networkId: string, runId: string, kind: string, body: unknown): void {
    this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(networkId, runId, kind, canonicalNetworkJson(body), Date.now())
  }
}
