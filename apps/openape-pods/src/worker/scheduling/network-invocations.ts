import { randomUUID } from 'node:crypto'
import { parseNetworkDefinition, networkLimits  } from '../../contracts/networks'
import type { RunState } from '../../contracts/runs'
import type { RunStore } from '../runs/store'
import { parseProgress } from '../runs/progress'
import { confirmDomainsStopped } from '../recovery/domains'
import type { PodDatabase } from '../storage/database'
import { NetworkEvents, NetworkEventConflict, canonicalNetworkJson } from './network-events'
import type { NetworkAuthority, NetworkEmission } from './network-events'

export class NetworkInvocations {
  readonly events: NetworkEvents
  constructor(private readonly store: PodDatabase, private readonly runs: RunStore, private readonly helper: string) {
    this.events = new NetworkEvents(store, runs.bootId)
  }

  reserve(networkId: string, podId: string, resourceEpoch: number, reason: 'manual' | 'schedule' | 'event', allowPaused: boolean = false): NetworkAuthority | null {
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
      if (this.store.db.prepare(`SELECT 1 FROM network_effect_attempts e JOIN network_invocations i ON i.run_id=e.run_id
        WHERE i.pod_id=? AND e.state IN ('intent','unknown') UNION ALL
        SELECT 1 FROM effect_ledger WHERE pod_id=? AND state IN ('intent','unknown') LIMIT 1`).get(podId, podId)) {
        throw new Error('Network instance has an external effect requiring review')
      }
      if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=?').get(podId, podId)) return null
      if (this.store.db.prepare('SELECT 1 FROM network_invocations WHERE pod_id=? AND state IN (\'running\',\'stopping\',\'interrupted\',\'unknown\') LIMIT 1').get(podId)) throw new Error('Network instance requires recovery before another invocation')
      if (this.store.db.prepare('SELECT 1 FROM network_invocations WHERE pod_id=? AND json_extract(manifest,\'$.reviewRequired\')=1 LIMIT 1').get(podId)) throw new Error('Network source identity conflict requires owner review')
      const maximum = this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number
      if ((this.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count as number) >= maximum) return null
      const pin = this.store.db.prepare('SELECT content_hash FROM pod_definition_versions WHERE definition_id=? AND version=?').get(member.definitionId, member.definitionVersion)
      if (!pin || pin.content_hash !== pod.activeScript) throw new Error('Network instance no longer matches its pinned script')
      const ready = member.source ? [] : this.ready(networkId, definition.revision, podId)
      if (!member.source && !ready.length) return null
      const reservation = this.runs.reserve(podId, pod.activeScript!, resourceEpoch, { reason, eventIds: [] })
      if (reservation.existing) throw new Error('Network instance lease changed during admission')
      const runId = reservation.run.id; const token = randomUUID()
      const checkpoint = this.store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE pod_id=? AND network_id=?').get(podId, networkId)
      if (!checkpoint) throw new Error('Network instance has no private checkpoint')
      const manifest = { resourceEpoch, assignmentRevision: pod.bindingRevision, definitionId: member.definitionId, definitionVersion: member.definitionVersion, bindingRevision: member.bindingRevision, reason, checkpointRevision: checkpoint.revision, inputClaims: ready.map(input => ({ id: input.id, generation: Number(input.generation) + 1 })) }
      this.store.db.prepare(`INSERT INTO network_invocations(run_id,network_id,network_revision,pod_id,boot_nonce,restore_nonce,activation_epoch,claim_token,generation,state,manifest)
        VALUES(?,?,?,?,?,?,?,?,1,'running',?)`).run(runId, networkId, definition.revision, podId, this.runs.bootId, network.restore_nonce!, network.activation_epoch!, token, canonicalNetworkJson(manifest))
      for (const input of ready) {
        const claimed = this.store.db.prepare(`UPDATE network_deliveries SET state='claimed',generation=generation+1,claim_token=?,boot_nonce=?,restore_nonce=?,activation_epoch=?,run_id=?
          WHERE id=? AND state='pending' AND ready_at<=?`).run(token, this.runs.bootId, network.restore_nonce!, network.activation_epoch!, runId, input.id!, Date.now())
        if (claimed.changes !== 1) throw new Error('Network input is no longer ready')
      }
      if (ready.length) { this.count(networkId, 'pending', -ready.length); this.count(networkId, 'claimed', ready.length) }
      const authority = { runId, claimToken: token }
      this.events.authority(authority)
      return authority
    })
  }

  input(authority: NetworkAuthority) {
    const { row, definition, member } = this.events.authority(authority)
    const checkpoint = this.store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE network_id=? AND pod_id=?').get(definition.id, member.podId)!
    const items = this.store.db.prepare(`SELECT e.id,e.item_key,e.channel,e.payload,e.case_id,e.case_revision FROM network_deliveries d JOIN network_events e ON e.id=d.event_id
      WHERE d.run_id=? AND d.state='claimed' ORDER BY d.accepted_at,d.id`).all(authority.runId).map(item => ({ eventId: item.id as string, key: item.item_key as string, channel: item.channel as string, data: JSON.parse(item.payload as string) as Record<string, unknown>, caseId: item.case_id as string, caseRevision: item.case_revision as number }))
    return { network: { id: definition.id, revision: definition.revision, source: member.source !== null }, items, checkpoint: { revision: checkpoint.revision as number, body: JSON.parse(checkpoint.body as string) as Record<string, unknown> }, resourceEpoch: (JSON.parse(row.manifest as string) as { resourceEpoch: number }).resourceEpoch }
  }

  recordConflict(authority: NetworkAuthority, failure: unknown): void {
    if (!(failure instanceof NetworkEventConflict)) return
    this.store.transaction(() => {
      const { row, definition } = this.events.authority(authority, true)
      const manifest = { ...JSON.parse(row.manifest as string), reviewRequired: true }
      this.store.db.prepare('UPDATE network_invocations SET manifest=? WHERE run_id=?').run(canonicalNetworkJson(manifest), authority.runId)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(definition.id, authority.runId, 'source-identity-conflict-review', canonicalNetworkJson(failure.detail), Date.now())
    })
  }

  stageProgress(authority: NetworkAuthority, payload: unknown): { revision: number } {
    return this.store.transaction(() => {
      const { row, definition, member } = this.events.authority(authority)
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

  async finish(authority: NetworkAuthority, state: RunState, summary: string, error: string | null, completedInputIds: string[], emissions: NetworkEmission[]): Promise<void> {
    if (!['completed', 'completedWithGaps', 'failed', 'cancelled', 'blocked'].includes(state)) throw new Error('Network settlement requires a terminal script result')
    this.store.transaction(() => {
      this.events.authority(authority, true)
      this.store.db.prepare('UPDATE network_invocations SET state=\'stopping\' WHERE run_id=?').run(authority.runId)
    })
    try { await confirmDomainsStopped(this.store, authority.runId, this.helper) }
    catch (failure) { this.interrupt(authority, failure instanceof Error ? failure.message : 'Execution cleanup is unverified'); return }
    this.settle(authority, state, summary, error, completedInputIds, emissions)
  }

  async failClosed(authority: NetworkAuthority, failure: unknown): Promise<void> {
    let reason = failure instanceof Error ? failure.message : 'Network settlement failed'
    try { await confirmDomainsStopped(this.store, authority.runId, this.helper) }
    catch (stopFailure) { reason += `; ${stopFailure instanceof Error ? stopFailure.message : 'Execution cleanup is unverified'}` }
    this.interrupt(authority, reason)
  }

  private interrupt(authority: NetworkAuthority, reason: string): void {
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
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(networkId, authority.runId, 'process-stop-unverified', canonicalNetworkJson({ reason: reason.slice(0, 10000), leaseRetained: true }), Date.now())
    })
  }

  private settle(authority: NetworkAuthority, state: RunState, summary: string, error: string | null, completedInputIds: string[], emissions: NetworkEmission[]): void {
    if (!['completed', 'completedWithGaps', 'failed', 'cancelled', 'blocked'].includes(state)) throw new Error('Network settlement requires a terminal script result')
    if (summary.length > 10000 || (error !== null && error.length > 10000)) throw new Error('Network settlement diagnostic exceeds its size limit')
    this.store.transaction(() => {
      const { row, definition, member } = this.events.authority(authority, true)
      const inputs = this.store.db.prepare('SELECT id,event_id FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(authority.runId)
      const completed = state === 'completed'
      const effects = this.store.db.prepare(`SELECT e.logical_action_key,e.attempt,e.state,
        (SELECT max(sequence) FROM network_effect_receipts r WHERE r.logical_action_key=e.logical_action_key AND r.attempt=e.attempt AND r.outcome=e.state) AS receipt
        FROM network_effect_attempts e WHERE e.run_id=? ORDER BY e.logical_action_key,e.attempt`).all(authority.runId)
      const unsafe = effects.some(effect => effect.state === 'intent' || effect.state === 'unknown' || effect.receipt === null)
      if (completed && unsafe) throw new Error('Network effects require reconciliation before successful settlement')
      if (completed && (new Set(completedInputIds).size !== inputs.length || inputs.some(input => !completedInputIds.includes(input.event_id as string)))) throw new Error('Network completion must acknowledge every claimed input')
      if (emissions.length > 500) throw new Error('Network invocation exceeds 500 emissions')
      if (completed) {
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
      const nextState = unsafe ? 'unknown' : completed ? 'done' : 'blocked'
      this.store.db.prepare('UPDATE network_deliveries SET state=?,claim_token=NULL,reason=? WHERE run_id=? AND state=\'claimed\'').run(nextState, completed ? null : error ?? summary, authority.runId)
      if (inputs.length) { this.count(definition.id, 'claimed', -inputs.length); this.count(definition.id, nextState, inputs.length) }
      this.store.db.prepare('UPDATE network_invocations SET state=?,staged_checkpoint=NULL WHERE run_id=?').run(unsafe ? 'unknown' : completed ? 'completed' : 'blocked', authority.runId)
      const effectReceipts = this.store.db.prepare('SELECT r.logical_action_key,r.attempt,max(r.sequence) AS sequence FROM network_effect_receipts r JOIN network_effect_attempts e ON e.logical_action_key=r.logical_action_key AND e.attempt=r.attempt WHERE e.run_id=? GROUP BY r.logical_action_key,r.attempt').all(authority.runId)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,case_id,run_id,event_id,kind,body,created_at) VALUES(?,NULL,?,NULL,?,?,?)').run(definition.id, authority.runId, 'invocation-settled', canonicalNetworkJson({ state: unsafe ? 'unknown' : state, summary, error, effectReceipts }), Date.now())
      this.runs.finishNetwork(authority.runId, authority.claimToken, unsafe ? 'blocked' : state, unsafe ? 'Network effect outcome is unknown' : error)
    })
  }

  private ready(networkId: string, revision: number, podId: string) {
    const first = this.store.db.prepare(`SELECT d.case_id,d.case_revision FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id
      WHERE s.network_id=? AND s.network_revision=? AND s.pod_id=? AND d.state='pending' AND d.ready_at<=? ORDER BY d.accepted_at,d.id LIMIT 1`).get(networkId, revision, podId, Date.now())
    if (!first) return []
    return this.store.db.prepare(`SELECT d.* FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id
      WHERE s.network_id=? AND s.network_revision=? AND s.pod_id=? AND d.state='pending' AND d.ready_at<=? AND d.case_id=? AND d.case_revision=? ORDER BY d.accepted_at,d.id LIMIT ?`).all(networkId, revision, podId, Date.now(), first.case_id!, first.case_revision!, networkLimits.batch)
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
