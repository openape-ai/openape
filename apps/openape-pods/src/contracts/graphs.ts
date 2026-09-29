import { parseCredentialAlias } from './credentials'
import type { WorkflowDefinition } from './workflows'

export type GraphMode = 'sequence' | 'channels'
export interface GraphChannel { name: string, title: string, fields: string[] }
export interface GraphGateOption { key: string, title: string, channel: string }
export type GraphGate
  = | { key: string, title: string, kind: 'approve', takes: string, gives: string, excluded: string | null }
    | { key: string, title: string, kind: 'choose', takes: string, options: GraphGateOption[] }
export interface GraphValue { name: string, value: string, revision: number }
export interface GraphContract { takes: string[], gives: string[], summary: string }
export type GraphNodeKind = 'gate' | 'effect' | 'decision' | 'code'
export interface GraphEdge { from: string, to: string, channel: string }
export type GraphDiagnosticCode = 'channel-without-producer' | 'channel-without-consumer' | 'channel-undeclared' | 'emit-undeclared' | 'cycle' | 'archive-without-gate' | 'summary-invalid' | 'contract-missing' | 'member-elsewhere' | 'value-name-conflict'
export interface GraphDiagnostic { level: 'error', code: GraphDiagnosticCode, message: string, node: string | null, channel: string | null }
/** What the store knows about a member Pod beyond its contract. */
export interface GraphMemberFacts { archive?: boolean, elsewhere?: boolean, emits?: string[], variables?: string[] }

export const graphLimits = { channels: 32, gates: 8, values: 32, valueLength: 16384 } as const
export const graphDiagnosticMessages: Record<GraphDiagnosticCode, string> = {
  'channel-without-producer': 'A taken channel has no node that gives it',
  'channel-without-consumer': 'A given channel has no node that takes it',
  'channel-undeclared': 'The channel is missing from the channel list of the graph',
  'emit-undeclared': 'The script emits a channel missing from its contract',
  'cycle': 'The derived connections contain a cycle',
  'archive-without-gate': 'A pod with an archive right needs an approval gate before it',
  'summary-invalid': 'The contract needs a summary of at most 40 characters',
  'contract-missing': 'The validated script exports no contract',
  'member-elsewhere': 'The pod belongs to another graph or another group',
  'value-name-conflict': 'A graph value and a pod variable share a name',
}

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const channelName = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,4}$/.test(value)
const key = (value: unknown): value is string => typeof value === 'string' && value.length <= 32 && /^[a-z][a-z0-9-]*$/.test(value)
const title = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 60
function list(value: unknown, fields: string[], error: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(field => !fields.includes(field)))) throw new Error(error)
  return value
}
function unique(values: string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Graph names must be unique')
}

export function parseGraphMode(value: unknown): GraphMode {
  if (value !== 'sequence' && value !== 'channels') throw new Error('Invalid graph mode')
  return value
}
export function parseGraphGroup(value: unknown): string | null {
  if (value !== null && !uuid(value)) throw new Error('Invalid graph group')
  return value
}
export function parseGraphChannels(value: unknown): GraphChannel[] {
  const channels = list(value, ['name', 'title', 'fields'], 'Invalid graph channel').map((item) => {
    if (!channelName(item.name) || !title(item.title) || !Array.isArray(item.fields) || item.fields.length > 16 || item.fields.some(field => typeof field !== 'string' || !field.trim() || field.length > 40)) throw new Error('Invalid graph channel')
    return { name: item.name, title: item.title, fields: [...item.fields] as string[] }
  })
  if (channels.length > graphLimits.channels) throw new Error('A graph supports at most 32 channels')
  unique(channels.map(channel => channel.name))
  return channels
}
export function parseGraphGates(value: unknown): GraphGate[] {
  const gates = list(value, ['key', 'title', 'kind', 'takes', 'gives', 'excluded', 'options'], 'Invalid graph gate').map((item): GraphGate => {
    if (!key(item.key) || !title(item.title) || !channelName(item.takes)) throw new Error('Invalid graph gate')
    if (item.kind === 'approve') {
      if (item.options !== undefined || !channelName(item.gives) || (item.excluded !== null && !channelName(item.excluded))) throw new Error('Invalid graph gate')
      unique([item.takes, item.gives, ...item.excluded === null ? [] : [item.excluded]])
      return { key: item.key, title: item.title, kind: 'approve', takes: item.takes, gives: item.gives, excluded: item.excluded }
    }
    if (item.kind !== 'choose' || item.gives !== undefined || item.excluded !== undefined) throw new Error('Invalid graph gate')
    const options = list(item.options, ['key', 'title', 'channel'], 'Invalid graph gate').map((option) => {
      if (!key(option.key) || !title(option.title) || !channelName(option.channel) || option.channel === item.takes) throw new Error('Invalid graph gate')
      return { key: option.key, title: option.title, channel: option.channel }
    })
    if (options.length < 2 || options.length > 8) throw new Error('Invalid graph gate')
    unique(options.map(option => option.key))
    return { key: item.key, title: item.title, kind: 'choose', takes: item.takes, options }
  })
  if (gates.length > graphLimits.gates) throw new Error('A graph supports at most 8 gates')
  unique(gates.map(gate => gate.key))
  return gates
}
export function parseGraphValues(value: unknown): GraphValue[] {
  const values = list(value, ['name', 'value', 'revision'], 'Invalid graph value').map((item) => {
    parseCredentialAlias(item.name)
    if (typeof item.value !== 'string' || item.value.length > graphLimits.valueLength || item.value.includes('\0') || !Number.isSafeInteger(item.revision) || (item.revision as number) < 0) throw new Error('Invalid graph value')
    return { name: item.name as string, value: item.value, revision: item.revision as number }
  })
  if (values.length > graphLimits.values) throw new Error('A graph supports at most 32 values')
  unique(values.map(item => item.name))
  return values
}

interface Node { id: string, takes: string[], gives: string[] }
const gateNode = (gate: GraphGate): Node => ({ id: `gate:${gate.key}`, takes: [gate.takes], gives: gate.kind === 'approve' ? [gate.gives, ...gate.excluded === null ? [] : [gate.excluded]] : [...new Set(gate.options.map(option => option.channel))] })
function edges(nodes: Node[]): GraphEdge[] {
  return nodes.flatMap(from => nodes.flatMap(to => from.gives.filter(channel => to.takes.includes(channel)).map(channel => ({ from: from.id, to: to.id, channel }))))
}
export function deriveEdges(members: { podId: string, contract: GraphContract }[], gates: GraphGate[]): GraphEdge[] {
  return edges([...members.map(member => ({ id: member.podId, takes: member.contract.takes, gives: member.contract.gives })), ...gates.map(gateNode)])
}

export function diagnoseGraph(definition: WorkflowDefinition, contracts: Record<string, GraphContract | null>, facts: Record<string, GraphMemberFacts> = {}): GraphDiagnostic[] {
  if (definition.mode !== 'channels') return []
  const found: GraphDiagnostic[] = []
  const report = (code: GraphDiagnosticCode, node: string | null, channel: string | null = null) => found.push({ level: 'error', code, message: graphDiagnosticMessages[code], node, channel })
  const declared = new Set(definition.channels.map(channel => channel.name))
  const values = new Set(definition.values.map(value => value.name))
  const nodes: Node[] = []
  for (const { podId } of definition.nodes) {
    const contract = contracts[podId] ?? null; const known = facts[podId] ?? {}
    if (known.elsewhere) report('member-elsewhere', podId)
    if (known.variables?.some(name => values.has(name))) report('value-name-conflict', podId)
    if (!contract) { report('contract-missing', podId); continue }
    if (typeof contract.summary !== 'string' || !contract.summary.trim() || contract.summary.length > 40) report('summary-invalid', podId)
    for (const channel of new Set(known.emits ?? [])) {
      if (!contract.gives.includes(channel)) report('emit-undeclared', podId, channel)
    }
    nodes.push({ id: podId, takes: contract.takes, gives: contract.gives })
  }
  nodes.push(...definition.gates.map(gateNode))
  for (const node of nodes) {
    for (const channel of new Set([...node.takes, ...node.gives])) {
      if (!declared.has(channel)) report('channel-undeclared', node.id, channel)
    }
    for (const channel of node.takes) {
      if (!nodes.some(other => other.gives.includes(channel))) report('channel-without-producer', node.id, channel)
    }
    for (const channel of node.gives) {
      if (!nodes.some(other => other.takes.includes(channel))) report('channel-without-consumer', node.id, channel)
    }
  }
  const derived = edges(nodes)
  const settled = new Set<string>()
  for (let ready = nodes; ready.length;) {
    ready = nodes.filter(node => !settled.has(node.id) && derived.every(edge => edge.to !== node.id || settled.has(edge.from)))
    for (const node of ready) settled.add(node.id)
  }
  if (settled.size < nodes.length) report('cycle', null)
  for (const node of nodes.filter(node => facts[node.id]?.archive)) {
    const ancestors = new Set<string>(); const pending = [node.id]
    while (pending.length) {
      for (const edge of derived.filter(edge => edge.to === pending[0] && !ancestors.has(edge.from))) { ancestors.add(edge.from); pending.push(edge.from) }
      pending.shift()
    }
    if (![...ancestors].some(id => id.startsWith('gate:'))) report('archive-without-gate', node.id)
  }
  return found
}
