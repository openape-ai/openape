/**
 * The channel model of networks: a Pod script's contract and emits, the channels and the routes
 * (approve and choose) between members. Workflows and their graphs left with issue 1455 (M4).
 */
export interface GraphChannel { name: string, title: string, fields: string[] }
export interface GraphGateOption { key: string, title: string, channel: string }
export type GraphGate
  = | { key: string, title: string, kind: 'approve', takes: string, gives: string, excluded: string | null }
    | { key: string, title: string, kind: 'choose', takes: string, options: GraphGateOption[] }
export interface GraphContract { takes: string[], gives: string[], summary: string }
export interface GraphItem { key: string, channel: string, data: Record<string, unknown> }
export interface GraphEmit { key: string, data: Record<string, unknown>, reason?: string, confidence?: number }
export interface GraphEdge { from: string, to: string, channel: string }

export const graphLimits = { channels: 32, gates: 8, takes: 8, gives: 16, payloadBytes: 1024, reasonLength: 500, emits: 500 } as const
const summaryInvalid = 'The contract needs a summary of at most 40 characters'
const emitUndeclared = 'The script emits a channel missing from its contract'

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

function channelList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some(name => !channelName(name))) throw new Error('Invalid graph contract')
  unique(value)
  return [...value]
}
export function parseGraphContract(value: unknown): GraphContract {
  const contract = list([value], ['takes', 'gives', 'summary'], 'Invalid graph contract')[0]!
  if (typeof contract.summary !== 'string' || !contract.summary.trim() || contract.summary.length > 40) throw new Error(summaryInvalid)
  return { takes: channelList(contract.takes, graphLimits.takes), gives: channelList(contract.gives, graphLimits.gives), summary: contract.summary }
}
/** Two items per taken channel, so a validated script meets every channel more than once. */
export function syntheticGraphItems(contract: GraphContract): GraphItem[] {
  return contract.takes.flatMap(channel => [1, 2].map(index => ({ key: `synthetic-${index}`, channel, data: {} })))
}
/** Checks every emit of one run against the contract and the per-run limits. */
export function graphEmitter(contract: GraphContract | undefined): (payload: unknown) => GraphEmit & { channel: string } {
  const emitted = new Set<string>()
  return (payload) => {
    if (!contract) throw new Error('Script declares no contract')
    const emit = list([payload], ['channel', 'key', 'data', 'reason', 'confidence'], 'Invalid graph emit')[0]!
    // eslint-disable-next-line no-control-regex
    if (!channelName(emit.channel) || typeof emit.key !== 'string' || !emit.key || emit.key.length > 200 || /[\u0000-\u001F\u007F]/.test(emit.key) || !emit.data || typeof emit.data !== 'object' || Array.isArray(emit.data)) throw new Error('Invalid graph emit')
    if (emit.confidence !== undefined && (typeof emit.confidence !== 'number' || !(emit.confidence >= 0 && emit.confidence <= 1))) throw new Error('Invalid graph emit')
    if (emit.reason !== undefined && typeof emit.reason !== 'string') throw new Error('Invalid graph emit')
    if (!contract.gives.includes(emit.channel)) throw new Error(emitUndeclared)
    if (new TextEncoder().encode(JSON.stringify(emit.data)).length > graphLimits.payloadBytes) throw new Error('Item payload exceeds 1,024 bytes')
    if (emit.reason !== undefined && emit.reason.length > graphLimits.reasonLength) throw new Error('Emit reason exceeds 500 characters')
    const identity = JSON.stringify([emit.channel, emit.key])
    if (emitted.has(identity)) throw new Error('The item was already emitted to this channel')
    if (emitted.size >= graphLimits.emits) throw new Error('A run supports at most 500 emits')
    emitted.add(identity)
    return structuredClone({ channel: emit.channel, key: emit.key, data: emit.data as Record<string, unknown>, ...emit.reason === undefined ? {} : { reason: emit.reason }, ...emit.confidence === undefined ? {} : { confidence: emit.confidence } })
  }
}

interface Node { id: string, takes: string[], gives: string[] }
const gateNode = (gate: GraphGate): Node => ({ id: `gate:${gate.key}`, takes: [gate.takes], gives: gate.kind === 'approve' ? [gate.gives, ...gate.excluded === null ? [] : [gate.excluded]] : [...new Set(gate.options.map(option => option.channel))] })
function edges(nodes: Node[]): GraphEdge[] {
  return nodes.flatMap(from => nodes.flatMap(to => from.gives.filter(channel => to.takes.includes(channel)).map(channel => ({ from: from.id, to: to.id, channel }))))
}
export function deriveEdges(members: { podId: string, contract: GraphContract }[], gates: GraphGate[]): GraphEdge[] {
  return edges([...members.map(member => ({ id: member.podId, takes: member.contract.takes, gives: member.contract.gives })), ...gates.map(gateNode)])
}
