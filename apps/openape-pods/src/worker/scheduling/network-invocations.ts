import { occupiedRunSlots } from '../runs/slots'
import { recoveryDecision, recoveryHold } from '../recovery/policy'
import type { RecoveryFailure } from '../recovery/policy'
import { NetworkData } from './network-data'
import { emptyNetworkDataPin, networkConfiguration, networkDataPin, networkLegacyVariables } from './network-config'
import type { NetworkGates } from './network-gates'
import type { NetworkGateManifest } from '../../contracts/network-gates'
import { assertNetworkQuota, NetworkQuotaError } from './network-quota'
import { randomUUID } from 'node:crypto'
import { networkGateOutput, parseNetworkDefinition, networkLimits  } from '../../contracts/networks'
import type { RunState } from '../../contracts/runs'
import type { RunStore } from '../runs/store'
import { parseProgress } from '../runs/progress'
import { confirmDomainsStopped } from '../recovery/domains'
import type { PodDatabase } from '../storage/database'
import { NetworkEvents, NetworkEventConflict, canonicalNetworkJson } from './network-events'
import type { NetworkAuthority, NetworkEmission } from './network-events'
import type { WorkflowCalls } from '../workflows/calls'

/** Unresolved unknown effects of one member that stop it, even when each holds back only its own input. */
const memberStopThreshold = 2

/** Why a member may not start new work because of its external effects, or null. A held unknown effect blocks only its own input. */
export function memberEffectHold(store: PodDatabase, podId: string): string | null {
  if (store.db.prepare(`SELECT 1 FROM network_effect_attempts e JOIN network_invocations i ON i.run_id=e.run_id WHERE i.pod_id=? AND e.state='intent'
    UNION ALL SELECT 1 FROM effect_ledger WHERE pod_id=? AND state IN ('intent','unknown') LIMIT 1`).get(podId, podId)) {
    return 'Network instance has an external effect requiring review'
  }
  const unknown = Number(store.db.prepare(`SELECT count(*) AS count FROM network_effect_attempts e JOIN network_invocations i ON i.run_id=e.run_id WHERE i.pod_id=? AND e.state='unknown'`).get(podId)!.count)
  return unknown >= memberStopThreshold ? 'Network member stopped after repeated unknown external outcomes; reconcile them first' : null
}

export class NetworkInvocations {
  gates?: NetworkGates
  calls?: WorkflowCalls
  readonly events: NetworkEvents
  readonly data: NetworkData
  constructor(private readonly store: PodDatabase, private readonly runs: RunStore, private readonly helper: string) {
    this.events = new NetworkEvents(store, runs.bootId)
    this.data = new NetworkData(store, this.events)
    this.events.artifacts = this.data.artifacts
  }

  reserveGate(manifest: NetworkGateManifest, reason: 'manual' | 'event', processPreviewId: string | null): NetworkAuthority | null {
    return this.store.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=?').get(manifest.podId, manifest.podId)) return null
      const reservation = this.runs.reserve(manifest.podId, manifest.scriptHash, manifest.resourceEpoch, { reason, eventIds: [] })
      if (reservation.existing) throw new Error('Network gate instance lease changed during admission')
      const network = this.store.db.prepare('SELECT restore_nonce,activation_epoch FROM networks WHERE id=?').get(manifest.networkId)!
      const token = randomUUID()
      const checkpoint = this.store.db.prepare('SELECT revision FROM network_checkpoints WHERE network_id=? AND pod_id=?').get(manifest.networkId, manifest.podId)!
      const pins = { resourceEpoch: manifest.resourceEpoch, assignmentRevision: manifest.assignmentRevision, definitionId: manifest.definitionId, definitionVersion: manifest.definitionVersion, bindingRevision: manifest.bindingRevision, reason, checkpointRevision: checkpoint.revision, inputClaims: [], gateTaskId: manifest.id }
      this.store.db.prepare(`INSERT INTO network_invocations(run_id,network_id,network_revision,pod_id,boot_nonce,restore_nonce,activation_epoch,claim_token,generation,state,manifest,execution_kind)
        VALUES(?,?,?,?,?,?,?,?,1,'running',?,'gate_maintenance')`).run(reservation.run.id, manifest.networkId, manifest.networkRevision, manifest.podId, this.runs.bootId, network.restore_nonce!, network.activation_epoch!, token, canonicalNetworkJson(pins))
      this.store.db.prepare('INSERT INTO network_invocation_controls(run_id,deadline,creator_pid,process_preview_id) VALUES(?,?,?,?)').run(reservation.run.id, Date.now() + 30000, process.pid, processPreviewId)
      return { runId: reservation.run.id, claimToken: token }
    })
  }

  reserve(networkId: string, podId: string, resourceEpoch: number, reason: 'manual' | 'schedule' | 'event', allowPaused: boolean = false, processPreviewId: string | null = null): NetworkAuthority | null {
    this.store.assertStorage()
    return this.store.transaction(() => {
      const network = this.store.db.prepare('SELECT * FROM networks WHERE id=?').get(networkId)
      if (!network || network.state === 'archived' || network.baseline_state !== 'ready' || (network.state !== 'active' && reason !== 'manual')) return null
      const revision = this.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=? AND revision=?').get(networkId, network.revision!)!
      const definition = parseNetworkDefinition(JSON.parse(revision.contract as string))
      const member = definition.members.find(item => item.podId === podId)
      if (!member) throw new Error('Pod is not a member of this network revision')
      const pod = this.store.getPod(podId)
      if (pod.lifecycle === 'archived' || (pod.lifecycle !== 'active' && !(reason === 'manual' && allowPaused))) return null
      const hold = memberEffectHold(this.store, podId)
      if (hold) throw new Error(hold)
      if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=?').get(podId, podId)) return null
      if (this.store.db.prepare('SELECT 1 FROM network_invocations WHERE pod_id=? AND state IN (\'running\',\'stopping\',\'interrupted\',\'unknown\') LIMIT 1').get(podId)) throw new Error('Network instance requires recovery before another invocation')
      if (this.store.db.prepare('SELECT 1 FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.pod_id=? AND c.review_required=1 LIMIT 1').get(podId)) throw new Error('Network source identity conflict requires owner review')
      const maximum = this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number
      if (occupiedRunSlots(this.store) >= maximum) return null
      const pin = this.store.db.prepare('SELECT content_hash FROM pod_definition_versions WHERE definition_id=? AND version=?').get(member.definitionId, member.definitionVersion)
      if (!pin || pin.content_hash !== pod.activeScript) throw new Error('Network instance no longer matches its pinned script')
      const sourceRetry = member.source ? this.store.db.prepare('SELECT i.run_id,i.manifest,c.attempt FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.network_id=? AND i.pod_id=? AND i.state=\'blocked\' AND c.retry_at<=? AND (json_extract(i.manifest,\'$.reason\')!=\'manual\' OR ?=1) ORDER BY c.retry_at,i.rowid LIMIT 1').get(networkId, podId, Date.now(), reason === 'manual' ? 1 : 0) : null
      const join = definition.joins?.find(join => join.podId === podId)
      const gatedInputs = definition.gates?.filter(gate => gate.podId === podId).map(gate => gate.channel) ?? []
      const ready = member.source ? [] : join ? this.events.joins.ready(networkId, definition.revision, join, reason === 'manual', gatedInputs) : this.ready(networkId, definition.revision, podId, reason === 'manual', gatedInputs)
      if (!member.source && !ready.length) return null
      const gateBindings: { taskId: string, grantId: string, manifestHash: string }[] = []
      const gatedChannels = new Set(definition.gates?.filter(gate => gate.podId === podId).map(gate => gate.channel) ?? [])
      for (const input of ready) {
        if (!gatedChannels.has(input.channel as string)) continue
        const binding = this.gates?.binding(input.id as string)
        if (!binding) return null
        if (!gateBindings.some(item => item.taskId === binding.taskId)) gateBindings.push(binding)
      }
      const originalRunId = sourceRetry?.run_id ?? ready[0]?.run_id ?? null
      const previous = originalRunId ? this.store.db.prepare('SELECT i.manifest,i.network_revision,i.activation_epoch,i.restore_nonce,c.attempt,c.retry_authority,r.script_hash FROM network_invocations i JOIN runs r ON r.id=i.run_id JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.run_id=?').get(originalRunId) : null
      if (previous) {
        const pins = previous.retry_authority ? JSON.parse(previous.retry_authority as string) : { ...JSON.parse(previous.manifest as string), scriptHash: previous.script_hash }
        if ((pins.networkRevision ?? previous.network_revision) !== definition.revision || (pins.activationEpoch ?? previous.activation_epoch) !== network.activation_epoch || (pins.restoreNonce ?? previous.restore_nonce) !== network.restore_nonce || pins.assignmentRevision !== pod.bindingRevision || pins.resourceEpoch !== resourceEpoch || pins.scriptHash !== pod.activeScript || (pins.dataPin ?? emptyNetworkDataPin) !== networkDataPin(this.store, networkId, podId) || (pins.expiresAt !== undefined && pins.expiresAt <= Date.now())) {
          const blocked = this.store.db.prepare('SELECT state,count(*) AS count FROM network_deliveries WHERE run_id=? AND state=\'retry_wait\' GROUP BY state').get(originalRunId!)
          this.store.db.prepare('UPDATE network_deliveries SET state=\'blocked\',reason=\'Script or permissions changed during infrastructure retry\' WHERE run_id=? AND state=\'retry_wait\'').run(originalRunId!)
          this.store.db.prepare('UPDATE network_invocation_controls SET retry_at=NULL,failure_kind=\'invalid\',diagnostic=\'Pinned network, script, permissions or owner retry deadline changed\' WHERE run_id=?').run(originalRunId!)
          this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(networkId, originalRunId!, 'retry-authority-invalidated', canonicalNetworkJson({ reason: 'Pinned network, script, permissions or owner retry deadline changed', originalRunId }), Date.now())
          if (blocked) { this.count(networkId, 'retry_wait', -Number(blocked.count)); this.count(networkId, 'blocked', Number(blocked.count)) }
          return null
        }
        reason = JSON.parse(previous.manifest as string).reason
      }
      const attempt = Number(previous?.attempt ?? 0) + 1
      if (attempt > 3) throw new Error('Network retry attempts exhausted')
      assertNetworkQuota(this.store, 16384)
      const reservation = this.runs.reserve(podId, pod.activeScript!, resourceEpoch, { reason, eventIds: [] })
      if (reservation.existing) throw new Error('Network instance lease changed during admission')
      const runId = reservation.run.id; const token = randomUUID()
      if (join) this.events.joins.claim(networkId, join, ready[0]!.case_id as string, Number(ready[0]!.case_revision))
      const checkpoint = this.store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE pod_id=? AND network_id=?').get(podId, networkId)
      if (!checkpoint) throw new Error('Network instance has no private checkpoint')
      const manifest = { resourceEpoch, assignmentRevision: pod.bindingRevision, definitionId: member.definitionId, definitionVersion: member.definitionVersion, bindingRevision: member.bindingRevision, reason, checkpointRevision: checkpoint.revision, dataPin: networkDataPin(this.store, networkId, podId), gateBindings, inputClaims: ready.map(input => ({ id: input.id, generation: Number(input.generation) + 1 })) }
      this.store.db.prepare(`INSERT INTO network_invocations(run_id,network_id,network_revision,pod_id,boot_nonce,restore_nonce,activation_epoch,claim_token,generation,state,manifest)
        VALUES(?,?,?,?,?,?,?,?,1,'running',?)`).run(runId, networkId, definition.revision, podId, this.runs.bootId, network.restore_nonce!, network.activation_epoch!, token, canonicalNetworkJson(manifest))
      this.store.db.prepare('INSERT INTO network_invocation_controls(run_id,deadline,retry_of,attempt,creator_pid,process_preview_id) VALUES(?,?,?,?,?,?)').run(runId, Date.now() + 360000, originalRunId, attempt, process.pid, processPreviewId)
      if (originalRunId) this.store.db.prepare('UPDATE network_invocation_controls SET retry_at=NULL,retry_consumed_at=? WHERE run_id=?').run(Date.now(), originalRunId)
      for (const input of ready) {
        const claimed = this.store.db.prepare(`UPDATE network_deliveries SET state='claimed',attempt=attempt+1,generation=generation+1,claim_token=?,boot_nonce=?,restore_nonce=?,activation_epoch=?,run_id=?
          WHERE id=? AND state IN ('pending','retry_wait') AND ready_at<=? AND attempt<3`).run(token, this.runs.bootId, network.restore_nonce!, network.activation_epoch!, runId, input.id!, Date.now())
        if (claimed.changes !== 1) throw new Error('Network input is no longer ready')
      }
      for (const input of ready) this.count(networkId, input.state as string, -1)
      if (ready.length) this.count(networkId, 'claimed', ready.length)
      const authority = { runId, claimToken: token }
      this.events.authority(authority)
      return authority
    })
  }

  input(authority: NetworkAuthority) {
    const { row, definition, member } = this.data.authority(authority)
    const checkpoint = this.store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE network_id=? AND pod_id=?').get(definition.id, member.podId)!
    const items = this.store.db.prepare(`SELECT e.id,e.item_key,e.channel,e.payload,e.case_id,e.case_revision FROM network_deliveries d JOIN network_events e ON e.id=d.event_id
      WHERE d.run_id=? AND d.state='claimed' ORDER BY d.accepted_at,d.id`).all(authority.runId).map(item => ({ eventId: item.id as string, key: item.item_key as string, channel: networkGateOutput(definition, definition.gates?.find(gate => gate.podId === member.podId && gate.channel === item.channel)?.key ?? '', item.channel as string), data: JSON.parse(item.payload as string) as Record<string, unknown>, artifacts: this.events.references(item.id as string), caseId: item.case_id as string, caseRevision: item.case_revision as number }))
    return { variables: networkLegacyVariables(this.store, definition.id), config: networkConfiguration(this.store, definition.id, member.podId), network: { id: definition.id, revision: definition.revision, source: member.source !== null }, items, checkpoint: { revision: checkpoint.revision as number, body: JSON.parse(checkpoint.body as string) as Record<string, unknown> }, resourceEpoch: (JSON.parse(row.manifest as string) as { resourceEpoch: number }).resourceEpoch }
  }

  recordConflict(authority: NetworkAuthority, failure: unknown): void {
    if (failure instanceof NetworkQuotaError) {
      const { definition } = this.events.authority(authority, true)
      this.store.transaction(() => {
        this.store.db.prepare('UPDATE networks SET state=\'paused\' WHERE id=?').run(definition.id)
        this.store.db.prepare('UPDATE network_invocation_controls SET failure_kind=\'quota\' WHERE run_id=?').run(authority.runId)
        this.store.db.prepare('INSERT INTO network_runtime_status(network_id,intake_error,inspected_at) VALUES(?,?,?) ON CONFLICT(network_id) DO UPDATE SET intake_error=excluded.intake_error,inspected_at=excluded.inspected_at').run(definition.id, failure.message, Date.now())
      })
      return
    }
    if (!(failure instanceof NetworkEventConflict)) return
    this.store.transaction(() => {
      const { definition } = this.events.authority(authority, true)
      this.store.db.prepare('UPDATE network_invocation_controls SET review_required=1 WHERE run_id=?').run(authority.runId)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(definition.id, authority.runId, 'source-identity-conflict-review', canonicalNetworkJson(failure.detail), Date.now())
    })
  }

  stageProgress(authority: NetworkAuthority, payload: unknown): { revision: number } {
    return this.store.transaction(() => {
      const { row, definition, member } = this.data.authority(authority)
      const progress = parseProgress(payload)
      if (progress.sources.length || progress.claims.length) throw new Error('Network knowledge writes require a scoped data port')
      const committed = this.store.db.prepare('SELECT revision FROM network_checkpoints WHERE network_id=? AND pod_id=?').get(definition.id, member.podId)!.revision as number
      const staged = row.staged_checkpoint === null ? null : JSON.parse(row.staged_checkpoint as string) as { revision: number }
      if (progress.expectedRevision !== (staged?.revision ?? committed)) throw new Error('Network checkpoint revision changed')
      const revision = progress.expectedRevision + 1
      const body = canonicalNetworkJson({ revision, body: progress.checkpoint })
      if (Buffer.byteLength(body) > 64 * 1024) throw new Error('Network checkpoint exceeds 64 KiB')
      this.store.db.prepare('UPDATE network_invocations SET staged_checkpoint=? WHERE run_id=?').run(body, authority.runId)
      return { revision }
    })
  }

  async finish(authority: NetworkAuthority, state: RunState, summary: string, error: string | null, completedInputIds: string[], emissions: NetworkEmission[], failure: RecoveryFailure | boolean = { cause: 'failure' }): Promise<void> {
    if (!['completed', 'completedWithGaps', 'failed', 'cancelled', 'blocked'].includes(state)) throw new Error('Network settlement requires a terminal script result')
    this.store.transaction(() => {
      this.events.authority(authority, true)
      this.store.db.prepare('UPDATE network_invocations SET state=\'stopping\' WHERE run_id=?').run(authority.runId)
    })
    try { await confirmDomainsStopped(this.store, authority.runId, this.helper) }
    catch (failure) { this.interrupt(authority, failure instanceof Error ? failure.message : 'Execution cleanup is unverified'); return }
    this.settle(authority, state, summary, error, completedInputIds, emissions, typeof failure === 'boolean' ? { cause: failure ? 'infrastructure' : state === 'cancelled' ? 'owner-cancelled' : 'failure' } : failure)
  }

  async finishGate(authority: NetworkAuthority, summary: string, settleTask: () => void, incomplete = false): Promise<void> {
    const { row } = this.events.authority(authority, true)
    if (row.execution_kind !== 'gate_maintenance') throw new Error('Gate settlement requires a maintenance invocation')
    this.store.transaction(() => {
      this.events.authority(authority, true)
      this.store.db.prepare('UPDATE network_invocations SET state=\'stopping\' WHERE run_id=?').run(authority.runId)
    })
    await confirmDomainsStopped(this.store, authority.runId, this.helper)
    this.store.transaction(() => {
      this.events.authority(authority, true)
      settleTask()
      this.settle(authority, incomplete ? 'completedWithGaps' : 'completed', summary, incomplete ? summary : null, [], [], { cause: 'owner-cancelled' })
      if (incomplete) this.store.db.prepare('UPDATE network_invocation_controls SET resolved_receipt=? WHERE run_id=?').run(canonicalNetworkJson({ kind: 'gate-maintenance-step', taskId: JSON.parse(row.manifest as string).gateTaskId, summary, at: Date.now(), noScriptLaunched: true }), authority.runId)
    })
  }

  async closeGateFailure(authority: NetworkAuthority, failure: unknown): Promise<void> {
    await this.failClosed(authority, failure)
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT i.*,c.stopped_receipt FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.run_id=?').get(authority.runId)!
      if (row.execution_kind !== 'gate_maintenance' || !row.stopped_receipt || JSON.parse(row.stopped_receipt as string).generation !== row.generation) throw new Error('Failed gate step requires verified process cleanup')
      if (this.store.db.prepare('SELECT 1 FROM network_effect_attempts WHERE run_id=? UNION ALL SELECT 1 FROM effect_ledger WHERE run_id=? LIMIT 1').get(authority.runId, authority.runId)) throw new Error('Gate maintenance cannot release external action evidence')
      this.store.db.prepare('UPDATE network_invocations SET state=\'blocked\' WHERE run_id=?').run(authority.runId)
      this.store.db.prepare('UPDATE network_invocation_controls SET resolved_receipt=? WHERE run_id=?').run(canonicalNetworkJson({ kind: 'gate-maintenance-stopped', taskId: JSON.parse(row.manifest as string).gateTaskId, grantOutcome: 'requires-task-review', generation: row.generation, at: Date.now() }), authority.runId)
      this.store.db.prepare('DELETE FROM run_leases WHERE run_id=? AND pod_id=?').run(authority.runId, row.pod_id!)
      this.store.db.prepare('UPDATE runs SET finished_at=coalesce(finished_at,?) WHERE id=?').run(Date.now(), authority.runId)
    })
  }

  async failClosed(authority: NetworkAuthority, failure: unknown): Promise<void> {
    let reason = failure instanceof Error ? failure.message : 'Network settlement failed'
    let processesStopped = false
    try { await confirmDomainsStopped(this.store, authority.runId, this.helper); processesStopped = true }
    catch (stopFailure) { reason += `; ${stopFailure instanceof Error ? stopFailure.message : 'Execution cleanup is unverified'}` }
    this.interrupt(authority, reason, processesStopped)
  }

  private interrupt(authority: NetworkAuthority, reason: string, processesStopped = false): void {
    this.store.transaction(() => {
      const invocation = this.store.db.prepare(`SELECT i.network_id FROM network_invocations i JOIN run_leases l ON l.run_id=i.run_id AND l.pod_id=i.pod_id
        WHERE i.run_id=? AND i.claim_token=? AND i.boot_nonce=? AND l.boot_id=? AND i.state IN ('running','stopping')`).get(authority.runId, authority.claimToken, this.runs.bootId, this.runs.bootId)
      if (!invocation) throw new Error('Network interruption authority is no longer current')
      const networkId = invocation.network_id as string
      this.runs.interruptNetwork(authority.runId, authority.claimToken)
      const unsafe = this.store.db.prepare('SELECT 1 FROM network_effect_attempts WHERE run_id=? AND state IN (\'intent\',\'unknown\') LIMIT 1').get(authority.runId)
      for (const effect of this.store.db.prepare('SELECT logical_action_key,attempt FROM network_effect_attempts WHERE run_id=? AND state=\'intent\'').all(authority.runId)) {
        const sequence = Number(this.store.db.prepare('SELECT coalesce(max(sequence),0)+1 AS sequence FROM network_effect_receipts WHERE logical_action_key=? AND attempt=?').get(effect.logical_action_key!, effect.attempt!)!.sequence)
        this.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,?,?,\'unknown\',?,?)').run(effect.logical_action_key!, effect.attempt!, sequence, canonicalNetworkJson({ reason: 'Process termination is unverified' }), Date.now())
      }
      this.store.db.prepare('UPDATE network_effect_attempts SET state=\'unknown\' WHERE run_id=? AND state=\'intent\'').run(authority.runId)
      const count = Number(this.store.db.prepare('SELECT count(*) AS count FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').get(authority.runId)!.count)
      const nextState = unsafe ? 'unknown' : 'blocked'
      this.store.db.prepare('UPDATE network_deliveries SET state=?,generation=generation+1,claim_token=NULL,boot_nonce=NULL,reason=\'Process termination requires inspection\' WHERE run_id=? AND state=\'claimed\'').run(nextState, authority.runId)
      if (count) { this.count(networkId, 'claimed', -count); this.count(networkId, nextState, count) }
      this.store.db.prepare('UPDATE network_invocations SET state=?,generation=generation+1,claim_token=? WHERE run_id=?').run(unsafe ? 'unknown' : 'interrupted', randomUUID(), authority.runId)
      const generation = this.store.db.prepare('SELECT generation FROM network_invocations WHERE run_id=?').get(authority.runId)!.generation
      this.store.db.prepare('UPDATE network_invocation_controls SET deadline=NULL,diagnostic=?,failure_kind=?,stopped_receipt=? WHERE run_id=?').run(reason.slice(0, 10000), unsafe ? 'uncertain' : 'recovery', processesStopped ? canonicalNetworkJson({ generation, processesStopped: true, inspectedAt: Date.now() }) : null, authority.runId)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(networkId, authority.runId, 'process-stop-unverified', canonicalNetworkJson({ reason: reason.slice(0, 10000), leaseRetained: true }), Date.now())
    })
  }

  private settle(authority: NetworkAuthority, state: RunState, summary: string, error: string | null, completedInputIds: string[], emissions: NetworkEmission[], failure: RecoveryFailure): void {
    if (!['completed', 'completedWithGaps', 'failed', 'cancelled', 'blocked'].includes(state)) throw new Error('Network settlement requires a terminal script result')
    if (summary.length > 10000 || (error !== null && error.length > 10000)) throw new Error('Network settlement diagnostic exceeds its size limit')
    this.store.transaction(() => {
      const { row, definition, member } = this.events.authority(authority, true)
      const inputs = this.store.db.prepare('SELECT id,event_id FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(authority.runId)
      const completed = state === 'completed'
      if (completed && row.execution_kind === 'script') this.data.authority(authority, true)
      if (completed && row.execution_kind === 'script' && JSON.parse(row.manifest as string).gateBindings?.length) {
        if (!this.gates) throw new Error('Network approval authority is unavailable at settlement')
        this.gates.coverage(authority, true)
      }
      const deadline = this.store.db.prepare('SELECT deadline FROM network_invocation_controls WHERE run_id=?').get(authority.runId)?.deadline
      if (completed && deadline !== null && deadline !== undefined && Number(deadline) <= Date.now()) throw new Error('Network invocation deadline expired before settlement')
      const effects = this.store.db.prepare(`SELECT e.logical_action_key,e.attempt,e.state,
        (SELECT max(sequence) FROM network_effect_receipts r WHERE r.logical_action_key=e.logical_action_key AND r.attempt=e.attempt AND r.outcome=e.state) AS receipt
        FROM network_effect_attempts e WHERE e.run_id=? ORDER BY e.logical_action_key,e.attempt`).all(authority.runId)
      // A completed script reported each tool outcome; an unknown one holds back only the input it belongs to. Open effects or a failed script stay run failures.
      const open = effects.some(effect => effect.state === 'intent' || effect.receipt === null)
      const unknownInputs = completed && !open ? this.unknownEffectInputs(authority.runId) : []
      const held = [...new Set(unknownInputs)].filter(id => id !== null)
      const isolated = !open && unknownInputs.every(id => id !== null && inputs.some(input => input.id === id))
      const unsafe = open || (effects.some(effect => effect.state === 'unknown') && !(completed && isolated))
      if (completed && unsafe) throw new Error('Network effects require reconciliation before successful settlement')
      if (completed && (new Set(completedInputIds).size !== inputs.length || inputs.some(input => !completedInputIds.includes(input.event_id as string)))) throw new Error('Network completion must acknowledge every claimed input')
      if (emissions.length > 500) throw new Error('Network invocation exceeds 500 emissions')
      if (completed) {
        this.data.commit(authority)
        this.calls?.commit(authority)
        for (const emission of emissions) this.events.accept(authority, emission, true)
        if (row.staged_checkpoint !== null) {
          const staged = JSON.parse(row.staged_checkpoint as string) as { revision: number, body: Record<string, unknown> }
          const manifest = JSON.parse(row.manifest as string) as { checkpointRevision: number }
          const updated = this.store.db.prepare('UPDATE network_checkpoints SET revision=?,body=? WHERE network_id=? AND pod_id=? AND revision=?').run(staged.revision, canonicalNetworkJson(staged.body), definition.id, member.podId, manifest.checkpointRevision)
          if (updated.changes !== 1) throw new Error('Network checkpoint changed before settlement')
        }
      }
      for (const effect of effects) {
        if (effect.state !== 'intent') continue
        const sequence = Number(this.store.db.prepare('SELECT coalesce(max(sequence),0)+1 AS sequence FROM network_effect_receipts WHERE logical_action_key=? AND attempt=?').get(effect.logical_action_key!, effect.attempt!)!.sequence)
        this.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,?,?,\'unknown\',?,?)').run(effect.logical_action_key!, effect.attempt!, sequence, canonicalNetworkJson({ reason: 'Invocation stopped with an unresolved effect' }), Date.now())
        this.store.db.prepare('UPDATE network_effect_attempts SET state=\'unknown\' WHERE logical_action_key=? AND attempt=?').run(effect.logical_action_key!, effect.attempt!)
      }
      const control = this.store.db.prepare('SELECT attempt,review_required,failure_kind FROM network_invocation_controls WHERE run_id=?').get(authority.runId)!
      const requiresFreshGate = Boolean(JSON.parse(row.manifest as string).gateBindings?.length)
      const decision = recoveryDecision(failure, Number(control.attempt) - 1, unsafe ? 'External outcome requires reconciliation' : control.review_required ? 'Source identity conflict requires owner review' : control.failure_kind === 'quota' ? 'Capacity requires owner review' : requiresFreshGate ? 'A fresh approval is required' : recoveryHold(this.store, member.podId, authority.runId), Date.now(), 3)
      const retry = !completed && decision.disposition === 'retry'
      if (retry) this.calls?.abandonUnacceptedRetry(authority.runId)
      const retryAt = retry ? decision.nextAt : null
      const nextState = unsafe ? 'unknown' : completed ? 'done' : retry ? 'retry_wait' : 'blocked'
      this.store.db.prepare('UPDATE network_invocation_controls SET deadline=NULL,retry_at=?,failure_kind=?,diagnostic=?,stopped_receipt=? WHERE run_id=?').run(retryAt, completed ? null : unsafe ? 'uncertain' : control.failure_kind === 'quota' ? 'quota' : requiresFreshGate ? 'recovery' : decision.disposition === 'hold' ? 'recovery' : retry ? 'transient' : 'exhausted', error, canonicalNetworkJson({ processesStopped: true, generation: row.generation, inspectedAt: Date.now() }), authority.runId)
      if (retryAt !== null) this.store.db.prepare('UPDATE network_deliveries SET ready_at=? WHERE run_id=? AND state=\'claimed\'').run(retryAt, authority.runId)
      if (held.length) {
        this.store.db.prepare('UPDATE network_deliveries SET state=\'unknown\',claim_token=NULL,reason=? WHERE run_id=? AND state=\'claimed\' AND id IN (SELECT value FROM json_each(?))').run('External outcome is unknown; reconcile it', authority.runId, JSON.stringify(held))
        this.count(definition.id, 'claimed', -held.length); this.count(definition.id, 'unknown', held.length)
      }
      this.store.db.prepare('UPDATE network_deliveries SET state=?,claim_token=NULL,reason=? WHERE run_id=? AND state=\'claimed\'').run(nextState, completed ? null : error ?? summary, authority.runId)
      if (inputs.length > held.length) { this.count(definition.id, 'claimed', held.length - inputs.length); this.count(definition.id, nextState, inputs.length - held.length) }
      if (!unsafe) this.data.clear(authority.runId)
      this.store.db.prepare('UPDATE network_invocations SET state=?,staged_checkpoint=NULL WHERE run_id=?').run(unsafe ? 'unknown' : completed ? 'completed' : 'blocked', authority.runId)
      const effectReceipts = this.store.db.prepare('SELECT r.logical_action_key,r.attempt,max(r.sequence) AS sequence FROM network_effect_receipts r JOIN network_effect_attempts e ON e.logical_action_key=r.logical_action_key AND e.attempt=r.attempt WHERE e.run_id=? GROUP BY r.logical_action_key,r.attempt').all(authority.runId)
      const process = this.store.db.prepare('SELECT p.preview,p.fingerprint,p.consumed_at FROM network_process_previews p JOIN network_invocation_controls c ON c.process_preview_id=p.id WHERE c.run_id=?').get(authority.runId)
      const receipt = canonicalNetworkJson({ state: unsafe ? 'unknown' : state, summary, error, effectReceipts, ...(held.length ? { heldInputIds: held } : {}), processPreview: process ? { ...JSON.parse(process.preview as string), fingerprint: process.fingerprint, consumedAt: process.consumed_at } : null, settledAt: Date.now() })
      this.store.db.prepare('UPDATE network_invocation_controls SET settlement_receipt=? WHERE run_id=?').run(receipt, authority.runId)
      const cases = this.store.db.prepare(`SELECT DISTINCT case_id FROM network_deliveries WHERE network_id=? AND run_id=?
        UNION SELECT case_id FROM network_events WHERE network_id=? AND json_extract(origin,'$.invocationId')=?`).all(definition.id, authority.runId, definition.id, authority.runId)
      for (const caseId of cases.length ? cases.map(row => row.case_id!) : [null]) this.store.db.prepare('INSERT INTO network_trace_events(network_id,case_id,run_id,event_id,kind,body,created_at) VALUES(?,?,?,NULL,?,?,?)').run(definition.id, caseId, authority.runId, 'invocation-settled', receipt, Date.now())
      this.runs.finishNetwork(authority.runId, authority.claimToken, unsafe ? 'blocked' : state, unsafe ? 'Network effect outcome is unknown' : error)
    })
  }

  /** For each unknown effect of a run, the input named in its intent, or null when it names none. */
  private unknownEffectInputs(runId: string): (string | null)[] {
    return this.store.db.prepare(`SELECT json_extract(intent.body,'$.deliveryId') AS delivery_id FROM network_effect_attempts e
      LEFT JOIN network_effect_receipts intent ON intent.logical_action_key=e.logical_action_key AND intent.attempt=e.attempt AND intent.outcome='intent'
      WHERE e.run_id=? AND e.state='unknown'`).all(runId).map(row => typeof row.delivery_id === 'string' ? row.delivery_id : null)
  }

  private ready(networkId: string, revision: number, podId: string, manual: boolean, gatedChannels: string[]) {
    const first = this.store.db.prepare(`SELECT d.case_id,d.case_revision,d.run_id,d.state,s.channel FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id
      WHERE s.network_id=? AND s.network_revision=? AND s.pod_id=? AND d.state IN ('pending','retry_wait') AND d.ready_at<=? AND d.attempt<3
      AND (s.channel NOT IN (SELECT value FROM json_each(?)) OR (d.state='pending' AND EXISTS(
        SELECT 1 FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id
        WHERE item.delivery_id=d.id AND item.outcome='released' AND task.state='approved')))
      AND (d.state!='retry_wait' OR ?=1 OR json_extract((SELECT manifest FROM network_invocations WHERE run_id=d.run_id),'$.reason')!='manual')
      AND (s.serial_case=0 OR NOT EXISTS(SELECT 1 FROM network_deliveries busy JOIN network_subscriptions bs ON bs.id=busy.subscription_id WHERE busy.network_id=d.network_id AND busy.case_id=d.case_id AND busy.state='claimed' AND bs.pod_id=s.pod_id AND bs.serial_case=1))
      ORDER BY d.accepted_at,d.id LIMIT 1`).get(networkId, revision, podId, Date.now(), JSON.stringify(gatedChannels), manual ? 1 : 0)
    if (!first) return []
    if (first.state === 'retry_wait') {
      const batch = this.store.db.prepare('SELECT d.*,s.channel FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE d.run_id=? ORDER BY d.accepted_at,d.id').all(first.run_id!)
      const original = this.store.db.prepare('SELECT manifest FROM network_invocations WHERE run_id=?').get(first.run_id!)!
      const pins = JSON.parse(original.manifest as string).inputClaims as { id: string }[]
      if (batch.length !== pins.length || batch.some(input => input.state !== 'retry_wait' || Number(input.ready_at) > Date.now() || Number(input.attempt) >= 3 || !pins.some(pin => pin.id === input.id))) throw new Error('Original network retry batch is not ready')
      return batch
    }
    return this.store.db.prepare(`SELECT d.*,s.channel FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id
      WHERE s.network_id=? AND s.network_revision=? AND s.pod_id=? AND d.state='pending' AND d.run_id IS NULL AND d.ready_at<=? AND d.case_id=? AND d.case_revision=?
      AND (s.channel NOT IN (SELECT value FROM json_each(?)) OR (d.state='pending' AND EXISTS(
        SELECT 1 FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id
        WHERE item.delivery_id=d.id AND item.outcome='released' AND task.state='approved')))
      AND ((?=0 AND s.channel NOT IN (SELECT value FROM json_each(?))) OR (?=1 AND s.channel=?))
      ORDER BY d.accepted_at,d.id LIMIT ?`).all(networkId, revision, podId, Date.now(), first.case_id!, first.case_revision!, JSON.stringify(gatedChannels), gatedChannels.includes(first.channel as string) ? 1 : 0, JSON.stringify(gatedChannels), gatedChannels.includes(first.channel as string) ? 1 : 0, first.channel!, networkLimits.batch)
  }

  private count(networkId: string, state: string, delta: number): void {
    if (delta < 0) {
      const changed = this.store.db.prepare('UPDATE network_queue_counts SET count=count+? WHERE network_id=? AND state=? AND count>=?').run(delta, networkId, state, -delta)
      if (changed.changes !== 1) throw new Error('Network queue projection is inconsistent')
      return
    }
    this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,?,?) ON CONFLICT(network_id,state) DO UPDATE SET count=count+excluded.count').run(networkId, state, delta)
  }
}
