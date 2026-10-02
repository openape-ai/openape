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
