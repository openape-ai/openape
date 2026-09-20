import { RemotePrograms } from './programs'
import type { RemoteProgramState } from './programs'
import type { ProgramDefinition } from '../../contracts/programs'
import { createHash } from 'node:crypto'
import type { MasterView } from '../../contracts/master'
import { responseFrames } from './delivery'
import { assertFresh, object, parseCommand, parseKeys, parseOwner, parseRoute, ProtocolError, sameOwner, uuid } from '@openape/pods-protocol'
import type { CommandBody, CommandKind, DeviceKeys, Owner, Receipt, Route } from '@openape/pods-protocol'
import type { PodDatabase } from '../storage/database'
import type { MasterService } from '../master/service'
import type { RunDispatcher } from '../runs/dispatcher'
import type { ResourceRegistry } from '../resources/registry'
import type { Scheduler } from '../scheduling/scheduler'
import { ChatRegistry } from '../master/chat-registry'

export interface RemoteRegistration { id: string, generation: string, owner: Owner }
export interface RemoteDevice { id: string, owner: Owner, keys: DeviceKeys, epoch: number }
export type RemoteInternal =
  | { type: 'programs' }
  | { type: 'offerProgram', definition: ProgramDefinition }
  | { type: 'revokeProgram', id: string }
  | { type: 'configure', registration: RemoteRegistration }
  | { type: 'disable' }
  | { type: 'status' }
  | { type: 'outbox' }
  | { type: 'pair', device: RemoteDevice }
  | { type: 'unpair', id: string }
  | { type: 'ack', id: string }
  | { type: 'seal', id: string, envelope: string }
  | { type: 'execute', route: Route, body: unknown, hash: string, leaseUntil: string }
  | { type: 'provision', podId: string, identity: unknown, error: string | null }
  | { type: 'claim', podId: string, owner: Owner, identity: unknown }

export class RemoteControl {
  constructor(private readonly store: PodDatabase, private readonly master: MasterService, private readonly runs: RunDispatcher, private readonly resources: ResourceRegistry, private readonly scheduler: Scheduler, private readonly now = Date.now, private readonly programState?: RemoteProgramState) {
    store.db.prepare('UPDATE remote_inbox SET state=\'unknown\' WHERE state=\'received\'').run()
  }

  private registration(): RemoteRegistration {
    const row = this.store.db.prepare('SELECT body FROM remote_registration WHERE id=1 AND enabled=1').get()
    if (!row) throw new ProtocolError('remote_access_disabled', 403)
    return JSON.parse(row.body as string)
  }

  private ownerPod(owner: Owner, podId: string): void {
    const binding = this.store.db.prepare('SELECT owner FROM remote_pods WHERE pod_id=?').get(podId)
    if (!binding || !sameOwner(owner, JSON.parse(binding.owner as string))) throw new ProtocolError('not_found', 404)
  }

  private conversation(owner: Owner, id: string): void {
    const conversation = new ChatRegistry(this.store).get(id)
    if (!conversation.context.pods.length || conversation.context.workflow || conversation.relatedWorkflowIds.length) throw new ProtocolError('unsupported_remote_context', 403)
    for (const podId of new Set([...conversation.relatedPodIds, ...conversation.context.pods.map(pod => pod.id)])) this.ownerPod(owner, podId)
    const prior = this.store.db.prepare('SELECT owner FROM remote_conversations WHERE conversation_id=?').get(id)
    if (prior && !sameOwner(owner, JSON.parse(prior.owner as string))) throw new ProtocolError('not_found', 404)
    this.store.db.prepare('INSERT OR IGNORE INTO remote_conversations VALUES(?,?)').run(id, JSON.stringify(owner))
  }

  async execute(command: RemoteInternal): Promise<unknown> {
    if (command.type === 'status') {
      const row = this.store.db.prepare('SELECT body,enabled FROM remote_registration WHERE id=1').get()
      return { registration: row ? JSON.parse(row.body as string) : null, enabled: row?.enabled === 1, revokedDevices: this.store.db.prepare('SELECT id FROM remote_devices WHERE revoked=1').all().map(item => item.id), provisioning: this.store.db.prepare('SELECT pod_id FROM remote_pods WHERE phase=\'provisioning\'').all().map(item => item.pod_id), devices: this.store.db.prepare('SELECT id,owner,keys,epoch FROM remote_devices WHERE revoked=0').all().map(row => ({ id: row.id, owner: JSON.parse(row.owner as string), keys: JSON.parse(row.keys as string), epoch: row.epoch })) }
    }
    if (command.type === 'disable') { this.store.db.prepare('UPDATE remote_registration SET enabled=0').run(); return { enabled: false } }
    if (command.type === 'configure') {
      uuid(command.registration.id); uuid(command.registration.generation); parseOwner(command.registration.owner)
      const existing = this.store.db.prepare('SELECT body FROM remote_registration WHERE id=1').get()
      if (existing && !sameOwner(JSON.parse(existing.body as string).owner, command.registration.owner)) throw new ProtocolError('runtime_owner_conflict', 409)
      this.store.transaction(() => {
        if (existing && (JSON.parse(existing.body as string).id !== command.registration.id || JSON.parse(existing.body as string).generation !== command.registration.generation)) {
          this.store.db.prepare('DELETE FROM remote_devices').run()
          this.store.db.prepare('DELETE FROM remote_outbox').run()
          this.store.db.prepare('UPDATE remote_pods SET runtime_id=?,generation=? WHERE owner=?').run(command.registration.id, command.registration.generation, JSON.stringify(command.registration.owner))
        }
        this.store.db.prepare('INSERT INTO remote_registration VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body,enabled=1').run(JSON.stringify(command.registration))
      })
      return { enabled: true }
    }
    const registration = this.registration()
    if (command.type === 'programs') return new RemotePrograms(this.store, this.resources, this.now).list(registration.owner)
    if (command.type === 'offerProgram') return { id: new RemotePrograms(this.store, this.resources, this.now).offer(registration.owner, command.definition) }
    if (command.type === 'revokeProgram') { new RemotePrograms(this.store, this.resources, this.now).revoke(registration.owner, command.id); return { revoked: true } }
    if (command.type === 'pair') {
      uuid(command.device.id); parseKeys(command.device.keys)
      if (!sameOwner(command.device.owner, registration.owner)) throw new ProtocolError('wrong_owner', 403)
      const existing = this.store.db.prepare('SELECT keys,epoch FROM remote_devices WHERE id=?').get(command.device.id)
      if (existing && (existing.keys !== JSON.stringify(command.device.keys) || existing.epoch !== command.device.epoch)) throw new ProtocolError('device_key_changed', 409)
      this.store.db.prepare('INSERT INTO remote_devices VALUES(?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET revoked=0').run(command.device.id, JSON.stringify(command.device.owner), JSON.stringify(command.device.keys), command.device.epoch)
      return { paired: true }
    }
    if (command.type === 'unpair') {
      this.store.transaction(() => { this.store.db.prepare('UPDATE remote_devices SET revoked=1 WHERE id=?').run(command.id); this.store.db.prepare('DELETE FROM remote_outbox WHERE device_id=?').run(command.id) })
      return { revoked: true }
    }
    if (command.type === 'outbox') {
      this.store.db.prepare('DELETE FROM remote_outbox WHERE operation_id IN (SELECT id FROM remote_inbox WHERE created_at<?)').run(this.now() - 86400000)
      this.store.db.prepare('DELETE FROM remote_inbox WHERE created_at<?').run(this.now() - 2592000000)
      return this.store.db.prepare('SELECT * FROM remote_outbox WHERE acknowledged=0 ORDER BY sequence LIMIT 100').all()
    }
    if (command.type === 'ack') { this.store.db.prepare('UPDATE remote_outbox SET acknowledged=1 WHERE id=?').run(command.id); return { acknowledged: true } }
    if (command.type === 'seal') { this.store.db.prepare('UPDATE remote_outbox SET envelope=? WHERE id=? AND envelope IS NULL').run(command.envelope, command.id); return { saved: true } }
    if (command.type === 'claim') {
      if (!sameOwner(registration.owner, command.owner)) throw new ProtocolError('wrong_owner', 403)
      this.store.getPod(command.podId)
      const existing = this.store.db.prepare('SELECT owner,identity FROM remote_pods WHERE pod_id=?').get(command.podId)
      if (existing && !sameOwner(JSON.parse(existing.owner as string), command.owner)) throw new ProtocolError('pod_owner_conflict', 409)
      if (existing?.identity && existing.identity !== JSON.stringify(command.identity)) throw new ProtocolError('pod_identity_conflict', 409)
      this.store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,\'ready\',?,NULL) ON CONFLICT(pod_id) DO UPDATE SET runtime_id=excluded.runtime_id,generation=excluded.generation').run(command.podId, JSON.stringify(command.owner), registration.id, registration.generation, JSON.stringify(command.identity))
      return { claimed: true }
    }
    if (command.type === 'provision') {
      this.ownerPod(registration.owner, command.podId)
      const prior = this.store.db.prepare('SELECT identity FROM remote_pods WHERE pod_id=?').get(command.podId)!
      if (prior.identity && prior.identity !== JSON.stringify(command.identity)) throw new ProtocolError('pod_identity_conflict', 409)
      this.store.db.prepare('UPDATE remote_pods SET phase=?,identity=?,error=? WHERE pod_id=?').run(command.error ? 'needs_desktop_action' : 'ready', command.identity ? JSON.stringify(command.identity) : null, command.error, command.podId)
      return { saved: true }
    }
    return this.accept(command, registration)
  }

  private async accept(command: Extract<RemoteInternal, { type: 'execute' }>, registration: RemoteRegistration) {
    const route = parseRoute(command.route)
    const device = this.store.db.prepare('SELECT * FROM remote_devices WHERE id=? AND revoked=0').get(route.deviceId)
    if (!device || device.epoch !== route.keyEpoch || !sameOwner(JSON.parse(device.owner as string), route.owner) || !sameOwner(registration.owner, route.owner) || registration.id !== route.runtimeId || registration.generation !== route.generation) throw new ProtocolError('remote_authorization_failed', 403)
    if (!['command', 'query'].includes(route.direction)) throw new ProtocolError('invalid_direction')
    const prior = this.store.db.prepare('SELECT * FROM remote_inbox WHERE id=?').get(route.id)
    if (prior) {
      if (prior.hash !== command.hash || prior.device_id !== route.deviceId) throw new ProtocolError('operation_conflict', 409)
      if (prior.receipt) { this.enqueue(route, JSON.parse(prior.result as string)); return JSON.parse(prior.receipt as string) }
      const receipt: Receipt = { operationId: route.id, source: 'desktop', state: prior.state === 'received' ? 'received' : 'unknown', updatedAt: new Date(this.now()).toISOString(), code: 'inspect_before_retry' }
      return receipt
    }
    assertFresh(route, this.now())
    const lease = Date.parse(command.leaseUntil)
    if (!Number.isFinite(lease) || lease <= this.now() || lease > this.now() + 30000) throw new ProtocolError('dispatch_lease_expired', 409)
    this.store.db.prepare('INSERT INTO remote_inbox VALUES(?,?,?,?,\'received\',NULL,NULL,?)').run(route.id, command.hash, route.deviceId, JSON.stringify(route), this.now())
    try {
      const body = route.direction === 'command' ? parseCommand(route.kind as CommandKind, command.body) : object(command.body, ['podId', 'conversationId', 'runId', 'before', 'operationId'])
      if (body.podId) this.ownerPod(route.owner, uuid(body.podId))
      if (body.conversationId) this.conversation(route.owner, uuid(body.conversationId))
      if (route.direction === 'command' && body.podId && this.store.getPod(String(body.podId)).revision !== (body.expected as CommandBody['expected'])?.podRevision) throw new ProtocolError('revision_conflict', 409)
      if (route.direction === 'query') return this.commit(route, 'completed', this.query(route, body as Record<string, unknown>))
      if (route.kind === 'pod.create') {
        return this.store.transaction(() => {
          if (this.store.listPods().length >= 100) throw new ProtocolError('pod_limit', 409)
          const pod = this.store.createPod({ name: (body as CommandBody).name })
          this.store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,\'provisioning\',NULL,NULL)').run(pod.id, JSON.stringify(route.owner), registration.id, registration.generation)
          const conversation = new ChatRegistry(this.store).ensure(pod.id)
          this.conversation(route.owner, conversation.id)
          return this.commit(route, 'applied', { pod, conversation, setup: { phase: 'provisioning' } }, { podId: pod.id, conversationId: conversation.id })
        })
      }
      return await this.mutate(route, body as CommandBody, command.leaseUntil)
    }
    catch (error) { return this.commit(route, 'failed', { code: error instanceof ProtocolError ? error.code : 'desktop_operation_failed', message: error instanceof Error ? error.message : 'Operation failed' }) }
  }

  private query(route: Route, body: Record<string, unknown>) {
    if (route.kind === 'operation') {
      const row = this.store.db.prepare('SELECT result,receipt,state FROM remote_inbox WHERE id=? AND device_id=?').get(uuid(body.operationId), route.deviceId)
      if (!row) throw new ProtocolError('not_found', 404)
      return row.result ? JSON.parse(row.result as string) : { receipt: { operationId: body.operationId, state: row.state, source: 'desktop' } }
    }
    if (route.kind === 'inventory') return { pods: this.store.db.prepare('SELECT pod_id,phase,error FROM remote_pods WHERE owner=?').all(JSON.stringify(route.owner)).map((row) => { const pod = this.store.getPod(row.pod_id as string); return { ...pod, conversationId: new ChatRegistry(this.store).ensure(pod.id).id, resourceEpoch: this.resources.epoch(pod.id), phase: row.phase, error: row.error } }) }
    const podId = uuid(body.podId); this.ownerPod(route.owner, podId)
    if (route.kind === 'catalog') { const programs = new RemotePrograms(this.store, this.resources, this.now); return { programs: programs.list(route.owner), reviews: programs.reviews(route.owner, podId), resourceEpoch: this.resources.epoch(podId) } }
    if (route.kind === 'run') return this.runs.view(podId, body.runId ? uuid(body.runId) : undefined)
    const conversation = new ChatRegistry(this.store).get(uuid(body.conversationId)); this.conversation(route.owner, conversation.id)
    if (!conversation.context.pods.some(pod => pod.id === podId)) throw new ProtocolError('not_found', 404)
    return this.view(this.master.view(conversation.scope, undefined, body.before === undefined ? undefined : Number(body.before)))
  }

  private view(view: MasterView): unknown {
    return { ...view, activeConversationId: undefined, adoption: undefined, proposals: view.proposals?.map(proposal => ({ ...proposal, hash: createHash('sha256').update(JSON.stringify(proposal.body)).digest('hex'), variableRevision: proposal.body.provider === 'variable' ? Number(this.store.db.prepare('SELECT revision FROM pod_variables WHERE pod_id=? AND name=?').get(proposal.podId, proposal.body.alias!)?.revision ?? 0) : undefined })) }
  }

  private async mutate(route: Route, body: CommandBody, leaseUntil: string) {
    const podId = body.podId!; const expected = body.expected!
    if (route.kind === 'pod.rename' || route.kind === 'pod.pause' || route.kind === 'pod.resume') {
      return this.store.transaction(() => {
        if (route.kind === 'pod.rename') this.store.updatePod(podId, expected.podRevision!, { name: body.name!, lifecycle: this.store.getPod(podId).lifecycle })
        else this.scheduler.lifecycle(podId, expected.podRevision!, route.kind === 'pod.pause' ? 'paused' : 'active')
        return this.commit(route, 'applied', { pod: this.store.getPod(podId) })
      })
    }
    if (route.kind === 'run.start') {
      if (this.store.getPod(podId).activeScript !== expected.scriptHash || this.resources.epoch(podId) !== expected.resourceEpoch) throw new ProtocolError('revision_conflict', 409)
      if (this.store.db.prepare('SELECT phase FROM remote_pods WHERE pod_id=?').get(podId)?.phase !== 'ready') throw new ProtocolError('desktop_action_required', 409)
      let receipt!: Receipt
      this.runs.start(podId, { reason: 'manual', eventIds: [], operationId: route.id }, (runId) => { receipt = this.commit(route, 'started', { runId }, { podId, runId }) })
      return receipt
    }
    if (route.kind === 'run.cancel') { this.runs.cancel(podId, body.runId!); return this.commit(route, 'applied', { cancellationRequested: true }, { podId, runId: body.runId }) }
    if (route.kind === 'review.prepare') {
      if (this.resources.epoch(podId) !== expected.resourceEpoch) throw new ProtocolError('revision_conflict', 409)
      return this.commit(route, 'applied', { review: new RemotePrograms(this.store, this.resources, this.now).prepare(route.owner, podId, body.catalogId!) })
    }
    if (route.kind === 'review.decide') {
      if (!this.programState) throw new ProtocolError('desktop_action_required', 409)
      return new RemotePrograms(this.store, this.resources, this.now).decide(route.owner, podId, body.reviewId!, expected.reviewRevision!, expected.resourceEpoch!, body.decision!, this.programState, () => {
        const active = this.registration()
        if (active.id !== route.runtimeId || active.generation !== route.generation || !this.store.db.prepare('SELECT 1 FROM remote_devices WHERE id=? AND epoch=? AND revoked=0').get(route.deviceId, route.keyEpoch)) throw new ProtocolError('remote_authorization_failed', 403)
        assertFresh(route, this.now())
        if (Date.parse(leaseUntil) <= this.now()) throw new ProtocolError('dispatch_lease_expired', 409)
      }, result => this.commit(route, 'applied', result))
    }
    const base = { conversationId: body.conversationId!, contextRevision: expected.contextRevision! }
    let result: unknown
    if (route.kind === 'chat.send') {
      result = await this.master.execute({ ...base, type: 'send', id: route.id, podId, text: body.text! })
    }
    else if (route.kind === 'chat.cancel') {
      result = await this.master.execute({ ...base, type: 'cancel', podId })
    }
    else if (route.kind === 'setup.respond') {
      const proposal = this.store.db.prepare('SELECT body FROM access_proposals WHERE id=? AND pod_id=? AND state=\'pending\'').get(body.reviewId!, podId)
      if (!proposal || createHash('sha256').update(String(proposal.body)).digest('hex') !== expected.proposalHash) throw new ProtocolError('revision_conflict', 409)
      result = await this.master.execute({ ...base, type: 'answerSetup', id: body.reviewId!, podId, value: body.text!, revision: expected.variableRevision! })
    }
    else if (route.kind === 'changes.apply' || route.kind === 'changes.discard') {
      const conversation = new ChatRegistry(this.store).get(body.conversationId!)
      const review = this.master.view(conversation.scope).changes?.find(item => item.id === body.reviewId)
      if (!review || review.workflow || review.targets.some(target => target.actions.some(action => action.action === 'setGroup'))) throw new ProtocolError('desktop_action_required', 409)
      for (const target of review.targets) {
        this.ownerPod(route.owner, target.podId)
        if (route.kind === 'changes.apply' && review.kind === 'run' && this.store.db.prepare('SELECT phase FROM remote_pods WHERE pod_id=?').get(target.podId)?.phase !== 'ready') throw new ProtocolError('desktop_action_required', 409)
      }
      result = await this.master.execute({ ...base, type: route.kind === 'changes.apply' ? 'applyChanges' : 'discardChanges', id: body.reviewId!, revision: expected.reviewRevision! })
    }
    else {
      throw new ProtocolError('unsupported_operation', 426)
    }
    return this.commit(route, 'applied', this.view(result as MasterView))
  }

  private commit(route: Route, state: Receipt['state'], data: unknown, ids: Partial<Receipt> = {}) {
    return this.store.transaction(() => {
      const receipt: Receipt = { operationId: route.id, state, source: 'desktop', updatedAt: new Date(this.now()).toISOString(), ...ids }
      const result = { receipt, data }
      this.store.db.prepare('UPDATE remote_inbox SET state=?,receipt=?,result=? WHERE id=?').run(state, JSON.stringify(receipt), JSON.stringify(result), route.id)
      this.enqueue(route, result)
      return receipt
    })
  }

  private enqueue(route: Route, body: { receipt: unknown, data: unknown }): void {
    const existing = this.store.db.prepare('SELECT id FROM remote_outbox WHERE id=?').get(route.id)
    if (existing) return
    const now = this.now()
    const response: Route = { ...route, direction: 'response', kind: 'receipt', issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() }
    for (const frame of responseFrames(response, body)) this.store.db.prepare('INSERT INTO remote_outbox(id,operation_id,device_id,route,body) VALUES(?,?,?,?,?)').run(frame.route.id, route.id, route.deviceId, JSON.stringify(frame.route), JSON.stringify(frame.body))
  }
}
