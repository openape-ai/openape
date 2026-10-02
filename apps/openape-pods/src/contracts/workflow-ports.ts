import type { GraphContract } from './graphs'
import type { WorkflowDefinition } from './workflows'
import { dataFields } from './network-data'
import { networkDataObject, parsePayloadSchema, validateNetworkPayload } from './network-payload'
import type { PayloadSchema } from './network-payload'

export interface WorkflowPort { name: string, version: number, schema: PayloadSchema, podId: string, legacySchema?: string }
export interface WorkflowPorts { version: 1, inputs: WorkflowPort[], outputs: WorkflowPort[], requiredTerminals: string[], requiredGates: string[] }
export interface WorkflowPortValue { version: number, data: Record<string, unknown> }

export function workflowIdentity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error('Invalid workflow port identity')
  return value
}

export function workflowPortName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value)) throw new Error('Invalid workflow port name')
  return value
}

function ports(value: unknown): WorkflowPort[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error('Workflow ports exceed their limit')
  const result = value.map((item) => {
    const input = dataFields(item, ['name', 'version', 'schema', 'podId'], ['legacySchema'])
    if (!Number.isSafeInteger(input.version) || Number(input.version) < 1 || Number(input.version) >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid workflow port version')
    if (input.legacySchema !== undefined && (typeof input.legacySchema !== 'string' || !/^[a-z][a-z0-9-]{0,63}\/v[1-9]\d*$/.test(input.legacySchema))) throw new Error('Invalid legacy workflow output schema')
    return { name: workflowPortName(input.name), version: input.version as number, schema: parsePayloadSchema(input.schema), podId: workflowIdentity(input.podId), ...(input.legacySchema === undefined ? {} : { legacySchema: input.legacySchema as string }) }
  })
  if (new Set(result.map(item => item.name)).size !== result.length) throw new Error('Duplicate workflow port name')
  return result.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

function identities(value: unknown, parse: (value: unknown) => string): string[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('Required workflow branches exceed their limit')
  const result = value.map(parse)
  if (new Set(result).size !== result.length) throw new Error('Duplicate required workflow branch')
  return result.sort()
}

export function parseWorkflowPorts(value: unknown): WorkflowPorts {
  const input = dataFields(value, ['version', 'inputs', 'outputs', 'requiredTerminals', 'requiredGates'])
  if (input.version !== 1) throw new Error('Unsupported workflow ports version')
  return { version: 1, inputs: ports(input.inputs), outputs: ports(input.outputs), requiredTerminals: identities(input.requiredTerminals, workflowIdentity), requiredGates: identities(input.requiredGates, workflowPortName) }
}

export function parseWorkflowPortValues(value: unknown, declarations: WorkflowPort[]): Record<string, WorkflowPortValue> {
  const input = networkDataObject(value)
  if (Object.keys(input).length !== declarations.length || Object.keys(input).some(name => !declarations.some(port => port.name === name))) throw new Error('Workflow input ports do not match the published revision')
  return Object.fromEntries(declarations.map((port) => {
    const item = dataFields(input[port.name], ['version', 'data'])
    if (item.version !== port.version) throw new Error('Workflow port schema version changed')
    return [port.name, { version: port.version, data: validateNetworkPayload(item.data, port.schema) }]
  }))
}

export function validateWorkflowPorts(definition: WorkflowDefinition, ports: WorkflowPorts): void {
  if (!ports.requiredTerminals.length) throw new Error('A called workflow requires an explicit terminal branch')
  const members = new Set(definition.nodes.map(node => node.podId))
  if ([...ports.inputs, ...ports.outputs].some(port => !members.has(port.podId)) || ports.requiredTerminals.some(id => !members.has(id))) throw new Error('Workflow ports and required branches must belong to the published workflow')
  if (ports.inputs.some(port => definition.nodes.find(node => node.podId === port.podId)!.after.length)) throw new Error('Workflow input ports must target entry nodes')
  if (ports.outputs.some(port => !ports.requiredTerminals.includes(port.podId))) throw new Error('Workflow output ports require a terminal branch')
  if (new Set(ports.outputs.map(port => port.podId)).size !== ports.outputs.length) throw new Error('Each workflow member publishes one immutable output')
  if (ports.requiredTerminals.some(id => definition.nodes.some(node => node.after.includes(id)))) throw new Error('Required workflow terminals cannot have successors')
  if (ports.requiredGates.some(key => !definition.gates.some(gate => gate.key === key))) throw new Error('Required workflow gate is not declared')
  if (definition.gates.some(gate => !ports.requiredGates.includes(gate.key))) throw new Error('Every called workflow decision must be explicitly required')
}

export function validateWorkflowGraphPorts(definition: WorkflowDefinition, ports: WorkflowPorts, nodes: (GraphContract & { id: string })[]): void {
  if (ports.inputs.some(port => nodes.find(node => node.id === port.podId)!.takes.length)) throw new Error('Workflow input ports must target entry nodes')
  if (definition.gates.some(gate => gate.kind === 'approve' && nodes.filter(node => node.takes.includes(gate.gives)).length !== 1)) throw new Error('Published approval gates require exactly one approval-channel consumer')
  const gates = definition.gates.map(gate => ({ id: `gate:${gate.key}`, takes: [gate.takes], gives: gate.kind === 'approve' ? [gate.gives, ...(gate.excluded ? [gate.excluded] : [])] : gate.options.map(option => option.channel) }))
  if (ports.requiredTerminals.some(id => nodes.find(node => node.id === id)!.gives.some(channel => [...nodes, ...gates].some(consumer => consumer.id !== id && consumer.takes.includes(channel))))) throw new Error('Required workflow terminals cannot have successors')
}
