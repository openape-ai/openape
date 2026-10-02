import { currentCompositionDraft, NetworkReplacement } from './network-replacement'
import { networkSettlementIssues, previewNetworkArchive, retainedLegacyItems } from './network-retirement'
import { previewNetworkConversion, retainedLegacyDeliveries } from './network-migration'
import { parseConversionSelection } from '../../contracts/network-migration'
import type { ConversionSelection } from '../../contracts/network-migration'
import { NetworkViews } from './network-views'
import { validateNetworkComposition } from './network-composition'
import { networkDataPin, networkConfiguration } from './network-config'
import { ArtifactCleanupError } from './network-artifacts'
import { NetworkGates } from './network-gates'
import type { NetworkGateStep } from './network-gates'
import { randomUUID } from 'node:crypto'
import { parseOwner, sameOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { diagnoseNetwork, parseNetworkCommand, parseNetworkDefinition } from '../../contracts/networks'
import type { NetworkDefinition, NetworkDraft, NetworkHealth, NetworkPreview, NetworkView } from '../../contracts/networks'
import { parseGraphContract } from '../../contracts/graphs'
import { nextDue } from '../../contracts/clock'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { RunDispatcher } from '../runs/dispatcher'
import { assertNetworkQuota, NetworkQuotaError } from './network-quota'
import { pruneNetworkTraces } from './network-maintenance'
import { NetworkRecovery } from './network-recovery'
import { NetworkInvocations } from './network-invocations'
import { canonicalNetworkJson } from './network-events'
import type { NetworkAuthority } from './network-events'

interface ProcessBatch { preview: NetworkPreview, fingerprint: string, remaining: number, startedSources: Set<string> }

export class NetworkEngine {
  readonly invocations: NetworkInvocations
  readonly gates: NetworkGates
  private batches = new Map<string, ProcessBatch>()
  private nextMaintenanceAt = 0
  private pendingSettlements = new Map<string, Promise<void>>()
  constructor(private readonly store: PodDatabase, private readonly dispatcher: RunDispatcher, private readonly resources: ResourceRegistry, private readonly helper: string, private readonly currentOwner: () => Owner, private readonly immediateDispatch = true) {
    this.invocations = new NetworkInvocations(store, dispatcher.runs, helper)
    this.gates = new NetworkGates(store, this.invocations, resources)
    this.invocations.gates = this.gates
  }

  execute(value: unknown): NetworkView {
    const command = parseNetworkCommand(value)
    if (command.type === 'inspect' || command.type === 'retry' || command.type === 'reconcileEffect' || command.type === 'resolveConflict' || command.type === 'discardFailure') throw new Error('Network recovery must await process inspection')
    if (command.type === 'list') return this.view()
    if (command.type === 'conversionPreview') return { ...this.view(), conversion: previewNetworkConversion(this.store, this.resources, this.currentOwner(), command.selection) }
    if (command.type === 'convert') return this.convert(command.selection, command.expectedFingerprint)
    if (command.type === 'setup') return { ...this.view(), setup: new NetworkViews(this.store, this.resources).setup(parseOwner(this.currentOwner()), command.groupId, command.podIds) }
    if (command.type === 'create') return this.viewAfter(() => this.create(command.draft))
    if (command.type === 'replaceComposition') {
      const owner = parseOwner(this.currentOwner())
      const prior = this.store.db.prepare(`SELECT t.body FROM network_trace_events t JOIN networks n ON n.id=t.network_id WHERE n.id=? AND n.owner_issuer=? AND n.owner_subject=? AND t.kind='composition-replaced-reviewed' AND json_extract(t.body,'$.previousRevision')=? AND json_extract(t.body,'$.fingerprint')=?`).get(command.id, owner.issuer, owner.subject, command.revision, command.expectedFingerprint)
      if (prior && JSON.parse(prior.body as string).draftHash === digest(canonicalNetworkJson(command.draft))) return this.view()
    }
    const definition = this.definition(command.id, command.revision, ['detail', 'trace', 'records', 'legacyItems', 'archiveNetwork'].includes(command.type))
    if (command.type === 'replacementSetup' || command.type === 'replacementPreview' || command.type === 'replaceComposition') {
      const replacement = new NetworkReplacement(this.store, this.resources, parseOwner(this.currentOwner()), candidate => this.validate(candidate))
      const draft = command.type === 'replacementSetup' ? currentCompositionDraft(this.store, definition) : command.draft
      if (command.type !== 'replaceComposition') return { ...this.view(), replacement: replacement.preview(definition, draft) }
      replacement.replace(definition, draft, command.expectedFingerprint)
      return this.view()
    }
    if (command.type === 'archivePreview') return { ...this.view(), archiveReview: previewNetworkArchive(this.store, definition) }
    if (command.type === 'archiveNetwork') return this.archive(definition, command.expectedFingerprint)
    if (command.type === 'legacyItems') return { ...this.view(), legacyItems: retainedLegacyItems(this.store, definition.id, command.after) }
    if (command.type === 'gateOpen') return this.view()
    const views = new NetworkViews(this.store, this.resources)
    if (command.type === 'detail') return { ...this.view(), details: views.detail(definition) }
    if (command.type === 'trace') return { ...this.view(), trace: views.trace(definition.id, command.before, command.caseId) }
    if (command.type === 'records') return { ...this.view(), records: views.records(definition, command.collectionId, command.after) }
    if (command.type === 'gateExclude' || command.type === 'gateDiscard' || command.type === 'gateReview') {
      if (command.type === 'gateReview') this.validate(definition)
      this.gates.resolve(definition.id, command)
      return this.view()
    }
    if (command.type === 'activate' || command.type === 'pause') {
      const stoppedBatches: string[] = []
      this.store.transaction(() => {
        if (command.type === 'activate') {
          this.validate(definition)
          assertNetworkQuota(this.store, 16384)
          this.store.db.prepare('UPDATE network_runtime_status SET intake_error=NULL WHERE network_id=?').run(definition.id)
          const row = this.store.db.prepare('SELECT baseline_state,state FROM networks WHERE id=?').get(definition.id)!
          if (row.baseline_state !== 'ready') throw new Error('Restored network requires a reviewed baseline')
          if (row.state === 'active') return
          const sources = definition.members.flatMap(member => member.source?.schedule ? [{ podId: member.podId, nextAt: nextDue(member.source.schedule, null, Date.now()) }] : [])
          for (const source of sources) this.store.db.prepare('INSERT INTO network_source_clocks VALUES(?,?,?) ON CONFLICT(network_id,pod_id) DO UPDATE SET next_at=excluded.next_at').run(definition.id, source.podId, source.nextAt)
          this.trace(definition.id, 'network-activated', { sources })
        }
        this.store.db.prepare('UPDATE networks SET state=? WHERE id=? AND revision=? AND state!=\'archived\'').run(command.type === 'activate' ? 'active' : 'paused', definition.id, definition.revision)
        if (command.type === 'pause') {
          for (const [id, batch] of this.batches) {
            if (batch.preview.networkId !== definition.id) continue
            this.trace(definition.id, 'process-now-stopped', { previewId: id, admitted: batch.preview.budget - batch.remaining, explicitResumeRequired: true })
            this.store.db.prepare('UPDATE network_process_previews SET state=\'stopped\' WHERE id=?').run(id)
            stoppedBatches.push(id)
          }
          this.trace(definition.id, 'network-paused', { activeInvocationsMaySettle: true })
        }
      })
      for (const id of stoppedBatches) this.batches.delete(id)
      return this.view()
    }
    if (command.type === 'preview') {
      this.validate(definition)
      if (command.podIds.some(id => !definition.members.some(member => member.podId === id))) throw new Error('Process now selection contains a foreign network instance')
      for (const podId of command.podIds) {
        const pod = this.store.getPod(podId)
        const script = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript!)
        if (!script || !parseManifest(JSON.parse(script.manifest as string)).triggers.includes('manual')) throw new Error('Process now requires a script that allows manual triggers')
      }
      const paused = command.podIds.filter(id => this.store.getPod(id).lifecycle === 'paused')
      if (command.pausedPodIds.some(id => !paused.includes(id)) || paused.some(id => !command.pausedPodIds.includes(id))) throw new Error('Process now requires explicit review of paused instances')
      const preview: NetworkPreview = { id: randomUUID(), networkId: definition.id, revision: definition.revision, podIds: command.podIds, pausedPodIds: command.pausedPodIds, budget: command.budget, expiresAt: Date.now() + 300000, sources: definition.members.filter(member => member.source && command.podIds.includes(member.podId)).map(member => member.podId), consumers: definition.members.filter(member => !member.source && command.podIds.includes(member.podId)).map(member => member.podId) }
      const fingerprint = this.fingerprint(definition, preview)
      this.store.transaction(() => {
        assertNetworkQuota(this.store, Buffer.byteLength(canonicalNetworkJson(preview)) + 8192)
        if (Number(this.store.db.prepare('SELECT count(*) AS count FROM network_process_previews WHERE network_id=?').get(definition.id)!.count) >= 64) throw new Error('Network has 64 retained processing previews; wait for expiry or resolve unfinished invocations')
        this.store.db.prepare('INSERT INTO network_process_previews(id,network_id,preview,fingerprint,expires_at,remaining) VALUES(?,?,?,?,?,?)').run(preview.id, definition.id, canonicalNetworkJson(preview), fingerprint, preview.expiresAt, preview.budget)
        this.trace(definition.id, 'process-now-preview', { preview, fingerprint })
      })
      return { ...this.view(), preview }
    }
    const preview = this.store.transaction(() => {
      this.validate(definition)
      assertNetworkQuota(this.store, 16384)
      this.store.db.prepare('UPDATE network_runtime_status SET intake_error=NULL WHERE network_id=?').run(definition.id)
      const row = this.store.db.prepare('SELECT preview,fingerprint,consumed_at FROM network_process_previews WHERE network_id=? AND id=?').get(definition.id, command.previewId)
      if (!row) throw new Error('Process now preview is missing')
      const saved = { preview: JSON.parse(row.preview as string) as NetworkPreview, fingerprint: row.fingerprint as string }
      if (saved.preview.expiresAt < Date.now() || saved.preview.revision !== definition.revision || saved.fingerprint !== this.fingerprint(definition, saved.preview)) throw new Error('Process now preview expired or its instance configuration changed')
      const consumed = this.store.db.prepare('UPDATE network_process_previews SET consumed_at=?,state=\'running\' WHERE id=? AND consumed_at IS NULL').run(Date.now(), command.previewId)
      if (consumed.changes !== 1) throw new Error('Process now preview was already consumed')
      this.trace(definition.id, 'process-now-started', { previewId: saved.preview.id, budget: saved.preview.budget, expiresAt: saved.preview.expiresAt })
      return saved
    })
    this.batches.set(preview.preview.id, { preview: preview.preview, fingerprint: preview.fingerprint, remaining: preview.preview.budget, startedSources: new Set() })
    if (this.immediateDispatch) this.tick(false)
    return { ...this.view(), processId: preview.preview.id }
  }

  async reconcileStartup(): Promise<void> {
    let owner: Owner
    try { owner = parseOwner(this.currentOwner()) }
    catch (failure) {
      for (const row of this.store.db.prepare('SELECT id FROM networks LIMIT 64').all()) this.attention(row.id as string, 'startup-recovery-owner-unavailable', {}, failure)
      return
    }
    const pending = this.store.db.prepare(`SELECT i.network_id,i.network_revision,i.run_id,i.generation FROM network_invocations i JOIN networks n ON n.id=i.network_id JOIN run_leases l ON l.run_id=i.run_id
      WHERE n.owner_issuer=? AND n.owner_subject=? AND i.state IN ('interrupted','blocked','unknown') ORDER BY l.heartbeat`).all(owner.issuer, owner.subject)
    await Promise.all(pending.map(async (row) => {
      try { await this.recover({ type: 'inspect', id: row.network_id, revision: row.network_revision, runId: row.run_id, generation: row.generation }) }
      catch (failure) { this.attention(row.network_id as string, 'startup-recovery-needs-review', { runId: row.run_id }, failure) }
    }))
  }

  async recover(value: unknown): Promise<NetworkView> {
    const command = parseNetworkCommand(value)
    if (command.type !== 'inspect' && command.type !== 'retry' && command.type !== 'reconcileEffect' && command.type !== 'resolveConflict' && command.type !== 'discardFailure') throw new Error('Unsupported network recovery command')
    const definition = this.definition(command.id, command.revision)
    const invocation = this.store.db.prepare('SELECT pod_id,network_revision,execution_kind FROM network_invocations WHERE network_id=? AND run_id=?').get(command.id, command.runId)
    if (!invocation || invocation.network_revision !== command.revision) throw new Error('Network recovery revision changed')
    if (command.type === 'discardFailure' && invocation.execution_kind === 'gate_maintenance') throw new Error('Grant maintenance must be resolved through its gate task')
    const assertCurrent = () => { this.definition(command.id, command.revision) }
    const recovery = new NetworkRecovery(this.store, this.helper)
    await recovery.inspect(command.id, command.runId, command.generation, assertCurrent)
    if (command.type === 'discardFailure') recovery.discardFailure(command.id, command.runId, command.generation, command.evidence, assertCurrent)
    if (command.type === 'resolveConflict') recovery.resolveConflict(command.id, command.runId, command.generation, command.identityHash, command.decision, command.evidence, assertCurrent)
    if (command.type === 'reconcileEffect') recovery.reconcileEffect(command.id, command.runId, command.generation, command, assertCurrent)
    if (command.type === 'retry') {
      this.validate(definition)
      const preview: NetworkPreview = { id: randomUUID(), networkId: definition.id, revision: definition.revision, podIds: [invocation.pod_id as string], pausedPodIds: [], budget: 1, expiresAt: Date.now(), sources: [], consumers: [] }
      recovery.requeue(command.id, command.runId, command.generation, { fingerprint: this.fingerprint(definition, preview), resourceEpoch: this.resources.epoch(invocation.pod_id as string), assignmentRevision: this.store.getPod(invocation.pod_id as string).bindingRevision, scriptHash: this.store.getPod(invocation.pod_id as string).activeScript! }, assertCurrent)
    }
    return this.view()
  }

  tick(automatic = true): void {
    if (!this.store.db.prepare('SELECT 1 FROM networks LIMIT 1').get()) return
    if (Date.now() >= this.nextMaintenanceAt) {
      this.nextMaintenanceAt = Date.now() + 60000
      for (const [operation, perform] of [['traces', () => pruneNetworkTraces(this.store, Date.now())], ['artifacts', () => this.invocations.data.artifacts.prune()]] as const) {
        try {
          perform()
          this.store.db.prepare('UPDATE network_maintenance_status SET body=NULL,last_at=? WHERE operation=? AND body IS NOT NULL').run(Date.now(), operation)
        }
        catch (failure) {
          const details = failure instanceof ArtifactCleanupError ? { files: failure.files } : {}
          for (const network of this.store.db.prepare('SELECT id FROM networks ORDER BY id LIMIT 64').all()) this.attention(network.id as string, 'network-maintenance-failed', { operation, ...details }, failure)
        }
      }
    }
    for (const run of this.store.db.prepare('SELECT i.pod_id FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.state=\'running\' AND c.deadline<=?').all(Date.now())) this.dispatcher.cancelPod(run.pod_id as string, 'Network invocation deadline expired')
    for (const [id, batch] of this.batches) {
      let definition: NetworkDefinition
      try {
        definition = this.definition(batch.preview.networkId, batch.preview.revision)
        if (this.store.db.prepare('SELECT intake_error FROM network_runtime_status WHERE network_id=?').get(definition.id)?.intake_error) throw new Error('Process now stopped by network backpressure; explicit resume is required')
        if (batch.fingerprint !== this.fingerprint(definition, batch.preview)) throw new Error('Process now instance configuration changed during processing')
      }
      catch (failure) {
        this.attention(batch.preview.networkId, 'process-now-stopped', { previewId: id, explicitResumeRequired: true }, failure)
        this.endBatch(id, 'stopped'); continue
      }
      const occupied = Number(this.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count)
      const maximum = Number(this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency)
      let active = batch.remaining > 0 && occupied >= maximum; let started = false
      for (const member of definition.members.filter(item => batch.preview.podIds.includes(item.podId))) {
        if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=?').get(member.podId, member.podId)) { active = true; continue }
        if (batch.remaining <= 0 || batch.preview.expiresAt < Date.now() || (member.source && batch.startedSources.has(member.podId))) continue
        const runId = this.begin(definition, member.podId, 'manual', batch.preview.pausedPodIds.includes(member.podId), undefined, id)
        if (!runId) continue
        batch.remaining--; started = true; active = true
        if (member.source) batch.startedSources.add(member.podId)
        this.store.db.prepare('UPDATE network_process_previews SET remaining=?,started_sources=? WHERE id=?').run(batch.remaining, canonicalNetworkJson([...batch.startedSources]), id)
      }
      if ((!active && !started) || batch.preview.expiresAt < Date.now()) {
        this.trace(definition.id, 'process-now-finished', { previewId: id, admitted: batch.preview.budget - batch.remaining, expired: batch.preview.expiresAt < Date.now(), activeInvocationsMaySettle: active })
        this.endBatch(id, 'finished')
      }
    }
    if (!automatic) return
    let owner: Owner
    try { owner = parseOwner(this.currentOwner()) }
    catch (failure) {
      for (const row of this.store.db.prepare('SELECT id FROM networks LIMIT 64').all()) this.attention(row.id as string, 'network-owner-unavailable', {}, failure)
      return
    }
    for (const row of this.store.db.prepare('SELECT id,revision FROM networks WHERE owner_issuer=? AND owner_subject=? AND state=\'active\' ORDER BY CASE WHEN id>(SELECT coalesce(last_network,\'\') FROM network_scheduler_state WHERE id=1) THEN 0 ELSE 1 END,id LIMIT 64').all(owner.issuer, owner.subject)) {
      try {
        const definition = this.definition(row.id as string, row.revision as number)
        const lastPod = this.store.db.prepare('SELECT last_pod FROM network_runtime_status WHERE network_id=?').get(definition.id)?.last_pod
        const after = definition.members.findIndex(member => member.podId === lastPod) + 1
        for (const member of [...definition.members.slice(after), ...definition.members.slice(0, after)]) {
          if (!member.source) { this.begin(definition, member.podId, 'event', false); continue }
          const retry = this.store.db.prepare('SELECT 1 FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.network_id=? AND i.pod_id=? AND i.state=\'blocked\' AND c.retry_at<=? AND json_extract(i.manifest,\'$.reason\')!=\'manual\'').get(definition.id, member.podId, Date.now())
          if (retry) { this.begin(definition, member.podId, 'schedule', false); continue }
          if (!member.source.schedule) continue
          const due = this.sourceDue(definition, member.podId)
          if (due !== null && due <= Date.now()) this.begin(definition, member.podId, 'schedule', false, due)
        }
      }
      catch (failure) { this.attention(row.id as string, 'network-attention', {}, failure) }
    }
  }

  view(): NetworkView {
    if (!this.store.db.prepare('SELECT 1 FROM networks LIMIT 1').get()) return { networks: [] }
    const owner = parseOwner(this.currentOwner())
    const gates = this.gates.views(owner)
    return { ...(gates.length ? { gates } : {}), networks: this.store.db.prepare('SELECT id,revision,group_id,name,state FROM networks WHERE owner_issuer=? AND owner_subject=? ORDER BY created_at,id LIMIT 64').all(owner.issuer, owner.subject).map(row => ({ decisions: row.state === 'archived' ? 0 : Number(this.store.db.prepare('SELECT count(*) AS count FROM network_gate_tasks WHERE network_id=? AND json_extract(manifest,\'$.networkRevision\')=(SELECT revision FROM networks WHERE id=network_id) AND state IN (\'preparing\',\'pending\',\'consuming\',\'unknown\',\'superseded\')').get(row.id!)!.count), podIds: this.store.db.prepare('SELECT pod_id FROM network_members WHERE network_id=? ORDER BY pod_id').all(row.id!).map(member => member.pod_id as string), id: row.id as string, revision: row.revision as number, groupId: row.group_id as string, name: row.name as string, state: row.state as 'active' | 'paused' | 'archived', health: this.health(row.id as string), counts: Object.fromEntries(this.store.db.prepare('SELECT state,count FROM network_queue_counts WHERE network_id=? ORDER BY state').all(row.id!).map(count => [count.state as string, count.count as number])) })) }
  }

  private health(networkId: string): NetworkHealth {
    const status = this.store.db.prepare('SELECT last_dispatch_at,intake_error FROM network_runtime_status WHERE network_id=?').get(networkId)
    const failure = this.store.db.prepare(`SELECT i.run_id,i.generation,i.state,c.failure_kind,c.diagnostic,c.settlement_receipt
      FROM network_invocations i LEFT JOIN network_invocation_controls c ON c.run_id=i.run_id JOIN runs r ON r.id=i.run_id
      WHERE i.network_id=? AND c.retry_consumed_at IS NULL AND i.state IN ('interrupted','blocked','unknown')
      AND (c.resolved_receipt IS NULL OR (i.execution_kind='gate_maintenance'
        AND (c.stopped_receipt IS NULL OR json_extract(c.stopped_receipt,'$.generation')!=i.generation)
        AND EXISTS(SELECT 1 FROM network_gate_task_attempts attempt JOIN network_gate_tasks task ON task.id=attempt.task_id WHERE attempt.run_id=i.run_id AND task.state='unknown')))
      ORDER BY CASE WHEN i.execution_kind='gate_maintenance' AND (c.stopped_receipt IS NULL OR json_extract(c.stopped_receipt,'$.generation')!=i.generation) THEN 0 ELSE 1 END,
      r.started_at DESC,r.rowid DESC LIMIT 1`).get(networkId)
    return {
      lastFailure: failure ? { runId: failure.run_id as string, generation: Number(failure.generation), kind: failure.failure_kind as string ?? 'recovery', reason: failure.diagnostic as string ?? (failure.settlement_receipt ? (JSON.parse(failure.settlement_receipt as string).error ?? 'Network invocation requires inspection') as string : 'Network invocation requires process and effect inspection') } : null,
      oldestPendingAt: this.store.db.prepare('SELECT min(accepted_at) AS at FROM network_deliveries WHERE network_id=? AND state IN (\'pending\',\'retry_wait\')').get(networkId)!.at as number | null,
      nextRetryAt: this.store.db.prepare('SELECT min(c.retry_at) AS at FROM network_invocation_controls c JOIN network_invocations i ON i.run_id=c.run_id WHERE i.network_id=?').get(networkId)!.at as number | null,
      lastDispatchAt: status?.last_dispatch_at as number | null ?? null,
      lastSchedulerProgressAt: this.store.db.prepare('SELECT last_progress_at FROM network_scheduler_state WHERE id=1').get()!.last_progress_at as number | null,
      lastSchedulerError: this.store.db.prepare('SELECT last_error FROM network_scheduler_state WHERE id=1').get()!.last_error as string | null,
      intakeError: status?.intake_error as string | null ?? null,
    }
  }

  async stop(): Promise<void> {
    for (const batch of this.batches.values()) this.trace(batch.preview.networkId, 'process-now-stopped', { previewId: batch.preview.id, admitted: batch.preview.budget - batch.remaining, explicitResumeRequired: true })
    for (const id of this.batches.keys()) this.endBatch(id, 'stopped')
    await Promise.all(this.pendingSettlements.values())
  }

  updateInstance(podId: string, update: () => void): void {
    const membership = this.store.db.prepare('SELECT network_id FROM network_members WHERE pod_id=?').get(podId)
    if (!membership) { update(); return }
    const networkId = membership.network_id as string
    this.store.transaction(() => {
      const network = this.store.db.prepare('SELECT revision,state,baseline_state FROM networks WHERE id=?').get(networkId)!
      if (network.state === 'archived' || network.baseline_state !== 'ready') throw new Error('Archived or restored networks require review before definition updates')
      const definition = this.definition(networkId, network.revision as number)
      if (!definition.members.some(member => member.podId === podId)) throw new Error('Retired network instances retain their historical definition')
      const issues = networkSettlementIssues(this.store, networkId)
      if (issues.length) throw new Error(`Definition update blocked: ${issues.join('; ')}. The current version remains pinned.`)
      update()
      const binding = this.binding(podId, parseOwner(this.currentOwner()), definition.groupId)
      this.store.db.prepare('UPDATE network_members SET definition_version=?,binding_revision=? WHERE pod_id=?').run(binding.definition_version!, binding.binding_revision!, podId)
      const next = parseNetworkDefinition({ ...definition, revision: definition.revision + 1, members: definition.members.map(member => member.podId === podId ? { ...member, definitionVersion: binding.definition_version, bindingRevision: binding.binding_revision, contract: parseGraphContract(JSON.parse(binding.contract as string)) } : member) })
      this.validate(next)
      const body = canonicalNetworkJson(next)
      assertNetworkQuota(this.store, Buffer.byteLength(body) + 16384)
      this.store.db.prepare('INSERT INTO network_revisions VALUES(?,?,?,?,?)').run(networkId, next.revision, body, digest(body), Date.now())
      this.store.db.prepare('UPDATE networks SET revision=?,activation_epoch=activation_epoch+1 WHERE id=?').run(next.revision, networkId)
      for (const member of next.members) {
        for (const channel of member.contract.takes) {
          const spec = next.channels.find(item => item.name === channel)!
          const hash = digest(canonicalNetworkJson({ schemaVersion: spec.schemaVersion, schema: spec.schema }))
          this.store.db.prepare('INSERT INTO network_subscriptions VALUES(?,?,?,?,?,?,?)').run(randomUUID(), networkId, next.revision, member.podId, channel, hash, member.serialCase ? 1 : 0)
        }
      }
      this.execute({ type: 'pause', id: networkId, revision: next.revision })
      this.trace(networkId, 'definition-updated-paused', { podId, previousRevision: definition.revision, revision: next.revision, version: binding.definition_version, explicitActivationRequired: true })
    })
  }

  private archive(definition: NetworkDefinition, expectedFingerprint: string): NetworkView {
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT state FROM networks WHERE id=?').get(definition.id)!
      if (row.state === 'archived') {
        const receipt = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND kind=\'network-archived-reviewed\' ORDER BY id DESC LIMIT 1').get(definition.id)
        if (receipt && JSON.parse(receipt.body as string).fingerprint === expectedFingerprint) return
        throw new Error('This network has a different archive review')
      }
      const preview = previewNetworkArchive(this.store, definition)
      if (preview.fingerprint !== expectedFingerprint) throw new Error('Archive review changed; inspect the network again')
      if (preview.issues.length) throw new Error(preview.issues.join('; '))
      assertNetworkQuota(this.store, 16384)
      this.store.db.prepare('UPDATE networks SET state=\'archived\',activation_epoch=activation_epoch+1 WHERE id=?').run(definition.id)
      this.store.db.prepare('UPDATE network_process_previews SET consumed_at=coalesce(consumed_at,?),state=\'stopped\' WHERE network_id=? AND state=\'preview\'').run(Date.now(), definition.id)
      this.trace(definition.id, 'network-archived-reviewed', { fingerprint: expectedFingerprint, revision: definition.revision, message: 'Network archived after settlement review. Identities, history, retained legacy items and effect evidence remain preserved; no execution can resume.' })
    })
    return this.view()
  }

  private viewAfter(create: () => string): NetworkView {
    const createdId = create()
    return { ...this.view(), createdId }
  }

  convert(input: ConversionSelection, expectedFingerprint: string): NetworkView {
    const selection = parseConversionSelection(input)
    const owner = parseOwner(this.currentOwner())
    const selectionHash = digest(canonicalNetworkJson(selection))
    const createdId = this.store.transaction(() => {
      const previous = this.store.db.prepare('SELECT id,baseline_receipt FROM networks WHERE ancestor_workflow_id=? AND owner_issuer=? AND owner_subject=?').get(selection.workflowId, owner.issuer, owner.subject)
      if (previous) {
        const retained = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND kind=\'legacy-conversion-reviewed\' ORDER BY id LIMIT 1').get(previous.id!)
        const receipt = retained ? JSON.parse(retained.body as string) : null
        if (receipt?.kind !== 'conversion' || receipt.fingerprint !== expectedFingerprint || receipt.selectionHash !== selectionHash) throw new Error('This graph already has a different reviewed conversion')
        return previous.id as string
      }
      const preview = previewNetworkConversion(this.store, this.resources, owner, selection)
      if (preview.fingerprint !== expectedFingerprint) throw new Error('Conversion review changed; inspect the current graph again')
      if (preview.issues.length) throw new Error(preview.issues.join('; '))
      const podIds = new Set(preview.legacy.nodes.map(node => node.podId))
      const checkpoints = preview.draft.members.map(member => ({ podId: member.podId, ...this.store.checkpoint(member.podId) }))
      this.store.db.prepare('UPDATE workflows SET archived=1,enabled=0,paused=1,next_at=NULL,revision=revision+1 WHERE id=?').run(preview.legacy.id)
      this.store.db.prepare('DELETE FROM workflow_members WHERE workflow_id=?').run(preview.legacy.id)
      for (const podId of podIds) this.store.db.prepare('UPDATE schedules SET enabled=0,next_at=NULL,revision=revision+1 WHERE pod_id=?').run(podId)
      const id = this.create(preview.draft, podIds)
      const receipt = { kind: 'conversion', fingerprint: expectedFingerprint, selectionHash, legacy: preview.legacy, legacyHash: digest(canonicalNetworkJson(preview.legacy)), checkpoints, pending: { disposition: selection.pending, count: preview.pending, items: retainedLegacyDeliveries(this.store, preview.legacy.id) }, reviewedAt: Date.now() }
      const baseline = { kind: 'conversion', fingerprint: expectedFingerprint, selectionHash, legacyHash: receipt.legacyHash, checkpoints: checkpoints.map(checkpoint => ({ podId: checkpoint.podId, revision: checkpoint.revision, hash: digest(canonicalNetworkJson(checkpoint.body)) })), pending: { disposition: receipt.pending.disposition, count: receipt.pending.count, hash: digest(canonicalNetworkJson(receipt.pending.items)) } }
      assertNetworkQuota(this.store, Buffer.byteLength(canonicalNetworkJson(receipt)) + Buffer.byteLength(canonicalNetworkJson(baseline)) + 16384)
      this.store.db.prepare('UPDATE networks SET ancestor_workflow_id=?,ancestor_revision=?,baseline_receipt=? WHERE id=?').run(preview.legacy.id, preview.legacy.revision, canonicalNetworkJson(baseline), id)
      for (const checkpoint of checkpoints) this.store.db.prepare('UPDATE network_checkpoints SET revision=?,body=? WHERE network_id=? AND pod_id=?').run(checkpoint.revision, canonicalNetworkJson(checkpoint.body), id, checkpoint.podId)
      this.trace(id, 'legacy-conversion-reviewed', { ...receipt, message: `Converted from ${preview.legacy.name}; ${preview.pending} pending legacy deliveries retained without replay. Activation remains separate.`, explicitActivationRequired: true })
      return id
    })
    return { ...this.view(), createdId }
  }

  private create(draft: NetworkDraft, convertedPods?: ReadonlySet<string>): string {
    return this.store.transaction(() => {
      const owner = parseOwner(this.currentOwner()); const id = randomUUID(); const now = Date.now()
      if (this.store.db.prepare('SELECT 1 FROM networks WHERE group_id=? AND state!=\'archived\'').get(draft.groupId)) throw new Error('Group already has a persistent network')
      const members = draft.members.map((selection) => {
        const binding = this.binding(selection.podId, owner, draft.groupId)
        const legacy = this.store.db.prepare(`SELECT 1 FROM workflow_members WHERE pod_id=? UNION ALL SELECT 1 FROM schedules WHERE pod_id=?
          UNION ALL SELECT 1 FROM runs WHERE pod_id=? UNION ALL SELECT 1 FROM accepted_events WHERE pod_id=?
          UNION ALL SELECT 1 FROM control_changes c,json_each(c.body,'$.targets') t WHERE json_extract(c.body,'$.state') IN ('pending','running') AND json_extract(t.value,'$.podId')=? LIMIT 1`).get(selection.podId, selection.podId, selection.podId, selection.podId, selection.podId)
        if (this.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?').get(selection.podId) || (!convertedPods?.has(selection.podId) && (legacy || this.store.checkpoint(selection.podId).revision !== 0 || canonicalNetworkJson(this.store.checkpoint(selection.podId).body) !== '{}'))) throw new Error('Network creation requires a separate fresh instance; use reviewed conversion for legacy state')
        return { podId: selection.podId, definitionId: binding.definition_id as string, definitionVersion: binding.definition_version as number, bindingRevision: binding.binding_revision as number, contract: parseGraphContract(JSON.parse(binding.contract as string)), source: selection.source ? { bindingId: randomUUID(), schedule: selection.source.schedule } : null, serialCase: selection.serialCase }
      })
      const { sharedValues: _sharedValues, expectedSetup: _expectedSetup, ...composition } = draft
      const definition = parseNetworkDefinition({ formatVersion: draft.joins ? 3 : draft.gates ? 2 : 1, kind: 'network', semantics: 'persistent-network-v1', id, revision: 1, ...composition, ...(draft.joins ? { gates: draft.gates ?? [] } : {}), members })
      const sharedValues = validateNetworkComposition(this.store, this.resources, owner, draft, definition)
      this.validate(definition)
      const body = canonicalNetworkJson(definition)
      this.store.db.prepare('INSERT INTO networks(id,owner_issuer,owner_subject,group_id,name,revision,restore_nonce,created_at) VALUES(?,?,?,?,?,1,?,?)').run(id, owner.issuer, owner.subject, draft.groupId, draft.name, randomUUID(), now)
      this.store.db.prepare('INSERT INTO network_revisions VALUES(?,1,?,?,?)').run(id, body, digest(body), now)
      for (const member of members) {
        this.store.db.prepare('INSERT INTO network_members VALUES(?,?,?,?,?,?)').run(id, member.podId, member.bindingRevision, member.definitionId, member.definitionVersion, member.source?.bindingId ?? null)
        this.store.db.prepare('INSERT INTO network_checkpoints VALUES(?,?,0,\'{}\')').run(id, member.podId)
        for (const channel of member.contract.takes) {
          const spec = definition.channels.find(item => item.name === channel)!
          const hash = digest(canonicalNetworkJson({ schemaVersion: spec.schemaVersion, schema: spec.schema }))
          this.store.db.prepare('INSERT INTO network_subscriptions VALUES(?,?,1,?,?,?,?)').run(randomUUID(), id, member.podId, channel, hash, member.serialCase ? 1 : 0)
        }
      }
      for (const [name, value] of Object.entries(sharedValues)) {
        this.store.db.prepare('INSERT INTO composition_config VALUES(?,?,?)').run(id, name, JSON.stringify(value))
      }
      for (const member of members) networkConfiguration(this.store, id, member.podId)
      this.trace(id, 'network-created-paused', { memberCount: members.length })
      return id
    })
  }

  private binding(podId: string, owner: Owner, groupId: string) {
    const row = this.store.db.prepare(`SELECT b.*,v.contract,v.content_hash,v.lock_hash,d.owner_issuer,d.owner_subject FROM instance_definition_bindings b
      JOIN pod_definition_versions v ON v.definition_id=b.definition_id AND v.version=b.definition_version JOIN pod_definitions d ON d.id=b.definition_id WHERE b.pod_id=?`).get(podId)
    if (!row || !sameOwner(owner, { issuer: row.owner_issuer as string, subject: row.owner_subject as string }) || this.store.db.prepare('SELECT group_id FROM pod_memberships WHERE pod_id=?').get(podId)?.group_id !== groupId) throw new Error('Network instance definition belongs to another owner or group')
    return row
  }

  private validate(definition: NetworkDefinition): void {
    if (diagnoseNetwork(definition).length) throw new Error('Network channel contracts contain blocking diagnostics')
    const network = this.store.db.prepare('SELECT baseline_state FROM networks WHERE id=?').get(definition.id)
    if (network && network.baseline_state !== 'ready') throw new Error('Restored network requires a reviewed baseline')
    const owner = parseOwner(this.currentOwner())
    for (const member of definition.members) {
      const binding = this.binding(member.podId, owner, definition.groupId); const pod = this.store.getPod(member.podId)
      if (pod.lifecycle === 'archived' || pod.activeScript !== binding.content_hash || member.definitionId !== binding.definition_id || member.definitionVersion !== binding.definition_version || member.bindingRevision !== binding.binding_revision || canonicalNetworkJson(parseGraphContract(JSON.parse(binding.contract as string))) !== canonicalNetworkJson(member.contract)) throw new Error('Network instance differs from its pinned definition')
      const script = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(member.podId, pod.activeScript!)
      if (!script) throw new Error('Network pinned script is missing')
      const manifest = parseManifest(JSON.parse(script.manifest as string))
      if (manifest.contract === undefined || canonicalNetworkJson(parseGraphContract(manifest.contract)) !== canonicalNetworkJson(member.contract) || manifest.dependencyLockHash !== binding.lock_hash) throw new Error('Network script contract or dependency lock differs from its definition')
      if (manifest.capabilities.some(capability => capability !== 'mail.read')) throw new Error('Network capabilities require declared runtime ports')
      if (!member.source && manifest.capabilities.includes('mail.read')) throw new Error('Network mail reads require a declared source')
      if (!member.source && !manifest.triggers.includes('event')) throw new Error('Network consumer script must allow event triggers')
      if (member.source?.schedule && !manifest.triggers.includes('schedule')) throw new Error('Scheduled network source script must allow schedule triggers')
      if (!this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(member.podId, pod.activeScript!, pod.bindingRevision, this.resources.epoch(member.podId))) throw new Error('Network instance needs validation for its current resources')
    }
  }

  private definition(id: string, revision: number, includeArchived = false): NetworkDefinition {
    const owner = parseOwner(this.currentOwner())
    const row = this.store.db.prepare('SELECT r.contract FROM networks n JOIN network_revisions r ON r.network_id=n.id AND r.revision=n.revision WHERE n.id=? AND n.revision=? AND n.owner_issuer=? AND n.owner_subject=? AND (n.state!=\'archived\' OR ?=1)').get(id, revision, owner.issuer, owner.subject, includeArchived ? 1 : 0)
    if (!row) throw new Error('Network revision changed or is unavailable to this owner')
    return parseNetworkDefinition(JSON.parse(row.contract as string))
  }

  private fingerprint(definition: NetworkDefinition, preview: NetworkPreview): string {
    const network = this.store.db.prepare('SELECT restore_nonce,activation_epoch,baseline_state FROM networks WHERE id=?').get(definition.id)!
    return digest(canonicalNetworkJson({ network, revision: definition.revision, members: preview.podIds.map(id => ({ pod: this.store.getPod(id), dataPin: networkDataPin(this.store, definition.id, id), resourceEpoch: this.resources.epoch(id), binding: this.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(id) })) }))
  }

  private begin(definition: NetworkDefinition, podId: string, reason: 'manual' | 'schedule' | 'event', allowPaused: boolean, due?: number, processPreviewId: string | null = null): string | null {
    let authority: NetworkAuthority | null = null
    const admission: { step: NetworkGateStep | null } = { step: null }
    try {
      authority = this.store.transaction(() => {
        if (reason !== 'schedule') {
          this.gates.prepare(definition, podId)
          const last = this.store.db.prepare('SELECT execution_kind FROM network_invocations WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(podId)
          if (last?.execution_kind !== 'gate_maintenance') admission.step = this.gates.reserve(definition, podId, reason, allowPaused, processPreviewId)
          if (admission.step) return admission.step.authority
        }
        const reserved = this.invocations.reserve(definition.id, podId, this.resources.epoch(podId), reason, allowPaused, processPreviewId)
        if (!reserved && reason !== 'schedule') { admission.step = this.gates.reserve(definition, podId, reason, allowPaused, processPreviewId); return admission.step?.authority ?? null }
        if (!reserved || due === undefined) return reserved
        const schedule = definition.members.find(member => member.podId === podId)!.source!.schedule!
        this.store.db.prepare('UPDATE network_source_clocks SET next_at=? WHERE network_id=? AND pod_id=?').run(nextDue(schedule, due, Date.now()), definition.id, podId)
        return reserved
      })
      if (!authority) return null
      this.store.db.prepare('INSERT INTO network_runtime_status(network_id,last_pod,last_dispatch_at) VALUES(?,?,?) ON CONFLICT(network_id) DO UPDATE SET last_pod=excluded.last_pod,last_dispatch_at=excluded.last_dispatch_at').run(definition.id, podId, Date.now())
      this.store.db.prepare('UPDATE network_scheduler_state SET last_network=? WHERE id=1').run(definition.id)
      if (admission.step) this.dispatcher.startGate(this.gates, admission.step)
      else this.dispatcher.startNetwork(this.invocations, authority)
      return authority.runId
    }
    catch (failure) {
      if (failure instanceof NetworkQuotaError) {
        this.store.db.prepare('UPDATE networks SET state=\'paused\' WHERE id=?').run(definition.id)
        this.store.db.prepare('INSERT INTO network_runtime_status(network_id,intake_error,inspected_at) VALUES(?,?,?) ON CONFLICT(network_id) DO UPDATE SET intake_error=excluded.intake_error,inspected_at=excluded.inspected_at').run(definition.id, failure.message, Date.now())
      }
      const message = (failure instanceof Error ? failure.message : 'Network admission failed').slice(0, 10000)
      const previous = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND kind=\'instance-attention\' AND json_extract(body,\'$.podId\')=? ORDER BY id DESC LIMIT 1').get(definition.id, podId)
      if (!previous || (JSON.parse(previous.body as string) as { message: string }).message !== message) this.trace(definition.id, 'instance-attention', { podId, message })
      if (admission.step) {
        const failedStep = admission.step
        this.pendingSettlements.set(failedStep.authority.runId, this.gates.failStep(failedStep, failure).catch((cleanupFailure) => { console.error('Network gate admission cleanup requires inspection', cleanupFailure) }).finally(() => { this.pendingSettlements.delete(failedStep.authority.runId) }))
      }
      else if (authority) {
        this.pendingSettlements.set(authority.runId, this.closeUnstarted(definition.id, authority, message).catch((failure) => { console.error('Network admission recovery failed; retained authority requires inspection', failure) }))
      }
      return null
    }
  }

  private async closeUnstarted(networkId: string, authority: NetworkAuthority, message: string): Promise<void> {
    try { await this.invocations.finish(authority, 'failed', 'Network admission failed before process launch', message, [], []) }
    catch (failure) {
      try { await this.invocations.failClosed(authority, failure) }
      catch (interruptionFailure) { console.error('Network admission interruption could not be recorded', interruptionFailure) }
      this.trace(networkId, 'admission-cleanup-unverified', { runId: authority.runId, message: (failure instanceof Error ? failure.message : 'Admission cleanup failed').slice(0, 10000), leaseRetained: true })
      console.error('Network admission cleanup failed; its retained lease requires inspection')
    }
    finally { this.pendingSettlements.delete(authority.runId) }
  }

  private sourceDue(definition: NetworkDefinition, podId: string): number | null {
    return this.store.db.prepare('SELECT next_at FROM network_source_clocks WHERE network_id=? AND pod_id=?').get(definition.id, podId)?.next_at as number ?? null
  }

  private endBatch(id: string, state: 'stopped' | 'finished'): void {
    this.store.db.prepare('UPDATE network_process_previews SET state=? WHERE id=? AND consumed_at IS NOT NULL').run(state, id)
    this.batches.delete(id)
  }

  private attention(networkId: string, kind: string, context: Record<string, unknown>, failure: unknown): void {
    const body = { ...context, message: (failure instanceof Error ? failure.message : 'Network processing failed').slice(0, 10000) }
    if (kind === 'network-maintenance-failed') {
      this.store.transaction(() => {
        const previous = this.store.db.prepare('SELECT 1 FROM network_maintenance_status WHERE network_id=? AND operation=?').get(networkId, context.operation as string)
        this.store.db.prepare(`INSERT INTO network_maintenance_status VALUES(?,?,?,1,?,?) ON CONFLICT(network_id,operation) DO UPDATE SET body=excluded.body,failure_count=failure_count+1,last_at=excluded.last_at`).run(networkId, context.operation as string, canonicalNetworkJson(body), Date.now(), Date.now())
        if (!previous) this.trace(networkId, kind, { operation: context.operation, message: body.message, boundedStatusRecorded: true })
      })
      return
    }
    const previous = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND kind=? ORDER BY id DESC LIMIT 1').get(networkId, kind)
    if (!previous || previous.body !== canonicalNetworkJson(body)) this.trace(networkId, kind, body)
  }

  private trace(networkId: string, kind: string, body: unknown): void {
    this.store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,?)').run(networkId, kind, canonicalNetworkJson(body), Date.now())
  }
}
