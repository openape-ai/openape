import { createHash } from 'node:crypto'
import { dataFields } from '../../contracts/network-data'
import { parseWorkflowPorts, workflowIdentity } from '../../contracts/workflow-ports'
import type { WorkflowPorts } from '../../contracts/workflow-ports'
import { parseWorkflowCommand } from '../../contracts/workflows'
import { parseGraphContract } from '../../contracts/graphs'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'

export interface WorkflowNodePin { podId: string, scriptHash: string, bindingRevision: number, resourceEpoch: number }
export interface PublishedWorkflow { version: 1, definition: WorkflowDefinition, ports: WorkflowPorts, pins: WorkflowNodePin[] }
export interface WorkflowRevision { workflowId: string, revision: number, contentHash: string, published: PublishedWorkflow }

function pinNodes(store: PodDatabase, definition: WorkflowDefinition): WorkflowNodePin[] {
  return definition.nodes.map((node) => {
    const pod = store.getPod(node.podId)
    if (!pod.activeScript || pod.lifecycle === 'archived') throw new Error('Published workflow members require active scripts')
    const resourceEpoch = Number(store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(pod.id)?.epoch ?? 0)
    if (!store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(pod.id, pod.activeScript, pod.bindingRevision, resourceEpoch)) throw new Error('Validate every workflow pod before publishing')
    return { podId: pod.id, scriptHash: pod.activeScript, bindingRevision: pod.bindingRevision, resourceEpoch }
  })
}

function validatePorts(definition: WorkflowDefinition, ports: WorkflowPorts): void {
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

function validateGraphPorts(store: PodDatabase, published: PublishedWorkflow): void {
  if (published.definition.mode !== 'channels') return
  const nodes = published.pins.map((pin) => {
    const script = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pin.podId, pin.scriptHash)
    if (!script) throw new Error('Published workflow member script is unavailable')
    return { id: pin.podId, ...parseGraphContract(JSON.parse(script.manifest as string).contract) }
  })
  if (published.ports.inputs.some(port => nodes.find(node => node.id === port.podId)!.takes.length)) throw new Error('Workflow input ports must target entry nodes')
  if (published.definition.gates.some(gate => gate.kind === 'approve' && nodes.filter(node => node.takes.includes(gate.gives)).length !== 1)) throw new Error('Published approval gates require exactly one approval-channel consumer')
  const gates = published.definition.gates.map(gate => ({ id: `gate:${gate.key}`, takes: [gate.takes], gives: gate.kind === 'approve' ? [gate.gives, ...(gate.excluded ? [gate.excluded] : [])] : gate.options.map(option => option.channel) }))
  if (published.ports.requiredTerminals.some(id => nodes.find(node => node.id === id)!.gives.some(channel => [...nodes, ...gates].some(consumer => consumer.id !== id && consumer.takes.includes(channel))))) throw new Error('Required workflow terminals cannot have successors')
}

export function publishWorkflowRevision(store: PodDatabase, definition: WorkflowDefinition, value: unknown, now: number): WorkflowRevision {
  const ports = parseWorkflowPorts(value)
  validatePorts(definition, ports)
  return store.transaction(() => {
    const current = store.db.prepare('SELECT revision,archived FROM workflows WHERE id=?').get(definition.id)
    if (!current || current.archived === 1 || current.revision !== definition.revision) throw new Error('Workflow changed; reload before publishing')
    const composition: WorkflowDefinition = { ...structuredClone(definition), revision: 1, schedule: null, enabled: false, paused: false, nextAt: null, values: definition.values.map(value => ({ ...value, revision: 1 })) }
    const published: PublishedWorkflow = { version: 1, definition: composition, ports, pins: pinNodes(store, definition) }
    validateGraphPorts(store, published)
    const body = JSON.stringify(published)
    const contentHash = createHash('sha256').update(body).digest('hex')
    const identical = store.db.prepare('SELECT revision FROM workflow_revisions WHERE workflow_id=? AND content_hash=? AND definition=? ORDER BY revision LIMIT 1').get(definition.id, contentHash, body)
    if (identical) return { workflowId: definition.id, revision: Number(identical.revision), contentHash, published }
    const revision = Number(store.db.prepare('SELECT coalesce(max(revision),0)+1 AS revision FROM workflow_revisions WHERE workflow_id=?').get(definition.id)!.revision)
    if (revision > 1000) throw new Error('Published workflow revision limit reached')
    store.db.prepare('INSERT INTO workflow_revisions VALUES(?,?,?,?,?)').run(definition.id, revision, body, contentHash, now)
    return { workflowId: definition.id, revision, contentHash, published }
  })
}

export function loadWorkflowRevision(store: PodDatabase, workflowId: string, revision: number): WorkflowRevision {
  workflowIdentity(workflowId)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid immutable workflow revision')
  const row = store.db.prepare('SELECT definition,content_hash FROM workflow_revisions WHERE workflow_id=? AND revision=?').get(workflowId, revision)
  if (!row) throw new Error('Published workflow revision not found')
  const body = String(row.definition)
  if (createHash('sha256').update(body).digest('hex') !== row.content_hash) throw new Error('Published workflow revision digest changed')
  const input = dataFields(JSON.parse(body), ['version', 'definition', 'ports', 'pins'])
  if (input.version !== 1) throw new Error('Unsupported published workflow version')
  const saved = dataFields(input.definition, ['id', 'revision', 'name', 'nodes', 'schedule', 'enabled', 'paused', 'nextAt', 'mode', 'groupId', 'channels', 'gates', 'values'], ['mail'])
  const { paused, nextAt, ...editable } = saved
  if (typeof paused !== 'boolean' || (nextAt !== null && (!Number.isSafeInteger(nextAt) || Number(nextAt) < 0))) throw new Error('Invalid published workflow state')
  const command = parseWorkflowCommand({ ...editable, type: 'save' })
  if (command.type !== 'save' || command.id !== workflowId) throw new Error('Published workflow identity changed')
  const definition = saved as unknown as WorkflowDefinition
  const ports = parseWorkflowPorts(input.ports)
  validatePorts(definition, ports)
  if (!Array.isArray(input.pins) || input.pins.length !== definition.nodes.length) throw new Error('Published workflow pins do not match its members')
  const pins = input.pins.map((value) => {
    const pin = dataFields(value, ['podId', 'scriptHash', 'bindingRevision', 'resourceEpoch'])
    if (typeof pin.scriptHash !== 'string' || !/^[a-f0-9]{64}$/.test(pin.scriptHash) || !Number.isSafeInteger(pin.bindingRevision) || Number(pin.bindingRevision) < 0 || !Number.isSafeInteger(pin.resourceEpoch) || Number(pin.resourceEpoch) < 0) throw new Error('Invalid published workflow member pin')
    return { podId: workflowIdentity(pin.podId), scriptHash: pin.scriptHash, bindingRevision: pin.bindingRevision as number, resourceEpoch: pin.resourceEpoch as number }
  })
  if (new Set(pins.map(pin => pin.podId)).size !== pins.length || pins.some(pin => !definition.nodes.some(node => node.podId === pin.podId))) throw new Error('Published workflow pin identity changed')
  const published: PublishedWorkflow = { version: 1, definition, ports, pins }
  validateGraphPorts(store, published)
  return { workflowId, revision, contentHash: row.content_hash as string, published }
}
