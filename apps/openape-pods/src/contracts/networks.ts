import { parseReplacementCommand, parseReplacementPreview } from './network-replacement'
import type { ReplacementCommand, ReplacementPreview } from './network-replacement'
import { parseRetirementCommand, parseArchivePreview, parseLegacyItemsPage } from './network-retirement'
import type { RetirementCommand, ArchivePreview, LegacyItemsPage } from './network-retirement'
import { parseConversionCommand, parseConversionPreview } from './network-migration'
import type { ConversionCommand, ConversionPreview } from './network-migration'
import { parseNetworkRead, networkSharedValues, parseNetworkMemberView } from './network-operations'
import type { NetworkReadCommand, NetworkFailure, NetworkDetails, NetworkSetup, NetworkTracePage, NetworkDataPage } from './network-operations'
import { parseNetworkGateView } from './network-gate-view'
import type { NetworkGateView } from './network-gate-view'
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
export interface NetworkGate { key: string, title: string, kind: 'approve', podId: string, channel: string }
export interface NetworkJoin { id: string, podId: string, channels: string[], deadlineMs: number, reviewDestination: 'owner' }
export interface NetworkDefinition {
  formatVersion: 1 | 2 | 3
  kind: 'network'
  semantics: 'persistent-network-v1'
  id: string
  revision: number
  groupId: string
  name: string
  channels: NetworkChannel[]
  members: NetworkMember[]
  gates?: NetworkGate[]
  joins?: NetworkJoin[]
}
export interface NetworkDiagnostic { code: 'channel-undeclared' | 'channel-without-producer' | 'channel-without-consumer' | 'cycle', podId: string | null, channel: string | null }
export interface NetworkSelection { podId: string, source: { schedule: ScheduleSpec | null } | null, serialCase: boolean }
export interface NetworkDraft { name: string, groupId: string, channels: NetworkChannel[], members: NetworkSelection[], sharedValues?: Record<string, unknown>, expectedSetup?: string, gates?: NetworkGate[], joins?: NetworkJoin[] }
export type NetworkCommand
  = | ReplacementCommand
    | RetirementCommand
    | ConversionCommand
    | NetworkReadCommand
    | { type: 'list' }
    | { type: 'create', draft: NetworkDraft }
    | { type: 'gateOpen', id: string, revision: number, taskId: string, generation: number }
    | { type: 'activate', id: string, revision: number }
    | { type: 'pause', id: string, revision: number }
    | { type: 'preview', id: string, revision: number, podIds: string[], pausedPodIds: string[], budget: number }
    | { type: 'inspect', id: string, revision: number, runId: string, generation: number }
    | { type: 'discardFailure', id: string, revision: number, runId: string, generation: number, evidence: string }
    | { type: 'retry', id: string, revision: number, runId: string, generation: number }
    | { type: 'resolveConflict', id: string, revision: number, runId: string, generation: number, identityHash: string, decision: 'retainOriginal' | 'discardBatch', evidence: string }
    | { type: 'reconcileEffect', id: string, revision: number, runId: string, generation: number, key: string, attempt: number, sequence: number, outcome: 'confirmed_applied' | 'confirmed_not_applied', evidence: string }
    | { type: 'gateExclude', id: string, revision: number, taskId: string, generation: number, deliveryIds: string[], evidence: string }
    | { type: 'gateReview', id: string, revision: number, taskId: string, generation: number, evidence: string }
    | { type: 'gateDiscard', id: string, revision: number, taskId: string, generation: number, evidence: string }
    | { type: 'process', id: string, revision: number, previewId: string }
export interface NetworkHealth { oldestPendingAt: number | null, nextRetryAt: number | null, lastDispatchAt: number | null, lastSchedulerProgressAt: number | null, lastSchedulerError: string | null, intakeError: string | null, lastFailure: { runId: string, generation: number, kind: string, reason: string } | null }
export interface NetworkSummary { decisions?: number, podIds?: string[], id: string, revision: number, groupId: string, name: string, state: 'active' | 'paused' | 'archived', counts: Record<string, number>, health: NetworkHealth }
export interface NetworkPreview { id: string, networkId: string, revision: number, podIds: string[], pausedPodIds: string[], budget: number, expiresAt: number, sources: string[], consumers: string[] }
export interface NetworkView { replacement?: ReplacementPreview, archiveReview?: ArchivePreview, legacyItems?: LegacyItemsPage, conversion?: ConversionPreview, unavailableReason?: string, details?: NetworkDetails, setup?: NetworkSetup, trace?: NetworkTracePage, records?: NetworkDataPage, networks: NetworkSummary[], gates?: NetworkGateView[], preview?: NetworkPreview, processId?: string, createdId?: string }
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

function gates(value: unknown): NetworkGate[] {
  const parsed = list(value, 32).map((value) => {
    const gate = fields(value, ['key', 'title', 'kind', 'podId', 'channel'])
    if (gate.kind !== 'approve' || typeof gate.key !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(gate.key) || typeof gate.title !== 'string' || !gate.title.trim() || gate.title.length > 60) throw new Error('Invalid network approval gate')
    const channel = parseGraphChannels([{ name: gate.channel, title: gate.title, fields: [] }])[0]!.name
    return { key: gate.key, title: gate.title, kind: 'approve' as const, podId: uuid(gate.podId), channel }
  })
  unique(parsed.map(gate => gate.key))
  unique(parsed.map(gate => `${gate.podId}:${gate.channel}`))
  return parsed
}

function joins(value: unknown): NetworkJoin[] {
  const result = list(value, 32).map((value) => {
    const input = fields(value, ['id', 'podId', 'channels', 'deadlineMs', 'reviewDestination'])
    const names = list(input.channels, 16).map(name => parseGraphChannels([{ name, title: name, fields: [] }])[0]!.name)
    unique(names)
    if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(input.id) || names.length < 2 || !Number.isSafeInteger(input.deadlineMs) || Number(input.deadlineMs) < 1000 || Number(input.deadlineMs) > 86400000 || input.reviewDestination !== 'owner') throw new Error('Invalid explicit network join')
    return { id: input.id, podId: uuid(input.podId), channels: names.sort(), deadlineMs: Number(input.deadlineMs), reviewDestination: 'owner' as const }
  })
  unique(result.map(join => join.id)); unique(result.map(join => join.podId))
  return result
}

export function parseNetworkDefinition(value: unknown): NetworkDefinition {
  const data = networkDataObject(value)
  const input = fields(data, ['formatVersion', 'kind', 'semantics', 'id', 'revision', 'groupId', 'name', 'channels', 'members', ...([2, 3].includes(Number(data.formatVersion)) ? ['gates'] : []), ...(data.formatVersion === 3 ? ['joins'] : [])])
  if (![1, 2, 3].includes(input.formatVersion as number) || input.kind !== 'network' || input.semantics !== 'persistent-network-v1' || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || input.name.includes('\0')) throw new Error('Invalid network definition version or name')
  const parsedChannels = channels(input.channels)
  const members = list(input.members, networkLimits.members).map(member)
  if (!members.length) throw new Error('Network requires at least one member')
  unique(members.map(item => item.podId))
  unique(members.flatMap(item => item.source ? [item.source.bindingId] : []))
  const result: NetworkDefinition = { formatVersion: input.formatVersion as 1 | 2 | 3, kind: 'network', semantics: 'persistent-network-v1', id: uuid(input.id), revision: revision(input.revision), groupId: uuid(input.groupId), name: input.name, channels: parsedChannels, members }
  if (result.formatVersion >= 2) {
    result.gates = gates(input.gates)
    if (result.gates.some(gate => !members.some(member => member.podId === gate.podId && !member.source && member.contract.takes.includes(gate.channel)))) throw new Error('Network gate requires a declared downstream subscription')
  }
  if (result.formatVersion === 3) {
    result.joins = joins(input.joins)
    for (const join of result.joins) {
      const target = members.find(member => member.podId === join.podId && !member.source)
      if (!target || target.contract.takes.length !== join.channels.length || join.channels.some(name => !target.contract.takes.includes(name) || !parsedChannels.some(channel => channel.name === name))) throw new Error('Explicit joins must cover every declared input of one consumer')
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > networkLimits.definitionBytes) throw new Error('Network definition exceeds its size limit')
  return result
}

export function parseNetworkCommand(value: unknown): NetworkCommand {
  const input = networkDataObject(value)
  if (['replacementSetup', 'replacementPreview', 'replaceComposition'].includes(String(input.type))) return parseReplacementCommand(input)
  if (['archivePreview', 'archiveNetwork', 'legacyItems'].includes(String(input.type))) return parseRetirementCommand(input)
  if (input.type === 'conversionPreview' || input.type === 'convert') return parseConversionCommand(input)
  if (['setup', 'detail', 'trace', 'records'].includes(String(input.type))) return parseNetworkRead(input)!
  if (input.type === 'list') { fields(input, ['type']); return { type: 'list' } }
  if (input.type === 'create') {
    fields(input, ['type', 'draft'])
    const data = networkDataObject(input.draft)
    const draft = fields(data, ['name', 'groupId', 'channels', 'members', ...(Object.hasOwn(data, 'expectedSetup') ? ['expectedSetup'] : []), ...(Object.hasOwn(data, 'sharedValues') ? ['sharedValues'] : []), ...(Object.hasOwn(data, 'gates') ? ['gates'] : []), ...(Object.hasOwn(data, 'joins') ? ['joins'] : [])])
    if (Object.hasOwn(draft, 'expectedSetup') && (typeof draft.expectedSetup !== 'string' || !/^[a-f0-9]{64}$/.test(draft.expectedSetup))) throw new Error('Invalid network setup fingerprint')
    if (Object.hasOwn(draft, 'sharedValues')) draft.sharedValues = networkSharedValues(draft.sharedValues)
    const members = list(draft.members, networkLimits.members).map((value) => {
      const item = fields(value, ['podId', 'source', 'serialCase'])
      if (typeof item.serialCase !== 'boolean') throw new Error('Invalid network case serialization policy')
      const source = item.source === null ? null : fields(item.source, ['schedule'])
      return { podId: uuid(item.podId), serialCase: item.serialCase, source: source ? { schedule: source.schedule === null ? null : parseSchedule(source.schedule) } : null }
    })
    if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 120 || draft.name.includes('\0') || !members.length) throw new Error('Invalid network draft name or members')
    unique(members.map(item => item.podId))
    return { type: 'create', draft: { name: draft.name, groupId: uuid(draft.groupId), channels: channels(draft.channels), members, ...(Object.hasOwn(draft, 'expectedSetup') ? { expectedSetup: draft.expectedSetup as string } : {}), ...(Object.hasOwn(draft, 'sharedValues') ? { sharedValues: draft.sharedValues as Record<string, unknown> } : {}), ...(Object.hasOwn(draft, 'gates') ? { gates: gates(draft.gates) } : {}), ...(Object.hasOwn(draft, 'joins') ? { joins: joins(draft.joins) } : {}) } }
  }
  if (input.type === 'gateOpen') { fields(input, ['type', 'id', 'revision', 'taskId', 'generation']); return { type: 'gateOpen', id: uuid(input.id), revision: revision(input.revision), taskId: uuid(input.taskId), generation: revision(input.generation) } }
  if (input.type === 'gateExclude' || input.type === 'gateDiscard' || input.type === 'gateReview') {
    fields(input, ['type', 'id', 'revision', 'taskId', 'generation', 'evidence', ...(input.type === 'gateExclude' ? ['deliveryIds'] : [])])
    if (typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 4000) throw new Error('Network gate resolution requires explicit owner evidence')
    const authority = { id: uuid(input.id), revision: revision(input.revision), taskId: uuid(input.taskId), generation: revision(input.generation), evidence: input.evidence }
    if (input.type === 'gateDiscard' || input.type === 'gateReview') return { type: input.type, ...authority }
    const deliveryIds = list(input.deliveryIds, 30).map(uuid)
    if (!deliveryIds.length) throw new Error('Select at least one network gate input to exclude')
    unique(deliveryIds)
    return { type: 'gateExclude', ...authority, deliveryIds }
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
  if (Object.keys(input).some(key => !['networks', 'gates', 'preview', 'processId', 'createdId', 'details', 'setup', 'trace', 'records', 'unavailableReason', 'conversion', 'archiveReview', 'legacyItems', 'replacement'].includes(key))) throw new Error('Invalid network view fields')
  const networks = list(input.networks, networkLimits.networks).map((value) => {
    const item = fields(value, ['id', 'revision', 'groupId', 'name', 'state', 'counts', 'health', ...(Object.hasOwn(networkDataObject(value), 'decisions') ? ['decisions'] : []), ...(Object.hasOwn(networkDataObject(value), 'podIds') ? ['podIds'] : [])])
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
    if (item.decisions !== undefined && (!Number.isSafeInteger(item.decisions) || Number(item.decisions) < 0)) throw new Error('Invalid network decision count')
    if (item.podIds !== undefined) list(item.podIds, 64).forEach(uuid)
    return { ...(item.decisions === undefined ? {} : { decisions: item.decisions as number }), ...(item.podIds === undefined ? {} : { podIds: item.podIds as string[] }), id: uuid(item.id), revision: revision(item.revision), groupId: uuid(item.groupId), name: item.name, state: item.state as NetworkSummary['state'], counts: counts as Record<string, number>, health: health as unknown as NetworkHealth }
  })
  const result: NetworkView = { networks }
  if (input.replacement !== undefined) result.replacement = parseReplacementPreview(input.replacement)
  if (input.archiveReview !== undefined) result.archiveReview = parseArchivePreview(input.archiveReview)
  if (input.legacyItems !== undefined) result.legacyItems = parseLegacyItemsPage(input.legacyItems)
  if (input.conversion !== undefined) result.conversion = parseConversionPreview(input.conversion)
  if (input.unavailableReason !== undefined) {
    if (typeof input.unavailableReason !== 'string' || input.unavailableReason.length > 2000) throw new Error('Invalid network availability')
    result.unavailableReason = input.unavailableReason
  }
  if (input.setup !== undefined) {
    const setup = fields(input.setup, ['groupId', 'members', 'fingerprint'])
    if (typeof setup.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(setup.fingerprint)) throw new Error('Invalid network setup fingerprint')
    result.setup = { fingerprint: setup.fingerprint, groupId: uuid(setup.groupId), members: list(setup.members, 64).map(parseNetworkMemberView) }
  }
  if (input.details !== undefined) {
    const detail = fields(input.details, ['definition', 'members', 'failures', 'collections', 'collectionsMore'])
    const definition = parseNetworkDefinition(detail.definition)
    if (!networks.some(network => network.id === definition.id && network.revision === definition.revision)) throw new Error('Invalid network detail ownership')
    const members = list(detail.members, 64).map(parseNetworkMemberView)
    if (members.length !== definition.members.length || members.some(member => !definition.members.some(item => item.podId === member.podId))) throw new Error('Invalid network member view')
    const failures = list(detail.failures, 50).map((value) => {
      const failure = fields(value, ['runId', 'generation', 'podId', 'kind', 'reason', 'inspectedAt', 'conflict', 'effects', 'effectsMore'])
      if (!['transient', 'invalid', 'uncertain', 'exhausted', 'timeout', 'quota', 'recovery'].includes(String(failure.kind)) || typeof failure.reason !== 'string' || failure.reason.length > 10000) throw new Error('Invalid network failure diagnostic')
      if (failure.inspectedAt !== null && (!Number.isSafeInteger(failure.inspectedAt) || Number(failure.inspectedAt) < 0)) throw new Error('Invalid network failure diagnostic')
      if ((failure.conflict !== null && (typeof failure.conflict !== 'string' || !/^[a-f0-9]{64}$/.test(failure.conflict))) || typeof failure.effectsMore !== 'boolean') throw new Error('Invalid network failure diagnostic')
      const effects = list(failure.effects, 50).map((value) => {
        const effect = fields(value, ['key', 'attempt', 'sequence', 'state'])
        if (typeof effect.key !== 'string' || !/^[a-f0-9]{64}$/.test(effect.key) || !Number.isSafeInteger(effect.sequence) || Number(effect.sequence) < 0 || !['intent', 'unknown', 'confirmed_applied', 'confirmed_not_applied'].includes(String(effect.state))) throw new Error('Invalid network effect summary')
        return { key: effect.key, attempt: revision(effect.attempt), sequence: Number(effect.sequence), state: effect.state as string }
      })
      return { runId: uuid(failure.runId), generation: revision(failure.generation), podId: uuid(failure.podId), kind: failure.kind as NetworkFailure['kind'], reason: failure.reason, inspectedAt: failure.inspectedAt as number | null, conflict: failure.conflict as string | null, effects, effectsMore: failure.effectsMore }
    })
    const collections = list(detail.collections, 64).map((value) => {
      const collection = fields(value, ['id', 'name', 'version'])
      if (typeof collection.name !== 'string' || collection.name.length > 200) throw new Error('Invalid network collection view')
      return { id: uuid(collection.id), name: collection.name, version: revision(collection.version) }
    })
    if (typeof detail.collectionsMore !== 'boolean') throw new Error('Invalid network collection view')
    result.details = { definition, members, failures, collections, collectionsMore: detail.collectionsMore }
  }
  if (input.trace !== undefined) {
    const page = fields(input.trace, ['events', 'before'])
    const events = list(page.events, 50).map((value) => {
      const row = fields(value, ['id', 'caseId', 'runId', 'kind', 'body', 'truncated', 'at'])
      if (typeof row.kind !== 'string' || row.kind.length > 200 || typeof row.body !== 'string' || row.body.length > 8192 || typeof row.truncated !== 'boolean') throw new Error('Invalid network trace page')
      return { id: revision(row.id), caseId: row.caseId === null ? null : uuid(row.caseId), runId: row.runId === null ? null : uuid(row.runId), kind: row.kind, body: row.body, truncated: row.truncated, at: revision(row.at) }
    })
    result.trace = { events, before: page.before === null ? null : revision(page.before) }
  }
  if (input.records !== undefined) {
    const page = fields(input.records, ['collectionId', 'records', 'after'])
    const records = list(page.records, 5).map((value) => {
      const row = fields(value, ['key', 'revision', 'schemaVersion', 'body', 'truncated', 'deleted', 'at'])
      if (typeof row.key !== 'string' || row.key.length > 200 || (row.body !== null && (typeof row.body !== 'string' || row.body.length > 196608)) || typeof row.deleted !== 'boolean' || typeof row.truncated !== 'boolean') throw new Error('Invalid network records page')
      return { key: row.key, revision: revision(row.revision), schemaVersion: revision(row.schemaVersion), body: row.body as string | null, truncated: row.truncated, deleted: row.deleted, at: revision(row.at) }
    })
    if (page.after !== null && (typeof page.after !== 'string' || page.after.length > 200)) throw new Error('Invalid network records page')
    result.records = { collectionId: uuid(page.collectionId), records, after: page.after as string | null }
  }
  if (input.gates !== undefined) {
    result.gates = list(input.gates, 256).map(parseNetworkGateView)
    if (result.gates.some(gate => !networks.some(network => network.id === gate.networkId))) throw new Error('Network gate view contains foreign owner work')
    unique(result.gates.map(gate => gate.id))
  }
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
