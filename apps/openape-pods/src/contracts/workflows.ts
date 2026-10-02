import { parseWorkflowPorts, workflowIdentity } from './workflow-ports'
import type { WorkflowPorts } from './workflow-ports'
import { parseMailWorkflowConfiguration, parseMailEffectResolution, parseMailBatchReview } from './mail-workflow'
import type { MailWorkflowConfiguration, MailBatchReview, MailEffectResolution } from './mail-workflow'
import { Cron } from 'croner'
import { parseSchedule } from './scheduling'
import type { ScheduleSpec } from './scheduling'
import { parseGraphChannels, parseGraphGates, parseGraphGroup, parseGraphMode, parseGraphValues } from './graphs'
import type { GraphChannel, GraphContract, GraphDetail, GraphGate, GraphMode, GraphValue } from './graphs'
import type { GateBatchView, GateHeldItem } from './gates'

export type WorkflowSchedule = ScheduleSpec | { kind: 'once', at: number } | { kind: 'cron', expression: string, timezone: string }
export interface WorkflowNode { podId: string, after: string[], handoff: boolean }
export interface GraphParts { mode: GraphMode, groupId: string | null, channels: GraphChannel[], gates: GraphGate[], values: GraphValue[] }
export const sequenceParts: GraphParts = { mode: 'sequence', groupId: null, channels: [], gates: [], values: [] }
export interface WorkflowDefinition extends GraphParts { mail?: MailWorkflowConfiguration | null, id: string, revision: number, name: string, nodes: WorkflowNode[], schedule: WorkflowSchedule | null, enabled: boolean, paused: boolean, nextAt: number | null }
export type WorkflowNodeState = 'waiting' | 'running' | 'completed' | 'blocked'
export interface WorkflowNodeView extends WorkflowNode { state: WorkflowNodeState, runId: string | null, reason: string | null, scriptHash: string | null }
export interface WorkflowRunView { revisionKind?: 'composition' | 'published', paused: boolean, id: string, workflowId: string, revision: number, state: 'waiting' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled', reason: string | null, startedAt: number, finishedAt: number | null, nodes: WorkflowNodeView[] }
export interface WorkflowView { mailReview?: MailBatchReview | null, workflows: WorkflowDefinition[], runs: WorkflowRunView[], gates?: { batches: GateBatchView[], held: GateHeldItem[] }, graph?: GraphDetail | null, contracts?: Record<string, GraphContract | null>, graphs?: Record<string, GraphDetail> }
export type WorkflowCommand = { type: 'publishRevision', id: string, revision: number, ports: WorkflowPorts } | { type: 'cancelCall' | 'resumeCall' | 'resolveCall', requestId: string, evidence: string } | { type: 'mailReview', batchId: string } | { type: 'mailResolve', resolution: MailEffectResolution } | { type: 'list' } | ({ type: 'save', mail?: MailWorkflowConfiguration | null, id: string, revision: number, name: string, nodes: WorkflowNode[], schedule: WorkflowSchedule | null, enabled: boolean } & Partial<GraphParts>) | { type: 'delete', id: string, revision: number } | { type: 'start', id: string, revision: number } | { type: 'retry', runId: string, podId: string } | { type: 'cancel', runId: string } | { type: 'pause', id: string, revision: number, paused: boolean } | { type: 'gateExclude', batchId: string, itemIds: string[] } | { type: 'gateChoose', id: string, gate: string, itemId: string, option: string } | { type: 'gateDiscard', batchId: string } | { type: 'graph', id: string, key?: string } | { type: 'gateOpen', batchId: string }

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workflow data')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported workflow fields')
}
export function parseWorkflowSchedule(value: unknown): WorkflowSchedule {
  const item = object(value)
  if (item.kind === 'interval' || item.kind === 'daily') return parseSchedule(value)
  if (item.kind === 'once') {
    keys(item, ['kind', 'at'])
    if (!Number.isSafeInteger(item.at) || (item.at as number) < 0 || (item.at as number) > 8640000000000000) throw new Error('Invalid workflow start time')
    return { kind: 'once', at: item.at as number }
  }
  keys(item, ['kind', 'expression', 'timezone'])
  if (item.kind !== 'cron' || typeof item.expression !== 'string' || item.expression.length > 150 || item.expression.trim().split(/\s+/).length !== 5 || typeof item.timezone !== 'string' || item.timezone.length > 100) throw new Error('Use a five-field cron expression and a timezone')
  new Intl.DateTimeFormat('en', { timeZone: item.timezone }).format(0)
  new Cron(item.expression, { timezone: item.timezone, legacyMode: true })
  return { kind: 'cron', expression: item.expression.trim(), timezone: item.timezone }
}
export function parseWorkflowNodes(value: unknown): WorkflowNode[] {
  if (!Array.isArray(value) || !value.length || value.length > 32) throw new Error('A workflow needs between 1 and 32 pods')
  const nodes = value.map((value) => {
    const item = object(value); keys(item, ['podId', 'after', 'handoff'])
    if (!uuid(item.podId) || !Array.isArray(item.after) || item.after.length > 31 || !item.after.every(uuid) || new Set(item.after).size !== item.after.length || typeof item.handoff !== 'boolean') throw new Error('Invalid workflow dependencies')
    return { podId: item.podId, after: [...item.after] as string[], handoff: item.handoff }
  })
  const ids = new Set(nodes.map(node => node.podId))
  if (ids.size !== nodes.length || nodes.some(node => node.after.some(id => !ids.has(id)))) throw new Error('Workflow pods must be unique and dependencies must belong to the workflow')
  const visited = new Set<string>()
  while (visited.size < nodes.length) {
    const ready = nodes.filter(node => !visited.has(node.podId) && node.after.every(id => visited.has(id)))
    if (!ready.length) throw new Error('Workflow dependencies contain a cycle')
    for (const node of ready) visited.add(node.podId)
  }
  return nodes
}
export function parseWorkflowCommand(value: unknown): WorkflowCommand {
  const item = object(value)
  const allowed = item.type === 'publishRevision' ? ['type', 'id', 'revision', 'ports'] : item.type === 'cancelCall' || item.type === 'resumeCall' || item.type === 'resolveCall' ? ['type', 'requestId', 'evidence'] : item.type === 'mailReview' ? ['type', 'batchId'] : item.type === 'mailResolve' ? ['type', 'resolution'] : item.type === 'list' ? ['type'] : item.type === 'save' ? ['type', 'id', 'revision', 'name', 'nodes', 'schedule', 'enabled', 'mail', 'mode', 'groupId', 'channels', 'gates', 'values'] : item.type === 'pause' ? ['type', 'id', 'revision', 'paused'] : item.type === 'start' || item.type === 'delete' ? ['type', 'id', 'revision'] : item.type === 'retry' ? ['type', 'runId', 'podId'] : item.type === 'cancel' ? ['type', 'runId'] : item.type === 'gateExclude' ? ['type', 'batchId', 'itemIds'] : item.type === 'gateChoose' ? ['type', 'id', 'gate', 'itemId', 'option'] : item.type === 'gateDiscard' || item.type === 'gateOpen' ? ['type', 'batchId'] : item.type === 'graph' ? ['type', 'id', 'key'] : []
  if (!allowed.length) throw new Error('Unsupported workflow command')
  keys(item, allowed)
  if (item.type === 'cancelCall' || item.type === 'resumeCall' || item.type === 'resolveCall') {
    if (typeof item.evidence !== 'string' || !item.evidence.trim() || item.evidence.length > 4000) throw new Error('Workflow call cancellation requires owner evidence')
    return { type: item.type, requestId: workflowIdentity(item.requestId), evidence: item.evidence }
  }
  if (item.type === 'publishRevision') {
    if (!Number.isSafeInteger(item.revision) || Number(item.revision) < 1) throw new Error('Invalid workflow revision')
    return { type: 'publishRevision', id: workflowIdentity(item.id), revision: Number(item.revision), ports: parseWorkflowPorts(item.ports) }
  }
  if (item.type === 'mailReview') {
    if (!uuid(item.batchId)) throw new Error('Invalid workflow run identity')
    return { type: 'mailReview', batchId: item.batchId }
  }
  if (item.type === 'mailResolve') return { type: 'mailResolve', resolution: parseMailEffectResolution(item.resolution) }
  if (item.type === 'list') return { type: 'list' }
  if (item.type === 'gateOpen') {
    if (!uuid(item.batchId)) throw new Error('Invalid gate decision')
    return { type: 'gateOpen', batchId: item.batchId }
  }
  if (item.type === 'gateExclude' || item.type === 'gateDiscard') {
    if (!uuid(item.batchId) || (item.type === 'gateExclude' && (!Array.isArray(item.itemIds) || !item.itemIds.length || item.itemIds.length > 30 || !item.itemIds.every(uuid)))) throw new Error('Invalid gate decision')
    return item.type === 'gateDiscard' ? { type: 'gateDiscard', batchId: item.batchId } : { type: 'gateExclude', batchId: item.batchId, itemIds: [...item.itemIds as string[]] }
  }
  if (item.type === 'graph') {
    if (!uuid(item.id) || (item.key !== undefined && (typeof item.key !== 'string' || !item.key || item.key.length > 200))) throw new Error('Invalid workflow run identity')
    return { type: 'graph', id: item.id, ...(item.key === undefined ? {} : { key: item.key }) }
  }
  if (item.type === 'gateChoose') {
    if (!uuid(item.id) || !uuid(item.itemId) || typeof item.gate !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(item.gate) || typeof item.option !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(item.option)) throw new Error('Invalid gate decision')
    return { type: 'gateChoose', id: item.id, gate: item.gate, itemId: item.itemId, option: item.option }
  }
  if (item.type === 'cancel' || item.type === 'retry') {
    if (!uuid(item.runId) || (item.type === 'retry' && !uuid(item.podId))) throw new Error('Invalid workflow run identity')
    return item as unknown as WorkflowCommand
  }
  if (!uuid(item.id) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 0) throw new Error('Invalid workflow revision')
  if (item.type === 'pause') {
    if (typeof item.paused !== 'boolean') throw new Error('Invalid workflow pause state')
    return { type: 'pause', id: item.id, revision: item.revision as number, paused: item.paused }
  }
  if (item.type === 'start' || item.type === 'delete') return { type: item.type, id: item.id, revision: item.revision as number }
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || typeof item.enabled !== 'boolean') throw new Error('Invalid workflow name or activation')
  const schedule = item.schedule === null ? null : parseWorkflowSchedule(item.schedule)
  if (item.enabled && !schedule) throw new Error('Choose a workflow schedule before enabling it')
  const nodes = parseWorkflowNodes(item.nodes)
  const mail = item.mail === undefined || item.mail === null ? item.mail : parseMailWorkflowConfiguration(item.mail)
  if (mail) {
    const filter = nodes.find(node => node.podId === mail.filterPodId)
    const notify = nodes.find(node => node.podId === mail.notifyPodId)
    const ancestors = new Set<string>(); const pending = [...notify?.after ?? []]
    while (pending.length) { const id = pending.pop()!; if (ancestors.has(id)) continue; ancestors.add(id); pending.push(...nodes.find(node => node.podId === id)!.after) }
    if (!filter || !notify || !ancestors.has(filter.podId)) throw new Error('Mail notification must depend on the configured filter pod')
  }
  const graph: GraphParts = { mode: parseGraphMode(item.mode ?? 'sequence'), groupId: parseGraphGroup(item.groupId ?? null), channels: parseGraphChannels(item.channels ?? []), gates: parseGraphGates(item.gates ?? []), values: parseGraphValues(item.values ?? []) }
  if (graph.mode === 'sequence' && (graph.channels.length || graph.gates.length || graph.values.length)) throw new Error('Channels, gates and graph values need channel mode')
  if (graph.mode === 'channels' && (mail || nodes.some(node => node.after.length || node.handoff))) throw new Error('Channel graphs cannot use dependencies, handoff or mail rules')
  return { type: 'save', id: item.id, revision: item.revision as number, name: item.name.trim(), nodes, schedule, enabled: item.enabled, ...(mail !== undefined ? { mail } : {}), ...graph }
}
export function parseWorkflowView(value: unknown): WorkflowView {
  const item = object(value)
  if (!Array.isArray(item.workflows) || item.workflows.length > 1000 || !Array.isArray(item.runs) || item.runs.length > 100) throw new Error('Invalid workflow view')
  if (item.mailReview !== undefined && item.mailReview !== null) parseMailBatchReview(item.mailReview)
  for (const definition of item.workflows) {
    const { nextAt, paused, ...rest } = object(definition)
    if (typeof paused !== 'boolean') throw new Error('Invalid workflow pause state')
    parseWorkflowCommand({ ...rest, type: 'save' })
    if (nextAt !== null && !Number.isSafeInteger(nextAt)) throw new Error('Invalid workflow start time')
  }
  for (const value of item.runs) {
    const run = object(value)
    if (run.revisionKind !== undefined && !['composition', 'published'].includes(run.revisionKind as string)) throw new Error('Invalid workflow revision kind')
    if (typeof run.paused !== 'boolean' || !uuid(run.id) || !uuid(run.workflowId) || !Number.isSafeInteger(run.revision) || !['waiting', 'running', 'blocked', 'completed', 'failed', 'cancelled'].includes(run.state as string) || !Number.isSafeInteger(run.startedAt) || (run.finishedAt !== null && !Number.isSafeInteger(run.finishedAt)) || (run.reason !== null && typeof run.reason !== 'string') || !Array.isArray(run.nodes)) throw new Error('Invalid workflow run')
    parseWorkflowNodes(run.nodes.map((value) => {
      const node = object(value)
      if (!['waiting', 'running', 'completed', 'blocked'].includes(node.state as string) || (node.runId !== null && !uuid(node.runId)) || (node.reason !== null && typeof node.reason !== 'string') || (node.scriptHash !== null && (typeof node.scriptHash !== 'string' || !/^[a-f0-9]{64}$/.test(node.scriptHash)))) throw new Error('Invalid workflow node state')
      return { podId: node.podId, after: node.after, handoff: node.handoff }
    }))
  }
  if (item.graph !== undefined && item.graph !== null) {
    const graph = object(item.graph)
    if (!uuid(graph.workflowId) || !Array.isArray(graph.edges) || graph.edges.length > 4096 || !Array.isArray(graph.diagnostics) || !Array.isArray(graph.counts) || !Array.isArray(graph.items) || graph.items.length > 200) throw new Error('Invalid graph view')
  }
  if (item.gates !== undefined) {
    const gates = object(item.gates)
    if (!Array.isArray(gates.batches) || gates.batches.length > 100 || !Array.isArray(gates.held) || gates.held.length > 3200) throw new Error('Invalid gate view')
  }
  return item as unknown as WorkflowView
}

export interface WorkflowOutput { schema: string, data: Record<string, unknown> }
export function parseWorkflowOutput(value: unknown): WorkflowOutput {
  const item = object(value); keys(item, ['schema', 'data'])
  if (typeof item.schema !== 'string' || !/^[a-z][a-z0-9-]{0,63}\/v[1-9]\d*$/.test(item.schema) || JSON.stringify(value).length > 65536) throw new Error('Invalid workflow output schema or size')
  return { schema: item.schema, data: object(item.data) }
}
