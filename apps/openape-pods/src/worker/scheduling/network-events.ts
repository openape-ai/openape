import type { NetworkArtifacts } from './network-artifacts'
import { artifactReferences } from '../../contracts/network-data'
import type { ArtifactReference } from '../../contracts/network-data'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { assertNetworkQuota } from './network-quota'
import { randomUUID } from 'node:crypto'
import { parseNetworkDefinition } from '../../contracts/networks'
import type { NetworkChannel, NetworkDefinition, NetworkFeedback, NetworkMember } from '../../contracts/networks'
import { networkDataObject, validateNetworkPayload } from '../../contracts/network-payload'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import { NetworkJoins } from './network-joins'

export interface NetworkEmission {
  channel: string
  key: string
  payload: unknown
  artifacts?: ArtifactReference[]
  sourceItemId?: string
  sourceVersion?: string
}
export interface NetworkEventReceipt { eventId: string, duplicate: boolean, caseId: string | null, caseRevision: number | null }
export interface FeedbackPlan { transition: NetworkFeedback | null, transitionId: string | null, hop: number }
export interface NetworkAuthority { runId: string, claimToken: string }

export class NetworkEventConflict extends Error {
  constructor(readonly detail: { identityHash: string, namespace: string, eventId: string, previousPayloadHash: string, payloadHash: string, previousSchemaHash: string, schemaHash: string }) {
    super('Network event identity conflicts with its retained receipt; owner review is required')
  }
}

export { canonicalNetworkJson } from '../../contracts/network-json'

function identifier(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || !value || value.length > 200 || /[\u0000-\u001F\u007F]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid network event key or source version')
  return value
}

export class NetworkEvents {
  artifacts?: NetworkArtifacts
  readonly joins: NetworkJoins

  references(eventId: string): ArtifactReference[] {
    return this.store.db.prepare('SELECT a.id,a.scope_id AS scope FROM artifact_references r JOIN artifacts a ON a.id=r.artifact_id WHERE r.reference_kind=\'event\' AND r.reference_id=? ORDER BY a.id').all(eventId) as unknown as ArtifactReference[]
  }

  constructor(private readonly store: PodDatabase, private readonly bootNonce: string) { this.joins = new NetworkJoins(store) }

  emission(authority: NetworkAuthority, value: unknown, finishing = false): NetworkEmission {
    const { definition, member } = this.authority(authority, finishing)
    const input = networkDataObject(value)
    if (Object.keys(input).some(key => !['channel', 'key', 'payload', 'artifacts', 'sourceItemId', 'sourceVersion'].includes(key))) throw new Error('Unsupported network emission fields')
    const channel = definition.channels.find(item => item.name === input.channel)
    if (!channel || !member.contract.gives.includes(channel.name)) throw new Error('Network output channel is not declared')
    const result: NetworkEmission = { channel: channel.name, key: identifier(input.key), payload: validateNetworkPayload(input.payload, channel.schema) }
    if (input.artifacts !== undefined) {
      result.artifacts = artifactReferences(input.artifacts)
      for (const reference of result.artifacts) {
        if (!Object.values(result.payload as Record<string, unknown>).flat().includes(reference.id)) throw new Error('Event artifact references must be included in the hashed payload')
        if (!this.artifacts) throw new Error('Managed artifact authority is unavailable')
        this.artifacts.reference(authority, reference, finishing)
      }
    }
    if (member.source) return { ...result, sourceItemId: identifier(input.sourceItemId), sourceVersion: identifier(input.sourceVersion) }
    if (input.sourceItemId !== undefined || input.sourceVersion !== undefined) throw new Error('A consumer cannot declare source identity')
    return result
  }

  authority(authority: NetworkAuthority, finishing = false) {
    const row = this.store.db.prepare(`SELECT i.*,r.assignment_revision,n.owner_issuer,n.owner_subject,n.group_id,n.state AS network_state
      FROM network_invocations i JOIN networks n ON n.id=i.network_id
      JOIN run_leases l ON l.run_id=i.run_id AND l.pod_id=i.pod_id
      JOIN runs r ON r.id=i.run_id AND r.pod_id=i.pod_id
      WHERE i.run_id=? AND i.claim_token=? AND i.boot_nonce=? AND l.boot_id=?
        AND (i.state='running' OR (i.state='stopping' AND ?=1)) AND r.state='running' AND n.state!='archived'
        AND n.restore_nonce=i.restore_nonce AND n.activation_epoch=i.activation_epoch
        AND n.baseline_state='ready'`).get(authority.runId, authority.claimToken, this.bootNonce, this.bootNonce, finishing ? 1 : 0)
    if (!row) throw new Error('Network invocation authority is no longer current')
    const deadline = this.store.db.prepare('SELECT deadline FROM network_invocation_controls WHERE run_id=?').get(authority.runId)?.deadline
    if (!finishing && deadline !== null && deadline !== undefined && Number(deadline) <= Date.now()) throw new Error('Network invocation deadline expired')
    const revision = this.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=? AND revision=?').get(row.network_id!, row.network_revision!)!
    const definition = parseNetworkDefinition(JSON.parse(revision.contract as string))
    const member = definition.members.find(item => item.podId === row.pod_id)
    if (!member) throw new Error('Network invocation has no pinned member')
    if (definition.id !== row.network_id || definition.revision !== row.network_revision || definition.groupId !== row.group_id) throw new Error('Network invocation revision does not match its stored scope')
    const binding = this.store.db.prepare(`SELECT m.*,b.definition_id AS current_definition,b.definition_version AS current_version,b.binding_revision AS current_binding
      FROM network_members m JOIN instance_definition_bindings b ON b.pod_id=m.pod_id
      WHERE m.network_id=? AND m.pod_id=?`).get(definition.id, member.podId)
    if (!binding || binding.definition_id !== member.definitionId || binding.definition_version !== member.definitionVersion || binding.binding_revision !== member.bindingRevision || binding.source_binding_id !== (member.source?.bindingId ?? null) || binding.current_definition !== member.definitionId || binding.current_version !== member.definitionVersion || binding.current_binding !== member.bindingRevision) throw new Error('Network member binding changed during execution')
    const claimed = this.store.db.prepare('SELECT id,generation,claim_token,boot_nonce,restore_nonce,activation_epoch FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(authority.runId)
    const manifest = JSON.parse(row.manifest as string) as { assignmentRevision: number, resourceEpoch: number, inputClaims?: { id: string, generation: number }[] }
    if (manifest.assignmentRevision !== row.assignment_revision || this.store.getPod(member.podId).bindingRevision !== manifest.assignmentRevision) throw new Error('Network resource assignment changed during execution')
    const resourceEpoch = this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(member.podId)?.epoch ?? 0
    if (manifest.resourceEpoch !== resourceEpoch) throw new Error('Network resource epoch changed during execution')
    const expected = manifest.inputClaims ?? []
    if (claimed.length !== expected.length || claimed.some(input => input.claim_token !== row.claim_token || input.boot_nonce !== row.boot_nonce || input.restore_nonce !== row.restore_nonce || input.activation_epoch !== row.activation_epoch || !expected.some(pin => pin.id === input.id && pin.generation === input.generation))) throw new Error('Network input claim changed during execution')
    if (member.source && claimed.length) throw new Error('Network source cannot consume deliveries')
    return { row, definition, member }
  }

  accept(authority: NetworkAuthority, emission: NetworkEmission, finishing = false): NetworkEventReceipt {
    return this.store.transaction(() => {
      emission = this.emission(authority, emission, finishing)
      const { row, definition, member } = this.authority(authority, finishing)
      if (!member.contract.gives.includes(emission.channel)) throw new Error('Network output channel is not declared')
      const channel = definition.channels.find(item => item.name === emission.channel)
      if (!channel) throw new Error('Network output channel has no pinned schema')
      const payload = canonicalNetworkJson(validateNetworkPayload(emission.payload, channel.schema))
      const references = artifactReferences(emission.artifacts ?? [])
      for (const reference of references) {
        if (!Object.values(JSON.parse(payload)).flat().includes(reference.id)) throw new Error('Event artifact references must be included in the hashed payload')
        if (!this.artifacts) throw new Error('Managed artifact authority is unavailable')
        this.artifacts.reference(authority, reference, finishing)
      }
      const payloadHash = digest(payload)
      const schemaHash = digest(canonicalNetworkJson({ schemaVersion: channel.schemaVersion, schema: channel.schema }))
      const key = identifier(emission.key)
      const causal = member.source ? [] : this.inputs(authority)
      if (!member.source && (emission.sourceItemId !== undefined || emission.sourceVersion !== undefined)) throw new Error('A consumer cannot declare source identity')
      const sourceItem = member.source ? identifier(emission.sourceItemId) : null
      const sourceVersion = member.source ? identifier(emission.sourceVersion) : null
      const namespace = member.source ? 'source' : 'derived'
      const inputIds = causal.map(input => input.eventId).sort()
      const plan = member.source ? null : this.feedbackPlan(definition, member.podId, channel.name, inputIds, key, this.inputHop(inputIds))
      const identity = member.source
        ? [{ issuer: row.owner_issuer, subject: row.owner_subject }, definition.id, member.source.bindingId, sourceItem, sourceVersion, channel.name]
        : [definition.id, member.podId, inputIds, channel.name, key, plan?.transitionId ?? 'no-feedback-transition']
      const identityHash = digest(canonicalNetworkJson(identity))
      const previous = this.store.db.prepare('SELECT * FROM network_event_identities WHERE network_id=? AND namespace=? AND identity_hash=?').get(definition.id, namespace, identityHash)
      if (previous) {
        if (previous.payload_hash !== payloadHash || previous.schema_hash !== schemaHash) throw new NetworkEventConflict({ identityHash, namespace, eventId: previous.event_id as string, previousPayloadHash: previous.payload_hash as string, payloadHash, previousSchemaHash: previous.schema_hash as string, schemaHash })
        const event = this.store.db.prepare('SELECT case_id,case_revision FROM network_events WHERE id=? AND network_id=?').get(previous.event_id!, definition.id)
        return { eventId: previous.event_id as string, duplicate: true, caseId: event?.case_id as string ?? null, caseRevision: event?.case_revision as number ?? null }
      }
      const fanout = Number(this.store.db.prepare('SELECT count(*) AS count FROM network_subscriptions WHERE network_id=? AND network_revision=? AND channel=?').get(definition.id, definition.revision, channel.name)!.count)
      assertNetworkQuota(this.store, Buffer.byteLength(payload) * 3 + fanout * 2048 + 8192)
      const now = Date.now()
      const caseRef = member.source
        ? this.sourceCase(definition.id, row.group_id as string, member, sourceItem!, sourceVersion!, now)
        : this.derivedCase(causal)
      const eventId = randomUUID()
      const origin = member.source
        ? { kind: 'source', sourceBindingId: member.source.bindingId, sourceItemId: sourceItem, sourceVersion }
        : { kind: 'derived', inputEventIds: inputIds, producerPodId: member.podId, emitKey: key, feedbackTransitionId: plan!.transitionId }
      this.store.db.prepare('INSERT INTO network_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eventId, definition.id, definition.revision, member.podId, member.definitionId, member.definitionVersion, caseRef.caseId, caseRef.caseRevision, channel.name, key, canonicalNetworkJson({ ...origin, invocationId: authority.runId, schemaVersion: channel.schemaVersion, occurredAt: now, feedbackHop: plan?.hop ?? 0 }), schemaHash, payload, payloadHash, now)
      this.store.db.prepare('INSERT INTO network_event_identities VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(definition.id, namespace, identityHash, eventId, payloadHash, schemaHash, now, now + 90 * 86400000, canonicalNetworkJson(inputIds))
      for (const reference of references) this.artifacts!.retain(reference, 'event', eventId)
      this.deliver(definition, eventId, channel, schemaHash, caseRef, now, plan, authority.runId)
      return { eventId, duplicate: false, ...caseRef }
    })
  }

  // The highest hop among the consumed input events; ordinary derived events carry it unchanged.
  inputHop(inputIds: string[]): number {
    if (!inputIds.length) return 0
    return Number(this.store.db.prepare(`SELECT coalesce(max(json_extract(origin,'$.feedbackHop')),0) AS hop FROM network_events WHERE id IN (SELECT value FROM json_each(?))`).get(JSON.stringify(inputIds))!.hop)
  }

  // Workflow results have no claimed inputs; they inherit the highest hop their case has reached so a call inside a loop cannot reset the count.
  caseHop(networkId: string, caseId: string, caseRevision: number): number {
    return Number(this.store.db.prepare(`SELECT coalesce(max(json_extract(origin,'$.feedbackHop')),0) AS hop FROM network_events WHERE network_id=? AND case_id=? AND case_revision=?`).get(networkId, caseId, caseRevision)!.hop)
  }

  // The runtime, not the script, decides whether an emission is a declared feedback transition, how it is identified and how many hops it has.
  feedbackPlan(definition: NetworkDefinition, podId: string, channel: string, inputIds: string[], key: string, inputHop: number): FeedbackPlan {
    const transition = definition.feedback?.find(item => item.podId === podId && item.channel === channel) ?? null
    const transitionId = transition ? digest(canonicalNetworkJson([transition.id, inputIds])) : null
    if (transitionId) {
      // One transition per declaration and input set: a second emission with another key is refused instead of scheduled again.
      const scheduled = this.store.db.prepare('SELECT item_key FROM network_events WHERE network_id=? AND json_extract(origin,\'$.feedbackTransitionId\')=?').get(definition.id, transitionId)
      if (scheduled && scheduled.item_key !== key) throw new Error('Feedback transition is already scheduled for these inputs')
    }
    return { transition, transitionId, hop: transition ? inputHop + 1 : inputHop }
  }

  // Writes the deliveries of a stored event: a transition waits for its delay, and one beyond its hop or case-age bound is held for owner review.
  deliver(definition: NetworkDefinition, eventId: string, channel: NetworkChannel, schemaHash: string, caseRef: { caseId: string, caseRevision: number }, now: number, plan: FeedbackPlan | null, runId: string | null): void {
    const transition = plan?.transition ?? null
    let review: string | null = null
    if (transition && plan) {
      const revision = this.store.db.prepare('SELECT created_at FROM network_case_revisions WHERE case_id=? AND revision=?').get(caseRef.caseId, caseRef.caseRevision)!
      const age = now - Number(revision.created_at)
      review = plan.hop > transition.maxHops ? `Feedback exceeded ${transition.maxHops} hops` : age + transition.delayMs > transition.maxCaseAgeMs ? `Feedback case is older than ${transition.maxCaseAgeMs} ms` : null
    }
    const subscriptions = this.store.db.prepare('SELECT id,schema_hash FROM network_subscriptions WHERE network_id=? AND network_revision=? AND channel=? ORDER BY id').all(definition.id, definition.revision, channel.name)
    for (const subscription of subscriptions) {
      if (subscription.schema_hash !== schemaHash) throw new Error('Network subscription schema differs from its pinned channel')
      this.store.db.prepare('INSERT INTO network_deliveries(id,network_id,event_id,subscription_id,case_id,case_revision,state,reason,ready_at,accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), definition.id, eventId, subscription.id!, caseRef.caseId, caseRef.caseRevision, review ? 'blocked' : 'pending', review, now + (transition?.delayMs ?? 0), now)
    }
    if (subscriptions.length) this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,?,?) ON CONFLICT(network_id,state) DO UPDATE SET count=count+excluded.count').run(definition.id, review ? 'blocked' : 'pending', subscriptions.length)
    const feedbackTrace = transition && plan ? { feedback: transition.id, hop: plan.hop, delayMs: transition.delayMs } : {}
    this.store.db.prepare('INSERT INTO network_trace_events(network_id,case_id,run_id,event_id,kind,body,created_at) VALUES(?,?,?,?,?,?,?)').run(definition.id, caseRef.caseId, runId, review ? eventId : null, review ? 'feedback-review' : 'event-accepted', canonicalNetworkJson({ channel: channel.name, caseRevision: caseRef.caseRevision, ...feedbackTrace, ...(review ? { reason: review, eventId } : {}) }), now)
    if (!review) this.joins.record(eventId)
  }

  // The owner resolves feedback held at its bounds by discarding the held deliveries with retained evidence; the event and its trace stay.
  discardHeldFeedback(networkId: string, eventId: string, evidence: string): void {
    this.store.transaction(() => {
      const held = this.store.db.prepare('SELECT id FROM network_deliveries WHERE network_id=? AND event_id=? AND state=\'blocked\' AND run_id IS NULL AND reason LIKE \'Feedback %\'').all(networkId, eventId)
      // A resent command with the same evidence already applied is answered with the retained outcome.
      if (!held.length && this.store.db.prepare('SELECT 1 FROM network_trace_events WHERE network_id=? AND event_id=? AND kind=\'feedback-review-resolved\' AND json_extract(body,\'$.reason\')=?').get(networkId, eventId, evidence.slice(0, 4000))) return
      if (!held.length) throw new Error('No held feedback delivery to discard')
      const event = this.store.db.prepare('SELECT case_id FROM network_events WHERE id=? AND network_id=?').get(eventId, networkId)!
      const receipt = canonicalNetworkJson({ eventId, evidence, reviewedAt: Date.now() })
      for (const row of held) {
        this.store.db.prepare('UPDATE network_deliveries SET state=\'discarded\',generation=generation+1,review_receipt=?,reason=? WHERE id=?').run(receipt, 'Held feedback discarded by owner with retained evidence', row.id!)
        const changed = this.store.db.prepare('UPDATE network_queue_counts SET count=count-1 WHERE network_id=? AND state=\'blocked\' AND count>0').run(networkId)
        if (changed.changes !== 1) throw new Error('Network queue projection is inconsistent')
      }
      this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,\'discarded\',?) ON CONFLICT(network_id,state) DO UPDATE SET count=count+excluded.count').run(networkId, held.length)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,case_id,run_id,event_id,kind,body,created_at) VALUES(?,?,NULL,?,?,?,?)').run(networkId, event.case_id!, eventId, 'feedback-review-resolved', canonicalNetworkJson({ eventId, reason: evidence.slice(0, 4000) }), Date.now())
    })
  }

  private inputs(authority: NetworkAuthority) {
    const stale = this.store.db.prepare(`SELECT 1 FROM network_deliveries d JOIN network_invocations i ON i.run_id=d.run_id
      WHERE d.run_id=? AND d.state='claimed' AND (d.claim_token!=i.claim_token OR d.boot_nonce!=i.boot_nonce OR d.restore_nonce!=i.restore_nonce OR d.activation_epoch!=i.activation_epoch) LIMIT 1`).get(authority.runId)
    if (stale) throw new Error('Network consumer input authority is no longer current')
    const inputs = this.store.db.prepare('SELECT DISTINCT event_id,case_id,case_revision FROM network_deliveries WHERE run_id=? AND state=\'claimed\' ORDER BY event_id').all(authority.runId)
    if (!inputs.length) throw new Error('Network consumer requires claimed inputs')
    return inputs.map(input => ({ eventId: input.event_id as string, caseId: input.case_id as string, caseRevision: input.case_revision as number }))
  }

  private derivedCase(inputs: { caseId: string, caseRevision: number }[]) {
    const first = inputs[0]!
    if (inputs.some(input => input.caseId !== first.caseId || input.caseRevision !== first.caseRevision)) throw new Error('Network emission cannot combine unrelated cases')
    return { caseId: first.caseId, caseRevision: first.caseRevision }
  }

  private sourceCase(networkId: string, groupId: string, member: NetworkMember, item: string, version: string, now: number) {
    const binding = member.source!.bindingId
    const previous = this.store.db.prepare('SELECT case_id,case_revision FROM network_case_sources WHERE network_id=? AND source_binding_id=? AND source_item=? AND source_version=?').get(networkId, binding, item, version)
    if (previous) return { caseId: previous.case_id as string, caseRevision: previous.case_revision as number }
    const current = this.store.db.prepare('SELECT s.case_id,c.current_revision FROM network_case_sources s JOIN network_cases c ON c.id=s.case_id WHERE s.network_id=? AND s.source_binding_id=? AND s.source_item=? LIMIT 1').get(networkId, binding, item)
    const caseId = current?.case_id as string ?? randomUUID()
    const caseRevision = current ? (current.current_revision as number) + 1 : 1
    if (!current) this.store.db.prepare('INSERT INTO network_cases VALUES(?,?,?,1,NULL,NULL,?)').run(caseId, networkId, groupId, now)
    const mapping = canonicalNetworkJson({ sourceBindingId: binding, sourceItemId: item, sourceVersion: version })
    this.store.db.prepare('INSERT INTO network_case_revisions VALUES(?,?,?,?, \'open\',?)').run(caseId, caseRevision, mapping, current ? current.current_revision! : null, now)
    this.store.db.prepare('UPDATE network_cases SET current_revision=? WHERE id=? AND network_id=?').run(caseRevision, caseId, networkId)
    this.store.db.prepare('INSERT INTO network_case_sources VALUES(?,?,?,?,?,?)').run(networkId, binding, item, version, caseId, caseRevision)
    return { caseId, caseRevision }
  }
}
