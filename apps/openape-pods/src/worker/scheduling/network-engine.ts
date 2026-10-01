import { randomUUID } from 'node:crypto'
import { parseOwner, sameOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { diagnoseNetwork, networkLimits, parseNetworkCommand, parseNetworkDefinition } from '../../contracts/networks'
import type { NetworkDefinition, NetworkDraft, NetworkPreview, NetworkView } from '../../contracts/networks'
import { parseGraphContract } from '../../contracts/graphs'
import { nextDue } from '../../contracts/clock'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { RunDispatcher } from '../runs/dispatcher'
import { NetworkInvocations } from './network-invocations'
import { canonicalNetworkJson } from './network-events'
import type { NetworkAuthority } from './network-events'

interface ProcessBatch { preview: NetworkPreview, fingerprint: string, remaining: number, startedSources: Set<string> }

export class NetworkEngine {
  readonly invocations: NetworkInvocations
  private batches = new Map<string, ProcessBatch>()
  private pendingSettlements = new Map<string, Promise<void>>()
  constructor(private readonly store: PodDatabase, private readonly dispatcher: RunDispatcher, private readonly resources: ResourceRegistry, helper: string, private readonly currentOwner: () => Owner) {
    this.invocations = new NetworkInvocations(store, dispatcher.runs, helper)
  }

  execute(value: unknown): NetworkView {
    const command = parseNetworkCommand(value)
    if (command.type === 'list') return this.view()
    if (command.type === 'create') return this.viewAfter(() => this.create(command.draft))
    const definition = this.definition(command.id, command.revision)
    if (command.type === 'activate' || command.type === 'pause') {
      this.store.transaction(() => {
        if (command.type === 'activate') {
          this.validate(definition)
          const row = this.store.db.prepare('SELECT baseline_state,state FROM networks WHERE id=?').get(definition.id)!
          if (row.baseline_state !== 'ready') throw new Error('Restored network requires a reviewed baseline')
          if (row.state === 'active') return
          const sources = definition.members.flatMap(member => member.source?.schedule ? [{ podId: member.podId, nextAt: nextDue(member.source.schedule, null, Date.now()) }] : [])
          this.trace(definition.id, 'network-activated', { sources })
        }
        this.store.db.prepare('UPDATE networks SET state=? WHERE id=? AND revision=? AND state!=\'archived\'').run(command.type === 'activate' ? 'active' : 'paused', definition.id, definition.revision)
        if (command.type === 'pause') {
          for (const [id, batch] of this.batches) {
            if (batch.preview.networkId !== definition.id) continue
            this.trace(definition.id, 'process-now-stopped', { previewId: id, admitted: batch.preview.budget - batch.remaining, explicitResumeRequired: true })
            this.batches.delete(id)
          }
          this.trace(definition.id, 'network-paused', { activeInvocationsMaySettle: true })
        }
      })
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
      this.trace(definition.id, 'process-now-preview', { preview, fingerprint: this.fingerprint(definition, preview) })
      return { ...this.view(), preview }
    }
    const preview = this.store.transaction(() => {
      this.validate(definition)
      const row = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND kind=\'process-now-preview\' AND json_extract(body,\'$.preview.id\')=? ORDER BY id DESC LIMIT 1').get(definition.id, command.previewId)
      if (!row) throw new Error('Process now preview is missing')
      const saved = JSON.parse(row.body as string) as { preview: NetworkPreview, fingerprint: string }
      if (saved.preview.expiresAt < Date.now() || saved.preview.revision !== definition.revision || saved.fingerprint !== this.fingerprint(definition, saved.preview)) throw new Error('Process now preview expired or its instance configuration changed')
      if (this.store.db.prepare('SELECT 1 FROM network_trace_events WHERE network_id=? AND kind=\'process-now-started\' AND json_extract(body,\'$.previewId\')=?').get(definition.id, command.previewId)) throw new Error('Process now preview was already consumed')
      this.trace(definition.id, 'process-now-started', { previewId: saved.preview.id, budget: saved.preview.budget, expiresAt: saved.preview.expiresAt })
      return saved
    })
    this.batches.set(preview.preview.id, { preview: preview.preview, fingerprint: preview.fingerprint, remaining: preview.preview.budget, startedSources: new Set() })
    this.tick()
    return { ...this.view(), processId: preview.preview.id }
  }

  tick(): void {
    if (!this.store.db.prepare('SELECT 1 FROM networks LIMIT 1').get()) return
    for (const [id, batch] of this.batches) {
      let definition: NetworkDefinition
      try {
        definition = this.definition(batch.preview.networkId, batch.preview.revision)
        if (batch.fingerprint !== this.fingerprint(definition, batch.preview)) throw new Error('Process now instance configuration changed during processing')
      }
      catch (failure) {
        this.attention(batch.preview.networkId, 'process-now-stopped', { previewId: id, explicitResumeRequired: true }, failure)
        this.batches.delete(id); continue
      }
      const occupied = Number(this.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count)
      const maximum = Number(this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency)
      let active = batch.remaining > 0 && occupied >= maximum; let started = false
      for (const member of definition.members.filter(item => batch.preview.podIds.includes(item.podId))) {
        if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=?').get(member.podId, member.podId)) { active = true; continue }
        if (batch.remaining <= 0 || batch.preview.expiresAt < Date.now() || (member.source && batch.startedSources.has(member.podId))) continue
        const runId = this.begin(definition, member.podId, 'manual', batch.preview.pausedPodIds.includes(member.podId))
        if (!runId) continue
        batch.remaining--; started = true; active = true
        if (member.source) batch.startedSources.add(member.podId)
      }
      if ((!active && !started) || batch.preview.expiresAt < Date.now()) {
        this.trace(definition.id, 'process-now-finished', { previewId: id, admitted: batch.preview.budget - batch.remaining, expired: batch.preview.expiresAt < Date.now(), activeInvocationsMaySettle: active })
        this.batches.delete(id)
      }
    }
    let owner: Owner
    try { owner = parseOwner(this.currentOwner()) }
    catch (failure) {
      for (const row of this.store.db.prepare('SELECT id FROM networks LIMIT 64').all()) this.attention(row.id as string, 'network-owner-unavailable', {}, failure)
      return
    }
    for (const row of this.store.db.prepare('SELECT id,revision FROM networks WHERE owner_issuer=? AND owner_subject=? AND state=\'active\' ORDER BY created_at,id LIMIT 64').all(owner.issuer, owner.subject)) {
      try {
        const definition = this.definition(row.id as string, row.revision as number)
        for (const member of definition.members) {
          if (!member.source) { this.begin(definition, member.podId, 'event', false); continue }
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
    return { networks: this.store.db.prepare('SELECT id,revision,group_id,name,state FROM networks WHERE owner_issuer=? AND owner_subject=? ORDER BY created_at,id LIMIT 64').all(owner.issuer, owner.subject).map(row => ({ id: row.id as string, revision: row.revision as number, groupId: row.group_id as string, name: row.name as string, state: row.state as 'active' | 'paused' | 'archived', counts: Object.fromEntries(this.store.db.prepare('SELECT state,count FROM network_queue_counts WHERE network_id=? ORDER BY state').all(row.id!).map(count => [count.state as string, count.count as number])) })) }
  }

  async stop(): Promise<void> {
    for (const batch of this.batches.values()) this.trace(batch.preview.networkId, 'process-now-stopped', { previewId: batch.preview.id, admitted: batch.preview.budget - batch.remaining, explicitResumeRequired: true })
    this.batches.clear()
    await Promise.all(this.pendingSettlements.values())
  }

  private viewAfter(create: () => string): NetworkView {
    const createdId = create()
    return { ...this.view(), createdId }
  }

  private create(draft: NetworkDraft): string {
    return this.store.transaction(() => {
      const owner = parseOwner(this.currentOwner()); const id = randomUUID(); const now = Date.now()
      if ((this.store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count as number) >= networkLimits.networks) throw new Error('Workspace supports at most 64 persistent networks')
      if (this.store.db.prepare('SELECT 1 FROM networks WHERE group_id=? AND state!=\'archived\'').get(draft.groupId)) throw new Error('Group already has a persistent network')
      const members = draft.members.map((selection) => {
        const binding = this.binding(selection.podId, owner, draft.groupId)
        const legacy = this.store.db.prepare(`SELECT 1 FROM workflow_members WHERE pod_id=? UNION ALL SELECT 1 FROM schedules WHERE pod_id=?
          UNION ALL SELECT 1 FROM runs WHERE pod_id=? UNION ALL SELECT 1 FROM accepted_events WHERE pod_id=?
          UNION ALL SELECT 1 FROM control_changes c,json_each(c.body,'$.targets') t WHERE json_extract(c.body,'$.state') IN ('pending','running') AND json_extract(t.value,'$.podId')=? LIMIT 1`).get(selection.podId, selection.podId, selection.podId, selection.podId, selection.podId)
        if (legacy || this.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?').get(selection.podId) || this.store.checkpoint(selection.podId).revision !== 0 || canonicalNetworkJson(this.store.checkpoint(selection.podId).body) !== '{}') throw new Error('Network creation requires a separate fresh instance; use reviewed conversion for legacy state')
        return { podId: selection.podId, definitionId: binding.definition_id as string, definitionVersion: binding.definition_version as number, bindingRevision: binding.binding_revision as number, contract: parseGraphContract(JSON.parse(binding.contract as string)), source: selection.source ? { bindingId: randomUUID(), schedule: selection.source.schedule } : null, serialCase: selection.serialCase }
      })
      const definition = parseNetworkDefinition({ formatVersion: 1, kind: 'network', semantics: 'persistent-network-v1', id, revision: 1, ...draft, members })
      this.validate(definition)
      const body = canonicalNetworkJson(definition); this.store.assertStorage(Buffer.byteLength(body))
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
      if (manifest.capabilities.length) throw new Error('Network capabilities require declared runtime ports')
      if (!member.source && !manifest.triggers.includes('event')) throw new Error('Network consumer script must allow event triggers')
      if (member.source?.schedule && !manifest.triggers.includes('schedule')) throw new Error('Scheduled network source script must allow schedule triggers')
      if (!this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(member.podId, pod.activeScript!, pod.bindingRevision, this.resources.epoch(member.podId))) throw new Error('Network instance needs validation for its current resources')
    }
  }

  private definition(id: string, revision: number): NetworkDefinition {
    const owner = parseOwner(this.currentOwner())
    const row = this.store.db.prepare('SELECT r.contract FROM networks n JOIN network_revisions r ON r.network_id=n.id AND r.revision=n.revision WHERE n.id=? AND n.revision=? AND n.owner_issuer=? AND n.owner_subject=? AND n.state!=\'archived\'').get(id, revision, owner.issuer, owner.subject)
    if (!row) throw new Error('Network revision changed or is unavailable to this owner')
    return parseNetworkDefinition(JSON.parse(row.contract as string))
  }

  private fingerprint(definition: NetworkDefinition, preview: NetworkPreview): string {
    const network = this.store.db.prepare('SELECT restore_nonce,activation_epoch,baseline_state FROM networks WHERE id=?').get(definition.id)!
    return digest(canonicalNetworkJson({ network, revision: definition.revision, members: preview.podIds.map(id => ({ pod: this.store.getPod(id), resourceEpoch: this.resources.epoch(id), binding: this.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(id) })) }))
  }

  private begin(definition: NetworkDefinition, podId: string, reason: 'manual' | 'schedule' | 'event', allowPaused: boolean, due?: number): string | null {
    let authority: NetworkAuthority | null = null
    try {
      authority = this.store.transaction(() => {
        const reserved = this.invocations.reserve(definition.id, podId, this.resources.epoch(podId), reason, allowPaused)
        if (!reserved || due === undefined) return reserved
        const schedule = definition.members.find(member => member.podId === podId)!.source!.schedule!
        const row = this.store.db.prepare('SELECT manifest FROM network_invocations WHERE run_id=?').get(reserved.runId)!
        const activationId = this.store.db.prepare('SELECT id FROM network_trace_events WHERE network_id=? AND kind=\'network-activated\' ORDER BY id DESC LIMIT 1').get(definition.id)!.id
        this.store.db.prepare('UPDATE network_invocations SET manifest=? WHERE run_id=?').run(canonicalNetworkJson({ ...JSON.parse(row.manifest as string), sourceActivationId: activationId, sourceNextAt: nextDue(schedule, due, Date.now()) }), reserved.runId)
        return reserved
      })
      if (!authority) return null
      this.dispatcher.startNetwork(this.invocations, authority)
      return authority.runId
    }
    catch (failure) {
      const message = (failure instanceof Error ? failure.message : 'Network admission failed').slice(0, 10000)
      const previous = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND kind=\'instance-attention\' AND json_extract(body,\'$.podId\')=? ORDER BY id DESC LIMIT 1').get(definition.id, podId)
      if (!previous || (JSON.parse(previous.body as string) as { message: string }).message !== message) this.trace(definition.id, 'instance-attention', { podId, message })
      if (authority) this.pendingSettlements.set(authority.runId, this.closeUnstarted(definition.id, authority, message))
      return null
    }
  }

  private async closeUnstarted(networkId: string, authority: NetworkAuthority, message: string): Promise<void> {
    try { await this.invocations.finish(authority, 'failed', 'Network admission failed before process launch', message, [], []) }
    catch (failure) {
      this.trace(networkId, 'admission-cleanup-unverified', { runId: authority.runId, message: (failure instanceof Error ? failure.message : 'Admission cleanup failed').slice(0, 10000), leaseRetained: true })
      console.error('Network admission cleanup failed; its retained lease requires inspection')
    }
    finally { this.pendingSettlements.delete(authority.runId) }
  }

  private sourceDue(definition: NetworkDefinition, podId: string): number | null {
    const activation = this.store.db.prepare('SELECT id,created_at,body FROM network_trace_events WHERE network_id=? AND kind=\'network-activated\' ORDER BY id DESC LIMIT 1').get(definition.id)
    if (!activation) return null
    const last = this.store.db.prepare('SELECT i.manifest FROM network_invocations i JOIN runs r ON r.id=i.run_id WHERE i.network_id=? AND i.pod_id=? AND json_extract(i.manifest,\'$.sourceActivationId\')=? AND json_extract(i.manifest,\'$.reason\')=\'schedule\' ORDER BY r.started_at DESC,r.rowid DESC LIMIT 1').get(definition.id, podId, activation.id!)
    if (last) return (JSON.parse(last.manifest as string) as { sourceNextAt: number }).sourceNextAt
    return (JSON.parse(activation.body as string) as { sources: { podId: string, nextAt: number }[] }).sources.find(source => source.podId === podId)?.nextAt ?? null
  }

  private attention(networkId: string, kind: string, context: Record<string, unknown>, failure: unknown): void {
    const body = { ...context, message: (failure instanceof Error ? failure.message : 'Network processing failed').slice(0, 10000) }
    const previous = this.store.db.prepare('SELECT body FROM network_trace_events WHERE network_id=? AND kind=? ORDER BY id DESC LIMIT 1').get(networkId, kind)
    if (!previous || previous.body !== canonicalNetworkJson(body)) this.trace(networkId, kind, body)
  }

  private trace(networkId: string, kind: string, body: unknown): void {
    this.store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,?)').run(networkId, kind, canonicalNetworkJson(body), Date.now())
  }
}
