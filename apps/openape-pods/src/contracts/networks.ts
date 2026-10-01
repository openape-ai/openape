import { parseGraphChannels, parseGraphContract } from './graphs'
import type { GraphContract } from './graphs'
import { networkDataObject, parsePayloadSchema } from './network-payload'
import type { PayloadSchema } from './network-payload'
import { parseSchedule } from './scheduling'
import type { ScheduleSpec } from './scheduling'

export interface NetworkChannel { name: string, title: string, schemaVersion: number, schema: PayloadSchema }
export interface NetworkMember {
  podId: string
  definitionId: string
  definitionVersion: number
  bindingRevision: number
  contract: GraphContract
  source: { bindingId: string, schedule: ScheduleSpec | null } | null
  serialCase: boolean
}
export interface NetworkDefinition {
  formatVersion: 1
  kind: 'network'
  semantics: 'persistent-network-v1'
  id: string
  revision: number
  groupId: string
  name: string
  channels: NetworkChannel[]
  members: NetworkMember[]
}
export interface NetworkDiagnostic { code: 'channel-undeclared' | 'channel-without-producer' | 'channel-without-consumer' | 'cycle', podId: string | null, channel: string | null }
export interface NetworkSelection { podId: string, source: { schedule: ScheduleSpec | null } | null, serialCase: boolean }
export interface NetworkDraft { name: string, groupId: string, channels: NetworkChannel[], members: NetworkSelection[] }
export type NetworkCommand
  = | { type: 'list' }
    | { type: 'create', draft: NetworkDraft }
    | { type: 'activate', id: string, revision: number }
    | { type: 'pause', id: string, revision: number }
    | { type: 'preview', id: string, revision: number, podIds: string[], pausedPodIds: string[], budget: number }
    | { type: 'inspect', id: string, revision: number, runId: string, generation: number }
    | { type: 'discardFailure', id: string, revision: number, runId: string, generation: number, evidence: string }
    | { type: 'retry', id: string, revision: number, runId: string, generation: number }
    | { type: 'resolveConflict', id: string, revision: number, runId: string, generation: number, identityHash: string, decision: 'retainOriginal' | 'discardBatch', evidence: string }
    | { type: 'reconcileEffect', id: string, revision: number, runId: string, generation: number, key: string, attempt: number, sequence: number, outcome: 'confirmed_applied' | 'confirmed_not_applied', evidence: string }
    | { type: 'process', id: string, revision: number, previewId: string }
export interface NetworkHealth { oldestPendingAt: number | null, nextRetryAt: number | null, lastDispatchAt: number | null, lastSchedulerProgressAt: number | null, lastSchedulerError: string | null, intakeError: string | null, lastFailure: { runId: string, generation: number, kind: string, reason: string } | null }
export interface NetworkSummary { id: string, revision: number, groupId: string, name: string, state: 'active' | 'paused' | 'archived', counts: Record<string, number>, health: NetworkHealth }
export interface NetworkPreview { id: string, networkId: string, revision: number, podIds: string[], pausedPodIds: string[], budget: number, expiresAt: number, sources: string[], consumers: string[] }
export interface NetworkView { networks: NetworkSummary[], preview?: NetworkPreview, processId?: string, createdId?: string }
export const networkLimits = { networks: 64, members: 64, channels: 32, batch: 50, processNow: 100, definitionBytes: 1024 * 1024 } as const

function fields(value: unknown, names: string[]): Record<string, unknown> {
  const result = networkDataObject(value)
  if (Object.keys(result).some(key => !names.includes(key)) || names.some(key => !Object.hasOwn(result, key))) throw new Error('Invalid network definition fields')
  return result
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new Error('Invalid network identifier')
  return value
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('Invalid network revision')
  return value as number
}

function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Network definition exceeds its list limit')
  return value
}

function unique(values: string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Network definition identifiers must be unique')
}

function member(value: unknown): NetworkMember {
  const input = fields(value, ['podId', 'definitionId', 'definitionVersion', 'bindingRevision', 'contract', 'source', 'serialCase'])
  const contract = parseGraphContract(input.contract)
  let source: NetworkMember['source'] = null
  if (input.source !== null) {
    const spec = fields(input.source, ['bindingId', 'schedule'])
    source = { bindingId: uuid(spec.bindingId), schedule: spec.schedule === null ? null : parseSchedule(spec.schedule) }
  }
  if (typeof input.serialCase !== 'boolean' || (source === null && !contract.takes.length) || (source !== null && contract.takes.length)) throw new Error('Network member must be a source or a subscribed consumer')
  return { podId: uuid(input.podId), definitionId: uuid(input.definitionId), definitionVersion: revision(input.definitionVersion), bindingRevision: revision(input.bindingRevision), contract, source, serialCase: input.serialCase }
}

function channels(value: unknown): NetworkChannel[] {
  const result = list(value, networkLimits.channels).map((value) => {
    const item = fields(value, ['name', 'title', 'schemaVersion', 'schema'])
    const channel = parseGraphChannels([{ name: item.name, title: item.title, fields: [] }])[0]!
    return { name: channel.name, title: channel.title, schemaVersion: revision(item.schemaVersion), schema: parsePayloadSchema(item.schema) }
  })
  unique(result.map(channel => channel.name))
  return result
}

export function parseNetworkDefinition(value: unknown): NetworkDefinition {
  const input = fields(value, ['formatVersion', 'kind', 'semantics', 'id', 'revision', 'groupId', 'name', 'channels', 'members'])
  if (input.formatVersion !== 1 || input.kind !== 'network' || input.semantics !== 'persistent-network-v1' || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || input.name.includes('\0')) throw new Error('Invalid network definition version or name')
  const parsedChannels = channels(input.channels)
  const members = list(input.members, networkLimits.members).map(member)
  if (!members.length) throw new Error('Network requires at least one member')
  unique(members.map(item => item.podId))
  unique(members.flatMap(item => item.source ? [item.source.bindingId] : []))
  const result: NetworkDefinition = { formatVersion: 1, kind: 'network', semantics: 'persistent-network-v1', id: uuid(input.id), revision: revision(input.revision), groupId: uuid(input.groupId), name: input.name, channels: parsedChannels, members }
  if (new TextEncoder().encode(JSON.stringify(result)).length > networkLimits.definitionBytes) throw new Error('Network definition exceeds its size limit')
  return result
}

export function parseNetworkCommand(value: unknown): NetworkCommand {
  const input = networkDataObject(value)
  if (input.type === 'list') { fields(input, ['type']); return { type: 'list' } }
  if (input.type === 'create') {
    fields(input, ['type', 'draft'])
    const draft = fields(input.draft, ['name', 'groupId', 'channels', 'members'])
    const members = list(draft.members, networkLimits.members).map((value) => {
      const item = fields(value, ['podId', 'source', 'serialCase'])
      if (typeof item.serialCase !== 'boolean') throw new Error('Invalid network case serialization policy')
      const source = item.source === null ? null : fields(item.source, ['schedule'])
      return { podId: uuid(item.podId), serialCase: item.serialCase, source: source ? { schedule: source.schedule === null ? null : parseSchedule(source.schedule) } : null }
    })
    if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 120 || draft.name.includes('\0') || !members.length) throw new Error('Invalid network draft name or members')
    unique(members.map(item => item.podId))
    return { type: 'create', draft: { name: draft.name, groupId: uuid(draft.groupId), channels: channels(draft.channels), members } }
  }
  if (input.type === 'activate' || input.type === 'pause') { fields(input, ['type', 'id', 'revision']); return { type: input.type, id: uuid(input.id), revision: revision(input.revision) } }
  if (input.type === 'inspect' || input.type === 'retry') { fields(input, ['type', 'id', 'revision', 'runId', 'generation']); return { type: input.type, id: uuid(input.id), revision: revision(input.revision), runId: uuid(input.runId), generation: revision(input.generation) } }
  if (input.type === 'discardFailure') {
    fields(input, ['type', 'id', 'revision', 'runId', 'generation', 'evidence'])
    if (typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 4000) throw new Error('Discarding failed work requires explicit owner evidence')
    return { type: 'discardFailure', id: uuid(input.id), revision: revision(input.revision), runId: uuid(input.runId), generation: revision(input.generation), evidence: input.evidence }
  }
  if (input.type === 'resolveConflict') {
    fields(input, ['type', 'id', 'revision', 'runId', 'generation', 'identityHash', 'decision', 'evidence'])
    if (typeof input.identityHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.identityHash) || !['retainOriginal', 'discardBatch'].includes(input.decision as string) || typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 4000) throw new Error('Conflict resolution requires explicit owner evidence and a declared batch decision')
    return { type: 'resolveConflict', id: uuid(input.id), revision: revision(input.revision), runId: uuid(input.runId), generation: revision(input.generation), identityHash: input.identityHash, decision: input.decision as 'retainOriginal' | 'discardBatch', evidence: input.evidence }
  }
  if (input.type === 'reconcileEffect') {
    fields(input, ['type', 'id', 'revision', 'runId', 'generation', 'key', 'attempt', 'sequence', 'outcome', 'evidence'])
    if (typeof input.key !== 'string' || !/^[a-f0-9]{64}$/.test(input.key) || !['confirmed_applied', 'confirmed_not_applied'].includes(input.outcome as string) || typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 4000) throw new Error('Network effect reconciliation requires explicit owner evidence')
    return { type: 'reconcileEffect', id: uuid(input.id), revision: revision(input.revision), runId: uuid(input.runId), generation: revision(input.generation), key: input.key, attempt: revision(input.attempt), sequence: revision(input.sequence), outcome: input.outcome as 'confirmed_applied' | 'confirmed_not_applied', evidence: input.evidence }
  }
  if (input.type === 'process') { fields(input, ['type', 'id', 'revision', 'previewId']); return { type: 'process', id: uuid(input.id), revision: revision(input.revision), previewId: uuid(input.previewId) } }
  if (input.type === 'preview') {
    fields(input, ['type', 'id', 'revision', 'podIds', 'pausedPodIds', 'budget'])
    const podIds = list(input.podIds, networkLimits.members).map(uuid); unique(podIds)
    const pausedPodIds = list(input.pausedPodIds, networkLimits.members).map(uuid); unique(pausedPodIds)
    if (!podIds.length || pausedPodIds.some(id => !podIds.includes(id)) || !Number.isSafeInteger(input.budget) || (input.budget as number) < 1 || (input.budget as number) > networkLimits.processNow) throw new Error('Invalid bounded network processing selection')
    return { type: 'preview', id: uuid(input.id), revision: revision(input.revision), podIds, pausedPodIds, budget: input.budget as number }
  }
  throw new Error('Unsupported network command')
}

export function parseNetworkView(value: unknown): NetworkView {
  const input = networkDataObject(value)
  if (Object.keys(input).some(key => !['networks', 'preview', 'processId', 'createdId'].includes(key))) throw new Error('Invalid network view fields')
  const networks = list(input.networks, networkLimits.networks).map((value) => {
    const item = fields(value, ['id', 'revision', 'groupId', 'name', 'state', 'counts', 'health'])
    if (typeof item.name !== 'string' || item.name.length > 120 || !['active', 'paused', 'archived'].includes(item.state as string)) throw new Error('Invalid network summary')
    const counts = networkDataObject(item.counts)
    if (Object.entries(counts).some(([state, count]) => !['pending', 'claimed', 'done', 'retry_wait', 'blocked', 'unknown', 'discarded'].includes(state) || !Number.isSafeInteger(count) || (count as number) < 0)) throw new Error('Invalid network queue summary')
    const health = fields(item.health, ['oldestPendingAt', 'nextRetryAt', 'lastDispatchAt', 'lastSchedulerProgressAt', 'lastSchedulerError', 'intakeError', 'lastFailure'])
    for (const key of ['oldestPendingAt', 'nextRetryAt', 'lastDispatchAt', 'lastSchedulerProgressAt']) {
      if (health[key] !== null && (!Number.isSafeInteger(health[key]) || Number(health[key]) < 0)) throw new Error('Invalid network health timestamp')
    }
    if (health.lastSchedulerError !== null && (typeof health.lastSchedulerError !== 'string' || health.lastSchedulerError.length > 10000)) throw new Error('Invalid network scheduler diagnostic')
    if (health.intakeError !== null && (typeof health.intakeError !== 'string' || health.intakeError.length > 10000)) throw new Error('Invalid network intake diagnostic')
    if (health.lastFailure !== null) {
      const failure = fields(health.lastFailure, ['runId', 'generation', 'kind', 'reason'])
      uuid(failure.runId); revision(failure.generation)
      if (!['transient', 'invalid', 'uncertain', 'exhausted', 'timeout', 'quota', 'recovery'].includes(failure.kind as string) || typeof failure.reason !== 'string' || failure.reason.length > 10000) throw new Error('Invalid network failure diagnostic')
    }
    return { id: uuid(item.id), revision: revision(item.revision), groupId: uuid(item.groupId), name: item.name, state: item.state as NetworkSummary['state'], counts: counts as Record<string, number>, health: health as unknown as NetworkHealth }
  })
  const result: NetworkView = { networks }
  if (input.createdId !== undefined) result.createdId = uuid(input.createdId)
  if (input.processId !== undefined) result.processId = uuid(input.processId)
  if (input.preview !== undefined) {
    const preview = fields(input.preview, ['id', 'networkId', 'revision', 'podIds', 'pausedPodIds', 'budget', 'expiresAt', 'sources', 'consumers'])
    const command = parseNetworkCommand({ type: 'preview', id: preview.networkId, revision: preview.revision, podIds: preview.podIds, pausedPodIds: preview.pausedPodIds, budget: preview.budget })
    if (command.type !== 'preview' || !Number.isSafeInteger(preview.expiresAt) || (preview.expiresAt as number) < 0) throw new Error('Invalid network processing preview')
    const sources = list(preview.sources, networkLimits.members).map(uuid); const consumers = list(preview.consumers, networkLimits.members).map(uuid)
    if (sources.length + consumers.length !== command.podIds.length || new Set([...sources, ...consumers]).size !== command.podIds.length || [...sources, ...consumers].some(id => !command.podIds.includes(id))) throw new Error('Invalid network processing preview members')
    result.preview = { id: uuid(preview.id), networkId: command.id, revision: command.revision, podIds: command.podIds, pausedPodIds: command.pausedPodIds, budget: command.budget, expiresAt: preview.expiresAt as number, sources, consumers }
  }
  return result
}

export function diagnoseNetwork(definition: NetworkDefinition): NetworkDiagnostic[] {
  const diagnostics: NetworkDiagnostic[] = []
  const declared = new Set(definition.channels.map(channel => channel.name))
  const producers = new Map<string, string[]>()
  for (const member of definition.members) {
    for (const channel of member.contract.gives) producers.set(channel, [...producers.get(channel) ?? [], member.podId])
    for (const channel of new Set([...member.contract.takes, ...member.contract.gives])) {
      if (!declared.has(channel)) diagnostics.push({ code: 'channel-undeclared', podId: member.podId, channel })
    }
  }
  for (const channel of definition.channels) {
    const consumed = definition.members.some(member => member.contract.takes.includes(channel.name))
    if (!producers.has(channel.name) && !consumed) diagnostics.push({ code: 'channel-without-producer', podId: null, channel: channel.name })
    if (!consumed) diagnostics.push({ code: 'channel-without-consumer', podId: null, channel: channel.name })
  }
  const predecessors = new Map<string, string[]>()
  for (const member of definition.members) {
    predecessors.set(member.podId, member.contract.takes.flatMap(channel => producers.get(channel) ?? []))
    for (const channel of member.contract.takes) {
      if (!producers.has(channel)) diagnostics.push({ code: 'channel-without-producer', podId: member.podId, channel })
    }
  }
  for (const member of definition.members) {
    const seen = new Set<string>()
    const pending = [...predecessors.get(member.podId) ?? []]
    while (pending.length) {
      const id = pending.pop()!
      if (id === member.podId) { diagnostics.push({ code: 'cycle', podId: member.podId, channel: null }); break }
      if (seen.has(id)) continue
      seen.add(id)
      pending.push(...predecessors.get(id) ?? [])
    }
  }
  return diagnostics
}
