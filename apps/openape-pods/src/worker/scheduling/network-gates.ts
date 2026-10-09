import { occupiedRunSlots } from '../runs/slots'
import { emptyNetworkDataPin, networkDataPin } from './network-config'
import { abandonNetworkData } from './network-data-recovery'
import { randomUUID } from 'node:crypto'
import { sameOwner } from '@openape/pods-protocol'
import { gateLimits, itemTitle } from '../../contracts/gates'
import type { GateBatchState } from '../../contracts/gates'
import { InfrastructureError } from '../../contracts/infrastructure'
import { networkGateActionHash, networkGateDigest, networkGatePayloadHash, parseNetworkGateCoverage, parseNetworkGateManifest, parseNetworkGateView } from '../../contracts/network-gates'
import type { NetworkGateCoverage, NetworkGateManifest, NetworkGateView } from '../../contracts/network-gates'
import { parseNetworkDefinition } from '../../contracts/networks'
import type { NetworkCommand, NetworkDefinition } from '../../contracts/networks'
import type { ServiceScope } from '../../contracts/services'
import type { ResourceRegistry } from '../resources/registry'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import { canonicalNetworkJson } from './network-events'
import type { NetworkAuthority } from './network-events'
import { memberEffectHold } from './network-invocations'
import type { NetworkInvocations } from './network-invocations'
import { assertNetworkQuota } from './network-quota'

export interface NetworkGateStep { authority: NetworkAuthority, taskId: string, attempt: number, generation: number, token: string }
export interface NetworkGateGrant { key: string, id: string }
export type NetworkGateService = (body: { operation: 'create' | 'status' | 'consume' | 'assertActive', manifest: NetworkGateManifest, grants?: NetworkGateGrant[] }, signal: AbortSignal) => Promise<unknown>
type MemberState = 'pending' | 'approved' | 'denied' | 'expired'
interface Task { id: string, network_id: string, pod_id: string, generation: number, state: GateBatchState, manifest: string, grant_id: string | null, next_poll_at: number }
interface GateBinding { taskId: string, grantId: string, manifestHash: string }

/** A superseded batch only waits for the owner while one of its inputs is blocked or uncertain. */
export const supersededNeedsReview = `EXISTS(SELECT 1 FROM network_gate_items review_item JOIN network_deliveries review_delivery ON review_delivery.id=review_item.delivery_id WHERE review_item.task_id=task.id AND review_delivery.state IN ('blocked','unknown'))`

export class NetworkGates {
  /** How long pending inputs are collected before a batch freezes; synthetic fixtures set both to zero. */
  collect = { quietMs: gateLimits.collectQuietMs, maxMs: gateLimits.collectMaxMs }
  constructor(private readonly store: PodDatabase, private readonly invocations: NetworkInvocations, private readonly resources: ResourceRegistry) {}

  prepare(definition: NetworkDefinition, podId: string): void {
    if (!definition.gates?.some(gate => gate.podId === podId)) return
    this.store.assertStorage()
    this.refresh(definition.id, podId)
    for (const gate of definition.gates?.filter(gate => gate.podId === podId) ?? []) {
      this.store.transaction(() => {
        const count = Number(this.store.db.prepare(`SELECT count(*) AS count FROM network_gate_tasks task JOIN network_gate_controls control ON control.task_id=task.id
          WHERE task.network_id=? AND task.pod_id=? AND control.gate_key=? AND (task.state IN ('preparing','pending','consuming','unknown') OR (task.state='approved' AND EXISTS(SELECT 1 FROM network_gate_items item JOIN network_deliveries delivery ON delivery.id=item.delivery_id WHERE item.task_id=task.id AND delivery.state IN ('pending','claimed','retry_wait','unknown'))))`).get(definition.id, podId, gate.key)!.count)
        if (count >= gateLimits.pendingBatches) return
        const rows = this.store.db.prepare(`SELECT delivery.id,delivery.generation,delivery.accepted_at,event.id AS event_id,event.item_key,event.payload,event.payload_hash,event.channel
          FROM network_deliveries delivery JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id JOIN network_events event ON event.id=delivery.event_id
          WHERE delivery.network_id=? AND subscription.network_revision=? AND subscription.pod_id=? AND subscription.channel=?
            AND delivery.state='pending' AND delivery.run_id IS NULL AND NOT EXISTS(SELECT 1 FROM network_gate_items item WHERE item.delivery_id=delivery.id AND item.outcome IN ('held','released','unknown'))
          ORDER BY delivery.accepted_at,delivery.id LIMIT ?`).all(definition.id, definition.revision, podId, gate.channel, gateLimits.batchItems)
        if (!rows.length || this.collecting(rows.map(row => Number(row.accepted_at)))) return
        const member = definition.members.find(member => member.podId === podId)!
        const pod = this.store.getPod(podId)
        const network = this.store.db.prepare('SELECT * FROM networks WHERE id=?').get(definition.id)!
        const items = rows.map(row => ({ deliveryId: row.id as string, eventId: row.event_id as string, generation: Number(row.generation), key: row.item_key as string, hash: row.payload_hash as string, channel: row.channel as string, title: itemTitle(row.item_key as string, JSON.parse(row.payload as string)) }))
        const base = { version: 3 as const, dataPin: networkDataPin(this.store, definition.id, podId), id: randomUUID(), networkId: definition.id, networkRevision: definition.revision, gate: gate.key, title: gate.title, podId, owner: { issuer: network.owner_issuer as string, subject: network.owner_subject as string }, restoreNonce: network.restore_nonce as string, activationEpoch: Number(network.activation_epoch), definitionId: member.definitionId, definitionVersion: member.definitionVersion, bindingRevision: member.bindingRevision, assignmentRevision: pod.bindingRevision, resourceEpoch: this.resources.epoch(podId), scriptHash: pod.activeScript!, expiresAt: Date.now() + gateLimits.expiryMs, items }
        const action = { ...base, actionHash: networkGateActionHash(base) }
        const manifest = parseNetworkGateManifest({ ...action, digest: networkGateDigest(action) })
        this.assertPinned(manifest)
        const summary = `${manifest.title}: ${items.length} items, one grant each`
        const body = canonicalNetworkJson(manifest)
        assertNetworkQuota(this.store, Buffer.byteLength(body) * 3 + items.length * 1024 + 8192)
        this.store.db.prepare(`INSERT INTO network_gate_tasks(id,network_id,network_revision,pod_id,generation,state,manifest,manifest_hash,restore_nonce,expires_at,created_at)
          VALUES(?,?,?,?,1,'preparing',?,?,?,?,?)`).run(manifest.id, definition.id, definition.revision, podId, body, digest(body), manifest.restoreNonce, manifest.expiresAt, Date.now())
        this.store.db.prepare('INSERT INTO network_gate_controls(task_id,network_id,gate_key,summary,next_poll_at) VALUES(?,?,?,?,?)').run(manifest.id, definition.id, gate.key, summary, Date.now())
        for (const item of items) this.store.db.prepare(`INSERT INTO network_gate_items(task_id,delivery_id,event_id,delivery_generation,payload_hash,outcome) VALUES(?,?,?,?,?,'held')`).run(manifest.id, item.deliveryId, item.eventId, item.generation, item.hash)
        for (const item of items) this.store.db.prepare(`INSERT OR IGNORE INTO artifact_references SELECT artifact_id,'gate',? FROM artifact_references WHERE reference_kind='event' AND reference_id=?`).run(manifest.id, item.eventId)
        this.trace(manifest, 'gate-batch-frozen', { taskId: manifest.id, digest: manifest.digest, actionHash: manifest.actionHash, itemCount: items.length })
      })
    }
  }

  // A full batch freezes at once; otherwise it waits for a quiet moment, bounded by the age of its oldest input.
  private collecting(acceptedAt: number[]): boolean {
    if (acceptedAt.length >= gateLimits.batchItems) return false
    const now = Date.now()
    return now - Math.max(...acceptedAt) < this.collect.quietMs && now - Math.min(...acceptedAt) < this.collect.maxMs
  }

  reserve(definition: NetworkDefinition, podId: string, reason: 'manual' | 'event', allowPaused = false, processPreviewId: string | null = null): NetworkGateStep | null {
    return this.store.transaction(() => {
      const task = this.store.db.prepare(`SELECT task.*,control.next_poll_at FROM network_gate_tasks task JOIN network_gate_controls control ON control.task_id=task.id
        WHERE task.network_id=? AND task.pod_id=? AND task.state IN ('preparing','pending') AND control.next_poll_at<=?
        AND NOT EXISTS(SELECT 1 FROM network_gate_task_attempts attempt WHERE attempt.task_id=task.id AND attempt.state='running') ORDER BY control.next_poll_at,task.created_at,task.id LIMIT 1`).get(definition.id, podId, Date.now()) as unknown as Task | undefined
      if (!task) return null
      const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
      try { this.assertPinned(manifest); this.assertItems(manifest) }
      catch (failure) { this.obsolete(task, failure); return null }
      if (manifest.expiresAt <= Date.now()) { this.store.db.prepare('UPDATE network_gate_tasks SET state=\'expired\' WHERE id=?').run(task.id); this.dispose(task, 'expired', 'Approval expired before release'); return null }
      const pod = this.store.getPod(podId)
      const network = this.store.db.prepare('SELECT state FROM networks WHERE id=?').get(definition.id)!
      if (network.state !== 'active' && reason !== 'manual') return null
      if (pod.lifecycle !== 'active' && !(reason === 'manual' && allowPaused)) return null
      if (memberEffectHold(this.store, podId) || this.store.db.prepare(`SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=?
        UNION ALL SELECT 1 FROM network_invocations WHERE pod_id=? AND state IN ('running','stopping','interrupted','unknown') LIMIT 1`).get(podId, podId, podId)) {
        return null
      }
      const count = occupiedRunSlots(this.store)
      if (count >= Number(this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency)) return null
      assertNetworkQuota(this.store, 16384)
      const run = this.invocations.reserveGate(manifest, reason, processPreviewId)
      if (!run) return null
      const attempt = Number(this.store.db.prepare('SELECT coalesce(max(attempt),0)+1 AS attempt FROM network_gate_task_attempts WHERE task_id=?').get(task.id)!.attempt)
      const token = randomUUID()
      this.store.db.prepare(`INSERT INTO network_gate_task_attempts(task_id,attempt,run_id,generation,step_token,state,created_at,network_id) VALUES(?,?,?,?,?,'running',?,?)`).run(task.id, attempt, run.runId, task.generation, token, Date.now(), definition.id)
      this.store.db.prepare('INSERT INTO network_gate_attempt_controls VALUES(?,?,\'not_started\')').run(task.id, attempt)
      this.invocations.events.authority(run)
      return { authority: run, taskId: task.id, attempt, generation: task.generation, token }
    })
  }

  assertStep(step: NetworkGateStep, finishing = false): { task: Task, manifest: NetworkGateManifest } {
    this.invocations.events.authority(step.authority, finishing)
    const task = this.task(step.taskId)
    const attempt = this.store.db.prepare('SELECT * FROM network_gate_task_attempts WHERE task_id=? AND attempt=?').get(step.taskId, step.attempt)
    if (task.generation !== step.generation || !attempt || attempt.state !== 'running' || attempt.run_id !== step.authority.runId || attempt.step_token !== step.token || attempt.generation !== step.generation) throw new Error('Network gate step authority is obsolete')
    const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
    this.assertPinned(manifest)
    this.assertItems(manifest)
    return { task, manifest }
  }

  async round(step: NetworkGateStep, service: NetworkGateService, signal: AbortSignal): Promise<void> {
    let result: { state: GateBatchState, grantId?: string, url?: string, error?: string, nextPollAt?: number, refused?: Record<string, 'denied' | 'expired'> }
    try {
      const { task, manifest } = this.assertStep(step)
      signal.throwIfAborted()
      if (manifest.expiresAt <= Date.now()) {
        result = { state: 'expired' }
      }
      else if (task.state === 'preparing') {
        this.operation(step, 'create')
        const reply = await service({ operation: 'create', manifest }, signal) as { id?: unknown, url?: unknown }
        if (typeof reply?.id !== 'string' || !/^[\w-]{1,128}$/.test(reply.id) || typeof reply.url !== 'string' || reply.url.length > 2048) throw new Error('Invalid network approval response')
        const url = new URL(reply.url)
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid network approval origin')
        this.observeCreation(step, reply)
        this.assertStep(step); signal.throwIfAborted()
        result = { state: 'pending', grantId: reply.id, url: reply.url, nextPollAt: Date.now() + 5000 }
      }
      else if (task.state === 'pending') {
        this.operation(step, 'status')
        const grants = this.itemGrants(task.id, manifest)
        const states = this.memberStates(await service({ operation: 'status', manifest, grants }, signal), grants)
        this.assertStep(step); signal.throwIfAborted()
        const approved = grants.filter(grant => states[grant.key] === 'approved')
        const refused = Object.fromEntries(grants.filter(grant => states[grant.key] === 'denied' || states[grant.key] === 'expired').map(grant => [grant.key, states[grant.key] as 'denied' | 'expired']))
        if (grants.some(grant => states[grant.key] === 'pending')) {
          result = { state: 'pending', nextPollAt: Date.now() + 5000 }
        }
        else if (!approved.length) {
          result = { state: Object.values(refused).includes('denied') ? 'denied' : 'expired', refused }
        }
        else {
          this.store.transaction(() => {
            this.assertStep(step)
            if (manifest.expiresAt <= Date.now()) throw new Error('Network approval expired before consumption')
            const changed = this.store.db.prepare(`UPDATE network_gate_tasks SET state='consuming' WHERE id=? AND generation=? AND state='pending'`).run(task.id, step.generation)
            if (changed.changes !== 1) throw new Error('Network gate state changed before consumption')
            this.operation(step, 'consume')
            this.trace(manifest, 'gate-consuming', { taskId: task.id, grantIds: approved.map(grant => grant.id), stepToken: step.token })
          })
          const consumed = await service({ operation: 'consume', manifest, grants: approved }, signal)
          if (consumed !== true) throw new Error('Network approval consumption was not confirmed')
          this.assertStep(step); signal.throwIfAborted()
          if (manifest.expiresAt <= Date.now()) throw new Error('Network approval expired before settlement')
          result = { state: 'approved', refused }
        }
      }
      else {
        throw new Error('Network gate cannot automatically resume an uncertain decision')
      }
    }
    catch (failure) {
      const task = this.task(step.taskId)
      result = task.state === 'pending'
        ? { state: 'pending', error: (failure instanceof Error ? failure.message : 'Network approval status is unavailable').slice(0, 10000), nextPollAt: Date.now() + Math.max(5000, failure instanceof InfrastructureError ? failure.failure.retryAfterMs : 5000) }
        : { state: 'unknown', error: (failure instanceof Error ? failure.message : 'Network approval failed').slice(0, 10000) }
    }
    await this.invocations.finishGate(step.authority, `Network gate step: ${result.state}`, () => {
      const task = this.task(step.taskId)
      const attempt = this.store.db.prepare('SELECT state,step_token,generation FROM network_gate_task_attempts WHERE task_id=? AND attempt=?').get(step.taskId, step.attempt)
      if (!attempt || attempt.state !== 'running' || attempt.step_token !== step.token || attempt.generation !== step.generation) throw new Error('Network gate settlement token changed')
      if (task.generation !== step.generation || !['preparing', 'pending', 'consuming'].includes(task.state)) {
        this.store.db.prepare(`UPDATE network_gate_task_attempts SET state='blocked',finished_at=? WHERE task_id=? AND attempt=?`).run(Date.now(), step.taskId, step.attempt)
        return
      }
      const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
      const refused = result.refused ?? {}
      if (result.state === 'approved') {
        const released = { ...manifest, items: manifest.items.filter(item => !refused[item.deliveryId]) }
        this.assertPinned(manifest); this.assertItems(released)
        if (manifest.expiresAt <= Date.now()) throw new Error('Network approval expired before release')
      }
      this.store.db.prepare('UPDATE network_gate_tasks SET state=?,grant_id=coalesce(?,grant_id) WHERE id=? AND generation=?').run(result.state, result.grantId ?? null, task.id, step.generation)
      this.store.db.prepare('UPDATE network_gate_controls SET next_poll_at=?,url=coalesce(?,url),error=? WHERE task_id=?').run(result.nextPollAt ?? manifest.expiresAt, result.url ?? null, result.error ?? null, task.id)
      const receipt = canonicalNetworkJson({ taskId: task.id, state: result.state, generation: task.generation, stepToken: step.token, grantId: result.grantId ?? task.grant_id, refused, digest: manifest.digest, actionHash: manifest.actionHash, at: Date.now() })
      for (const outcome of ['denied', 'expired'] as const) {
        const deliveryIds = Object.keys(refused).filter(key => refused[key] === outcome)
        if (deliveryIds.length) this.dispose(task, outcome, `Owner approval ${outcome}`, deliveryIds)
      }
      // A refused input stays unreleased even when its delivery could not be disposed above.
      if (result.state === 'approved' || result.state === 'unknown') this.store.db.prepare('UPDATE network_gate_items SET outcome=?,receipt=? WHERE task_id=? AND outcome=\'held\' AND delivery_id NOT IN (SELECT value FROM json_each(?))').run(result.state === 'approved' ? 'released' : 'unknown', receipt, task.id, JSON.stringify(Object.keys(refused)))
      if ((result.state === 'denied' || result.state === 'expired') && !Object.keys(refused).length) this.dispose(task, result.state, `Owner approval ${result.state}`)
      this.store.db.prepare('UPDATE network_gate_task_attempts SET state=?,finished_at=? WHERE task_id=? AND attempt=?').run(result.state === 'unknown' ? 'unknown' : 'completed', Date.now(), step.taskId, step.attempt)
      this.trace(manifest, 'gate-step-settled', { receipt: JSON.parse(receipt), error: result.error ?? null, noScriptLaunched: true })
    }, result.state === 'unknown' || result.error !== undefined)
    this.pruneStatusSteps(step.taskId)
  }

  /** The per-item grant identities recorded at creation, in manifest order. */
  private itemGrants(taskId: string, manifest: NetworkGateManifest): NetworkGateGrant[] {
    const rows = this.store.db.prepare('SELECT delivery_id,grant_id FROM network_gate_item_grants WHERE task_id=?').all(taskId)
    return manifest.items.map((item) => {
      const row = rows.find(entry => entry.delivery_id === item.deliveryId)
      if (!row) throw new Error('Network gate input has no recorded approval grant')
      return { key: item.deliveryId, id: row.grant_id as string }
    })
  }

  private memberStates(value: unknown, grants: NetworkGateGrant[]): Record<string, MemberState> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid network approval status')
    const states = value as Record<string, unknown>
    if (Object.keys(states).length !== grants.length || grants.some(grant => !['pending', 'approved', 'denied', 'expired'].includes(states[grant.key] as string))) throw new Error('Invalid network approval status')
    return states as Record<string, MemberState>
  }

  async failStep(step: NetworkGateStep, failure: unknown): Promise<void> {
    const current = this.store.transaction(() => {
      const attempt = this.store.db.prepare('SELECT * FROM network_gate_task_attempts WHERE task_id=? AND attempt=?').get(step.taskId, step.attempt)
      if (!attempt || attempt.state !== 'running' || attempt.step_token !== step.token || attempt.generation !== step.generation || attempt.run_id !== step.authority.runId) return false
      const task = this.task(step.taskId)
      const reason = (failure instanceof Error ? failure.message : 'Network gate settlement failed').slice(0, 10000)
      const operation = this.store.db.prepare('SELECT operation FROM network_gate_attempt_controls WHERE task_id=? AND attempt=?').get(step.taskId, step.attempt)?.operation
      const uncertain = operation === 'create' || operation === 'consume'
      if (task.generation === step.generation && ['preparing', 'pending', 'consuming'].includes(task.state)) {
        if (uncertain) {
          this.store.db.prepare('UPDATE network_gate_tasks SET state=\'unknown\' WHERE id=?').run(task.id)
          this.store.db.prepare(`UPDATE network_gate_items SET outcome='unknown',receipt=json_object('decision',json(?),'priorReceipt',json(receipt)) WHERE task_id=? AND outcome='held'`).run(canonicalNetworkJson({ kind: 'gate-step-unknown', taskId: task.id, attempt: step.attempt, generation: step.generation, operation, reason, priorGrantId: task.grant_id, at: Date.now(), automaticRepeatDenied: true }), task.id)
        }
        this.store.db.prepare('UPDATE network_gate_controls SET error=?,next_poll_at=? WHERE task_id=?').run(reason, Date.now() + 5000, task.id)
      }
      this.store.db.prepare('UPDATE network_gate_task_attempts SET state=?,finished_at=? WHERE task_id=? AND attempt=? AND step_token=? AND state=\'running\'').run(uncertain ? 'unknown' : 'blocked', Date.now(), task.id, step.attempt, step.token)
      return true
    })
    if (!current) return
    await this.invocations.closeGateFailure(step.authority, failure)
    this.pruneStatusSteps(step.taskId)
  }

  views(owner: { issuer: string, subject: string }): NetworkGateView[] {
    return this.store.db.prepare(`SELECT task.*,control.url,control.error FROM network_gate_tasks task JOIN network_gate_controls control ON control.task_id=task.id
      JOIN networks network ON network.id=task.network_id WHERE network.owner_issuer=? AND network.owner_subject=? AND (network.state='archived' OR json_extract(task.manifest,'$.networkRevision')=network.revision)
      AND (task.state!='superseded' OR ${supersededNeedsReview})
      ORDER BY CASE WHEN task.state IN ('preparing','pending','consuming','unknown') THEN 0 ELSE 1 END,task.created_at DESC,task.id LIMIT 256`).all(owner.issuer, owner.subject).map((task) => {
      const manifest = parseNetworkGateManifest(JSON.parse(task.manifest as string))
      const outcomes = this.store.db.prepare('SELECT delivery_id,outcome FROM network_gate_items WHERE task_id=?').all(task.id!)
      return parseNetworkGateView({ id: task.id, networkId: task.network_id, gate: manifest.gate, podId: task.pod_id, generation: task.generation, state: task.state, expiresAt: task.expires_at, url: task.url, error: task.error, items: manifest.items.map(item => ({ deliveryId: item.deliveryId, title: item.title, outcome: outcomes.find(outcome => outcome.delivery_id === item.deliveryId)?.outcome })) })
    })
  }

  resolve(networkId: string, command: Extract<NetworkCommand, { type: 'gateDiscard' | 'gateReview' }>): void {
    this.store.assertStorage()
    this.store.transaction(() => {
      const task = this.task(command.taskId)
      if (task.network_id !== networkId || task.generation !== command.generation) throw new Error('Network gate owner decision is obsolete')
      const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
      if (manifest.networkRevision !== this.store.db.prepare('SELECT revision FROM networks WHERE id=?').get(networkId)?.revision) throw new Error('Historical approval evidence cannot authorize a new composition')
      if (command.type === 'gateReview') {
        if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(task.pod_id)) throw new Error('Finish or inspect the active Pod execution before requesting fresh gate approval')
        if (this.store.db.prepare('SELECT baseline_state FROM networks WHERE id=?').get(networkId)?.baseline_state !== 'ready') throw new Error('Review the restored network baseline before requesting fresh gate approval')
        if (!['superseded', 'approved', 'unknown'].includes(task.state)) throw new Error('Only obsolete, uncertain or previously consumed gate work can request fresh approval')
        if (task.state === 'unknown') this.assertStoppedTask(task)
        const receipt = canonicalNetworkJson({ taskId: task.id, generation: task.generation, priorGrantOutcome: task.state === 'unknown' ? 'unknown-retained' : task.state, priorGrantId: task.grant_id, priorTaskState: task.state, ownerEvidence: command.evidence, at: Date.now(), priorGrantCannotBeReused: true })
        const held: string[] = []
        const resumed = this.renew(task, manifest, receipt, 'Owner requested fresh gate approval', held)
        if (!resumed) throw new Error(held[0] ?? 'Network gate has no safe input awaiting fresh approval')
        this.trace(manifest, 'gate-owner-fresh-approval', { receipt: JSON.parse(receipt), resumed, held: held.length, noApprovalReleased: true })
        return
      }
      if (task.state !== 'unknown') throw new Error('Only uncertain network gate work can be discarded')
      this.assertStoppedTask(task)
      this.store.db.prepare(`UPDATE network_gate_tasks SET state='superseded',generation=generation+1 WHERE id=?`).run(task.id)
      this.dispose(task, 'excluded', `Owner discarded uncertain gate work: ${command.evidence}`)
      this.trace(manifest, 'gate-owner-discard', { taskId: task.id, grantId: task.grant_id, ownerEvidence: command.evidence, grantOutcome: 'unknown-retained', automaticRepeatDenied: true })
    })
  }

  binding(deliveryId: string): GateBinding | null {
    const row = this.store.db.prepare(`SELECT task.* FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id WHERE item.delivery_id=? AND item.outcome='released' AND task.state='approved'`).get(deliveryId) as unknown as Task | undefined
    if (!row) return null
    const manifest = parseNetworkGateManifest(JSON.parse(row.manifest))
    try {
      this.assertPinned(manifest); this.assertItems({ ...manifest, items: manifest.items.filter(item => item.deliveryId === deliveryId) }, true)
      if (manifest.expiresAt <= Date.now()) throw new Error('Consumed network approval expired before dispatch')
    }
    catch (failure) { this.store.transaction(() => this.obsolete(row, failure)); return null }
    // Batches approved under one collective grant predate per-item grants; they need a fresh approval.
    if (!this.store.db.prepare('SELECT 1 FROM network_gate_item_grants WHERE task_id=? AND delivery_id=?').get(row.id, deliveryId)) { this.store.transaction(() => this.obsolete(row, new Error('Approval predates per-item grants; request a fresh approval'))); return null }
    if (!row.grant_id) throw new Error('Approved network gate is missing its consumed grant identity')
    return { taskId: row.id, grantId: row.grant_id, manifestHash: digest(row.manifest) }
  }

  coverage(authority: NetworkAuthority, finishing = false): NetworkGateCoverage[] {
    const { row, definition, member } = this.invocations.events.authority(authority, finishing)
    const bindings = (JSON.parse(row.manifest as string).gateBindings ?? []) as GateBinding[]
    const coverage = bindings.map((binding) => {
      const task = this.task(binding.taskId)
      if (task.state !== 'approved' || task.grant_id !== binding.grantId || digest(task.manifest) !== binding.manifestHash) throw new Error('Network approval release changed')
      const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
      this.assertPinned(manifest)
      if (manifest.expiresAt <= Date.now()) throw new Error('Network approval expired during dispatch')
      const items = this.store.db.prepare(`SELECT delivery.id AS delivery_id,event.id AS event_id,event.item_key,event.payload,item_grant.grant_id FROM network_deliveries delivery JOIN network_gate_items item ON item.delivery_id=delivery.id
        JOIN network_events event ON event.id=delivery.event_id JOIN network_gate_item_grants item_grant ON item_grant.task_id=item.task_id AND item_grant.delivery_id=item.delivery_id
        WHERE delivery.run_id=? AND delivery.state='claimed' AND item.task_id=? AND item.outcome='released'`).all(authority.runId, task.id).map(item => ({ deliveryId: item.delivery_id as string, eventId: item.event_id as string, key: item.item_key as string, grantId: item.grant_id as string, data: JSON.parse(item.payload as string) as Record<string, unknown> }))
      for (const item of items) {
        const pin = manifest.items.find(pin => pin.deliveryId === item.deliveryId)!
        const delivery = this.store.db.prepare('SELECT generation FROM network_deliveries WHERE id=?').get(item.deliveryId)!
        if (!pin || Number(delivery.generation) !== pin.generation + 1) throw new Error('Network approved input generation changed')
      }
      return parseNetworkGateCoverage({ manifest, grantId: task.grant_id, items })
    })
    const channels = definition.gates?.filter(gate => gate.podId === member.podId).map(gate => gate.channel) ?? []
    const inputs = this.store.db.prepare(`SELECT delivery.id FROM network_deliveries delivery JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id
      WHERE delivery.run_id=? AND delivery.state='claimed' AND subscription.channel IN (SELECT value FROM json_each(?))`).all(authority.runId, JSON.stringify(channels))
    if (inputs.some(input => !coverage.some(approval => approval.items.some(item => item.deliveryId === input.id)))) throw new Error('Network invocation has a gated input without exact approval coverage')
    return coverage
  }

  scriptCoverage(authority: NetworkAuthority) {
    return this.coverage(authority).map(coverage => ({ gate: coverage.manifest.gate, items: coverage.items.map(({ grantId: _grantId, ...item }) => item) }))
  }

  observeCreation(step: NetworkGateStep, value: unknown): void {
    const reply = value as { id?: unknown, url?: unknown, grants?: unknown }
    if (typeof reply?.id !== 'string' || !/^[\w-]{1,128}$/.test(reply.id) || typeof reply.url !== 'string' || reply.url.length > 2048 || !Array.isArray(reply.grants)) throw new Error('Invalid observed network grant creation')
    const url = new URL(reply.url)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid observed network approval origin')
    this.store.transaction(() => {
      const task = this.task(step.taskId)
      const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
      const grants = reply.grants as NetworkGateGrant[]
      if (reply.id !== manifest.id || grants.length !== manifest.items.length || manifest.items.some(item => grants.filter(grant => grant?.key === item.deliveryId && typeof grant.id === 'string' && /^[\w-]{1,128}$/.test(grant.id)).length !== 1) || new Set(grants.map(grant => grant.id)).size !== grants.length) throw new Error('Network creation reply does not name one grant per input')
      const attempt = this.store.db.prepare('SELECT operation FROM network_gate_attempt_controls WHERE task_id=? AND attempt=?').get(step.taskId, step.attempt)
      if (attempt?.operation !== 'create') throw new Error('Network creation receipt has no issued operation journal')
      const recorded = this.store.db.prepare('SELECT delivery_id,grant_id FROM network_gate_item_grants WHERE task_id=?').all(step.taskId)
      if (task.grant_id === reply.id && recorded.length === grants.length && grants.every(grant => recorded.some(row => row.delivery_id === grant.key && row.grant_id === grant.id))) return
      if (task.grant_id !== null || recorded.length) throw new Error('Network creation reply conflicts with the observed grant identity')
      this.store.db.prepare('UPDATE network_gate_tasks SET grant_id=? WHERE id=? AND grant_id IS NULL').run(reply.id, step.taskId)
      for (const grant of grants) this.store.db.prepare('INSERT INTO network_gate_item_grants VALUES(?,?,?)').run(step.taskId, grant.key, grant.id)
      this.store.db.prepare('UPDATE network_gate_controls SET url=coalesce(url,?) WHERE task_id=?').run(reply.url as string, step.taskId)
      this.trace(manifest, 'gate-create-observed', { taskId: step.taskId, generation: step.generation, stepToken: step.token, grantIds: grants.map(grant => grant.id), approvalReleased: false, at: Date.now() })
    })
  }

  private operation(step: NetworkGateStep, operation: 'create' | 'status' | 'consume'): void {
    this.store.transaction(() => {
      this.assertStep(step)
      const changed = this.store.db.prepare('UPDATE network_gate_attempt_controls SET operation=? WHERE task_id=? AND attempt=?').run(operation, step.taskId, step.attempt)
      if (changed.changes !== 1) throw new Error('Network gate operation journal is missing')
      if (operation === 'status') this.store.db.prepare('UPDATE network_gate_controls SET poll_count=poll_count+1 WHERE task_id=?').run(step.taskId)
    })
  }

  private pruneStatusSteps(taskId: string): void {
    this.store.transaction(() => {
      const old = this.store.db.prepare(`SELECT attempt.attempt,attempt.run_id,attempt.step_token FROM network_gate_task_attempts attempt
        JOIN network_gate_attempt_controls control ON control.task_id=attempt.task_id AND control.attempt=attempt.attempt
        JOIN network_invocations invocation ON invocation.run_id=attempt.run_id JOIN runs run ON run.id=attempt.run_id
        JOIN network_invocation_controls execution ON execution.run_id=attempt.run_id
        WHERE attempt.task_id=? AND attempt.state IN ('completed','blocked') AND control.operation='status' AND run.finished_at IS NOT NULL
        AND (invocation.state='completed' OR (invocation.state='blocked' AND execution.resolved_receipt IS NOT NULL))
        AND NOT EXISTS(SELECT 1 FROM run_leases WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM execution_domains WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM network_data_staging WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM network_artifact_staging WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM data_record_revisions WHERE author_run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM artifact_references WHERE reference_kind='invocation' AND reference_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM network_effect_attempts WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM effect_ledger WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM accepted_events WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM run_inputs WHERE run_id=attempt.run_id AND event_ids!='[]')
        AND NOT EXISTS(SELECT 1 FROM recovery_reviews WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM workflow_attempts WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM workflow_nodes WHERE run_id=attempt.run_id)
        AND NOT EXISTS(SELECT 1 FROM control_runs WHERE run_id=attempt.run_id AND kind='pod')
        ORDER BY attempt.attempt DESC LIMIT 128 OFFSET 4`).all(taskId)
      for (const attempt of old) {
        this.store.db.prepare('DELETE FROM network_gate_attempt_controls WHERE task_id=? AND attempt=?').run(taskId, attempt.attempt!)
        this.store.db.prepare('DELETE FROM network_gate_task_attempts WHERE task_id=? AND attempt=?').run(taskId, attempt.attempt!)
        this.store.db.prepare(`DELETE FROM network_trace_events WHERE run_id=? OR (kind='gate-step-settled' AND json_extract(body,'$.receipt.stepToken')=?)`).run(attempt.run_id!, attempt.step_token!)
        this.store.db.prepare('DELETE FROM network_invocation_controls WHERE run_id=?').run(attempt.run_id!)
        this.store.db.prepare('DELETE FROM network_invocations WHERE run_id=?').run(attempt.run_id!)
        this.store.db.prepare('DELETE FROM run_events WHERE run_id=?').run(attempt.run_id!)
        this.store.db.prepare('DELETE FROM run_inputs WHERE run_id=?').run(attempt.run_id!)
        this.store.db.prepare('DELETE FROM runs WHERE id=?').run(attempt.run_id!)
      }
      if (old.length) this.store.db.prepare('UPDATE network_gate_controls SET pruned_status_count=pruned_status_count+? WHERE task_id=?').run(old.length, taskId)
    })
  }

  authorizeService(scope: ServiceScope, value: unknown, operation: string, grants?: unknown): void {
    const manifest = parseNetworkGateManifest(value)
    const task = this.task(manifest.id)
    if (task.pod_id !== scope.podId || task.manifest !== canonicalNetworkJson(manifest)) throw new Error('Network gate service differs from its frozen task')
    this.assertPinned(manifest)
    if (operation === 'create' ? Array.isArray(grants) && grants.length : !this.recordedGrants(task.id, grants)) throw new Error('Network gate grant identity differs from its task')
    const invocation = this.store.db.prepare('SELECT * FROM network_invocations WHERE run_id=? AND pod_id=?').get(scope.runId, scope.podId)
    if (!invocation || invocation.state !== 'running') throw new Error('Network gate requires a current execution')
    this.invocations.events.authority({ runId: scope.runId, claimToken: invocation.claim_token as string })
    if (operation === 'assertActive') {
      if (invocation.execution_kind !== 'script' || !this.coverage({ runId: scope.runId, claimToken: invocation.claim_token as string }).some(coverage => coverage.manifest.id === manifest.id)) throw new Error('Network approval does not cover this invocation')
      return
    }
    if (invocation.execution_kind !== 'gate_maintenance') throw new Error('Scripts cannot perform network gate maintenance')
    const attempt = this.store.db.prepare('SELECT * FROM network_gate_task_attempts WHERE run_id=? AND task_id=? AND state=\'running\'').get(scope.runId, task.id)
    if (!attempt || attempt.generation !== task.generation || !((operation === 'create' && task.state === 'preparing') || (operation === 'status' && task.state === 'pending') || (operation === 'consume' && task.state === 'consuming'))) throw new Error('Network gate maintenance state changed')
    this.assertItems(manifest)
    if (manifest.expiresAt <= Date.now()) throw new Error('Network gate service expired')
  }

  /** True when every named grant is the recorded grant of its input in this task. */
  private recordedGrants(taskId: string, value: unknown): boolean {
    if (!Array.isArray(value) || !value.length) return false
    const recorded = this.store.db.prepare('SELECT delivery_id,grant_id FROM network_gate_item_grants WHERE task_id=?').all(taskId)
    return value.every(grant => recorded.some(row => row.delivery_id === (grant as NetworkGateGrant)?.key && row.grant_id === (grant as NetworkGateGrant).id))
  }

  private assertStoppedTask(task: Task): void {
    if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(task.pod_id)) throw new Error('Inspect stopped gate maintenance before discarding uncertain work')
    const unresolved = this.store.db.prepare(`SELECT 1 FROM network_gate_task_attempts attempt JOIN network_invocations invocation ON invocation.run_id=attempt.run_id
      LEFT JOIN network_invocation_controls control ON control.run_id=invocation.run_id WHERE attempt.task_id=?
      AND (attempt.state='running' OR invocation.execution_kind!='gate_maintenance' OR invocation.state IN ('running','stopping','interrupted','unknown') OR (invocation.state='blocked' AND (control.stopped_receipt IS NULL OR json_extract(control.stopped_receipt,'$.generation')!=invocation.generation))
      OR EXISTS(SELECT 1 FROM network_effect_attempts WHERE run_id=attempt.run_id) OR EXISTS(SELECT 1 FROM effect_ledger WHERE run_id=attempt.run_id)) LIMIT 1`).get(task.id)
    if (unresolved) throw new Error('Uncertain gate maintenance requires verified process cleanup')
  }

  private task(id: string): Task {
    const row = this.store.db.prepare('SELECT task.*,control.next_poll_at FROM network_gate_tasks task JOIN network_gate_controls control ON control.task_id=task.id WHERE task.id=?').get(id)
    if (!row) throw new Error('Network gate task is missing')
    return row as unknown as Task
  }

  private assertPinned(manifest: NetworkGateManifest): void {
    const network = this.store.db.prepare('SELECT * FROM networks WHERE id=?').get(manifest.networkId)
    const binding = this.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(manifest.podId)
    const pod = this.store.getPod(manifest.podId)
    if (!network || network.state === 'archived' || network.baseline_state !== 'ready' || network.revision !== manifest.networkRevision || network.restore_nonce !== manifest.restoreNonce || network.activation_epoch !== manifest.activationEpoch || !sameOwner(manifest.owner, { issuer: network.owner_issuer as string, subject: network.owner_subject as string }) || !binding || binding.definition_id !== manifest.definitionId || binding.definition_version !== manifest.definitionVersion || binding.binding_revision !== manifest.bindingRevision || pod.activeScript !== manifest.scriptHash || pod.bindingRevision !== manifest.assignmentRevision || pod.lifecycle === 'archived' || this.resources.epoch(pod.id) !== manifest.resourceEpoch) throw new Error('Network gate consumer or definition authority changed')
    const dataPin = networkDataPin(this.store, manifest.networkId, manifest.podId)
    if ((manifest.version === 3 && manifest.dataPin !== dataPin) || (manifest.version === 2 && dataPin !== emptyNetworkDataPin)) throw new Error('Network gate data authority changed; request a fresh approval')
    const revision = this.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=? AND revision=?').get(manifest.networkId, manifest.networkRevision)!
    const definition = parseNetworkDefinition(JSON.parse(revision.contract as string))
    if (!definition.gates?.some(gate => gate.key === manifest.gate && gate.podId === manifest.podId && manifest.items.every(item => item.channel === gate.channel))) throw new Error('Network approval gate definition changed')
  }

  private assertItems(manifest: NetworkGateManifest, released = false): void {
    for (const item of manifest.items) {
      const row = this.store.db.prepare(`SELECT delivery.state,delivery.generation,event.payload,event.payload_hash,event.id AS event_id,subscription.pod_id,subscription.network_revision FROM network_deliveries delivery
        JOIN network_events event ON event.id=delivery.event_id JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE delivery.id=? AND delivery.network_id=?`).get(item.deliveryId, manifest.networkId)
      if (!row || row.event_id !== item.eventId || row.pod_id !== manifest.podId || row.network_revision !== manifest.networkRevision || row.payload_hash !== item.hash || networkGatePayloadHash(JSON.parse(row.payload as string)) !== item.hash) throw new Error('Network gate input payload or consumer changed')
      if (released && ['claimed', 'done'].includes(row.state as string) && row.generation === item.generation + 1) continue
      if (row.state !== 'pending' || row.generation !== item.generation) throw new Error('Network gate input generation changed')
    }
  }

  private refresh(networkId: string, podId: string): void {
    this.store.transaction(() => {
      const tasks = this.store.db.prepare(`SELECT task.* FROM network_gate_tasks task
        WHERE task.network_id=? AND task.pod_id=? AND task.state IN ('preparing','pending','approved')
        AND EXISTS(SELECT 1 FROM network_gate_items item JOIN network_deliveries delivery ON delivery.id=item.delivery_id
          WHERE item.task_id=task.id AND delivery.state IN ('pending','retry_wait')) ORDER BY task.created_at LIMIT 128`).all(networkId, podId)
      for (const row of tasks) {
        const task = row as unknown as Task
        const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
        try { this.assertPinned(manifest) }
        catch (failure) {
          this.renewAfterAuthorityChange(task, manifest, failure)
          continue
        }
        try {
          const pending = task.state === 'approved' ? { ...manifest, items: manifest.items.filter(item => this.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(item.deliveryId)?.state === 'pending') } : manifest
          this.assertItems(pending, task.state === 'approved')
          if (manifest.expiresAt <= Date.now()) throw new Error('Network approval expired before dispatch')
        }
        catch (failure) { this.obsolete(task, failure) }
      }
    })
  }

  /** Returns the inputs of a batch for a fresh approval; the prior grant can never be reused. */
  private renew(task: Task, manifest: NetworkGateManifest, receipt: string, reason: string, held: string[] = []): number {
    let resumed = 0
    for (const item of manifest.items) {
      const delivery = this.store.db.prepare('SELECT * FROM network_deliveries WHERE id=?').get(item.deliveryId)!
      if (!['blocked', 'pending', 'unknown'].includes(delivery.state as string)) continue
      // An owner refusal is final; only held, released, uncertain or authority-obsoleted inputs are asked again.
      if (this.store.db.prepare(`SELECT 1 FROM network_gate_items WHERE delivery_id=? AND task_id!=? AND outcome IN ('held','released','unknown')`).get(item.deliveryId, task.id)) continue
      if (this.store.db.prepare(`SELECT 1 FROM network_gate_items WHERE delivery_id=? AND outcome IN ('denied','excluded','expired')`).get(item.deliveryId)) continue
      if (delivery.run_id) {
        const invocation = this.store.db.prepare('SELECT i.state,i.generation,c.stopped_receipt FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.run_id=?').get(delivery.run_id)!
        // An uninspected attempt or an applied or uncertain action keeps only this input back; it stays visible in its batch for review.
        if (!invocation.stopped_receipt || JSON.parse(invocation.stopped_receipt as string).generation !== invocation.generation || this.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(delivery.run_id)) { held.push('Inspect the stopped input attempt before requesting fresh approval'); continue }
        if (this.store.db.prepare(`SELECT 1 FROM network_effect_attempts WHERE run_id=? AND state!='confirmed_not_applied' UNION ALL SELECT 1 FROM effect_ledger WHERE run_id=? AND state!='confirmed_not_applied' LIMIT 1`).get(delivery.run_id, delivery.run_id)) { held.push('Applied or uncertain external actions cannot be repeated through gate review'); continue }
        abandonNetworkData(this.store, delivery.run_id as string, 'owner-gate-review')
        this.store.db.prepare(`UPDATE network_invocation_controls SET retry_at=NULL,resolved_receipt=json_object('decision',json(?),'priorResolution',json(resolved_receipt)) WHERE run_id=?`).run(receipt, delivery.run_id)
      }
      if (delivery.state !== 'pending') {
        const counted = this.store.db.prepare(`UPDATE network_queue_counts SET count=count-1 WHERE network_id=? AND state=? AND count>0`).run(task.network_id, delivery.state!)
        if (counted.changes !== 1) throw new Error('Network gate queue projection is inconsistent')
        this.store.db.prepare(`INSERT INTO network_queue_counts VALUES(?,'pending',1) ON CONFLICT(network_id,state) DO UPDATE SET count=count+1`).run(task.network_id)
      }
      this.store.db.prepare(`UPDATE network_deliveries SET state='pending',run_id=NULL,claim_token=NULL,boot_nonce=NULL,generation=generation+1,attempt=0,ready_at=?,reason=?,review_receipt=? WHERE id=?`).run(Date.now(), reason, receipt, item.deliveryId)
      this.store.db.prepare(`UPDATE network_gate_items SET outcome='obsolete',receipt=json_object('decision',json(?),'priorReceipt',json(receipt)) WHERE task_id=? AND delivery_id=?`).run(receipt, task.id, item.deliveryId)
      resumed++
    }
    if (!resumed) return 0
    this.store.db.prepare(`UPDATE network_gate_tasks SET state='superseded',generation=generation+1 WHERE id=?`).run(task.id)
    this.store.db.prepare(`UPDATE network_gate_controls SET resolution=json_object('decision',json(?),'priorResolution',json(resolution)) WHERE task_id=?`).run(receipt, task.id)
    return resumed
  }

  /** A paused member whose rights or script change asks again for approvals that were not yet consumed. */
  renewMember(networkId: string, podId: string, reason: string): number {
    const tasks = this.store.db.prepare(`SELECT task.* FROM network_gate_tasks task JOIN network_gate_controls control ON control.task_id=task.id WHERE task.network_id=? AND task.pod_id=?
      AND (task.state IN ('preparing','pending','approved') OR (task.state='superseded' AND ${supersededNeedsReview})) ORDER BY task.created_at`).all(networkId, podId)
    let renewed = 0
    for (const row of tasks) {
      const task = row as unknown as Task
      const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
      const count = this.renew(task, manifest, canonicalNetworkJson({ taskId: task.id, generation: task.generation, priorTaskState: task.state, priorGrantId: task.grant_id, reason, at: Date.now(), priorGrantCannotBeReused: true }), reason)
      if (count) this.trace(manifest, 'gate-fresh-approval', { taskId: task.id, reason, resumed: count, noApprovalReleased: true })
      renewed += count
    }
    return renewed
  }

  /** Undecided or unconsumed approvals of a changed consumer return to a fresh approval; unsafe inputs stay blocked for owner review. */
  private renewAfterAuthorityChange(task: Task, manifest: NetworkGateManifest, failure: unknown): void {
    const changed = failure instanceof Error ? failure.message : 'Network approval authority changed'
    const reason = `${changed}; fresh approval required`.slice(0, 10000)
    try {
      const resumed = this.store.transaction(() => this.renew(task, manifest, canonicalNetworkJson({ taskId: task.id, generation: task.generation, priorTaskState: task.state, priorGrantId: task.grant_id, reason, at: Date.now(), priorGrantCannotBeReused: true }), reason))
      if (resumed) this.trace(manifest, 'gate-fresh-approval', { taskId: task.id, reason, resumed, noApprovalReleased: true })
      else this.obsolete(task, failure)
    }
    catch (renewal) { this.obsolete(task, new Error(`${changed}; fresh approval refused: ${renewal instanceof Error ? renewal.message : 'unknown reason'}`)) }
  }

  private obsolete(task: Task, failure: unknown): void {
    const reason = (failure instanceof Error ? failure.message : 'Network approval authority changed').slice(0, 10000)
    this.store.db.prepare('UPDATE network_gate_tasks SET state=\'superseded\',generation=generation+1 WHERE id=?').run(task.id)
    this.store.db.prepare('UPDATE network_gate_controls SET error=? WHERE task_id=?').run(reason, task.id)
    this.dispose(task, 'obsolete', reason)
  }

  /** Ends held inputs without release. A denied input goes to the gate's excluded channel when it has one. */
  private dispose(task: Task, outcome: 'denied' | 'expired' | 'obsolete' | 'excluded', reason: string, deliveryIds?: string[]): void {
    const receipt = canonicalNetworkJson({ taskId: task.id, outcome, reason, at: Date.now(), priorTaskState: task.state, nothingReleasedByThisResolution: true })
    const manifest = parseNetworkGateManifest(JSON.parse(task.manifest))
    const definition = outcome === 'denied' ? parseNetworkDefinition(JSON.parse(this.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=? AND revision=?').get(task.network_id, manifest.networkRevision)!.contract as string)) : null
    const route = definition?.routes?.find(route => route.key === manifest.gate)
    for (const item of this.store.db.prepare('SELECT delivery_id,event_id FROM network_gate_items WHERE task_id=? AND outcome IN (\'held\',\'released\',\'unknown\')').all(task.id)) {
      if (deliveryIds && !deliveryIds.includes(item.delivery_id as string)) continue
      const delivery = this.store.db.prepare('SELECT state,run_id FROM network_deliveries WHERE id=?').get(item.delivery_id!)!
      if (!['pending', 'retry_wait', ...(outcome === 'excluded' ? ['blocked', 'unknown'] : [])].includes(delivery.state as string)) {
        // An owner refusal is recorded even when the delivery itself awaits other review.
        if (deliveryIds) this.store.db.prepare(`UPDATE network_gate_items SET outcome=?,receipt=json_object('decision',json(?),'priorReceipt',json(receipt)) WHERE task_id=? AND delivery_id=?`).run(outcome, receipt, task.id, item.delivery_id!)
        continue
      }
      const state = outcome === 'obsolete' ? 'blocked' : 'discarded'
      this.store.db.prepare('UPDATE network_deliveries SET state=?,generation=generation+1,reason=?,review_receipt=? WHERE id=? AND state=?').run(state, reason, receipt, item.delivery_id!, delivery.state!)
      const counted = this.store.db.prepare('UPDATE network_queue_counts SET count=count-1 WHERE network_id=? AND state=? AND count>0').run(task.network_id, delivery.state!)
      if (counted.changes !== 1) throw new Error('Network gate queue projection is inconsistent')
      this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,?,1) ON CONFLICT(network_id,state) DO UPDATE SET count=count+1').run(task.network_id, state)
      if (delivery.state === 'retry_wait') this.store.db.prepare('UPDATE network_invocation_controls SET retry_at=NULL WHERE run_id=?').run(delivery.run_id!)
      if (definition && route?.kind === 'approve' && route.excluded) this.invocations.events.routeGate(definition, route.key, item.event_id as string, route.excluded, 'excluded')
      this.store.db.prepare(`UPDATE network_gate_items SET outcome=?,receipt=json_object('decision',json(?),'priorReceipt',json(receipt)) WHERE task_id=? AND delivery_id=?`).run(outcome, receipt, task.id, item.delivery_id!)
    }
    this.store.db.prepare(`UPDATE network_gate_controls SET resolution=json_object('decision',json(?),'priorResolution',json(resolution)) WHERE task_id=?`).run(receipt, task.id)
    this.trace(manifest, 'gate-work-disposed', { receipt: JSON.parse(receipt), deliveryIds: deliveryIds ?? null })
  }

  private trace(manifest: NetworkGateManifest, kind: string, body: unknown): void {
    const cases = new Set(manifest.items.map(item => this.store.db.prepare('SELECT case_id FROM network_events WHERE network_id=? AND id=?').get(manifest.networkId, item.eventId)?.case_id as string | undefined).filter(Boolean))
    for (const caseId of cases.size ? cases : [null]) this.store.db.prepare('INSERT INTO network_trace_events(network_id,case_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(manifest.networkId, caseId ?? null, kind, canonicalNetworkJson(body), Date.now())
  }
}
