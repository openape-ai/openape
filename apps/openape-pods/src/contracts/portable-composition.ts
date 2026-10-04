import { canonicalPortableJson, portableKey } from '@openape/pods-protocol'
import type { PortableComposition, PortableManifest, PortableNode, PortablePod } from '@openape/pods-protocol'
import { collectionContract, dataFields, dataKey } from './network-data'
import { networkDataObject } from './network-payload'
import { diagnoseGraph, parseGraphChannels, parseGraphGates, parseGraphValues } from './graphs'
import { diagnoseNetwork, parseNetworkDefinition } from './networks'
import type { NetworkDefinition } from './networks'
import { parseWorkflowNodes, parseWorkflowSchedule, sequenceParts } from './workflows'
import type { WorkflowDefinition } from './workflows'
import { parseWorkflowPorts, validateWorkflowGraphPorts, validateWorkflowPorts } from './workflow-ports'
import { parseSchedule } from './scheduling'
import { parseHttpPermission } from './http'
import { parseJevModel } from './jev'
import { parseSince } from './onboarding'

export interface PortableValueBinding { name: string, input: string }
export interface PortableDataAccess { pod: string, operations: string[] }
export interface PortableCollection { key: string, name: string, schema: string, retention: Record<string, unknown>, access: PortableDataAccess[] }
export interface PortableArtifactScope { key: string, collection: string | null, access: PortableDataAccess[] }

function bounded(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Portable composition list exceeds its limit')
  return value
}
const localKey = portableKey

function unique(values: string[]): void { if (new Set(values).size !== values.length) throw new Error('Duplicate portable composition key') }
function aliasMap(manifest: PortableManifest): Map<string, string> {
  return new Map(manifest.pods.map((pod, index) => [pod.key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]))
}
function memberReference(value: unknown, composition: PortableComposition, ids: Map<string, string>): string {
  const key = localKey(value)
  if (!composition.nodes.some(node => node.pod === key)) throw new Error('Portable reference is not a composition member')
  return ids.get(key)!
}
function nodes(source: PortableNode[], ids: Map<string, string>) {
  return parseWorkflowNodes(source.map(node => ({ podId: ids.get(node.pod), after: node.after.map(key => ids.get(key)), handoff: node.handoff })))
}
function values(value: unknown, composition: PortableComposition): PortableValueBinding[] {
  const result = bounded(value, 32).map((value) => {
    const item = dataFields(value, ['name', 'input']); const name = localKey(item.name); const input = localKey(item.input)
    if (!composition.inputs.some(declaration => declaration.key === input && ['string', 'number', 'boolean', 'enum'].includes(declaration.kind))) throw new Error('Portable shared value requires a declared public input')
    return { name, input }
  })
  unique(result.map(item => item.name)); return result
}
function ports(value: unknown, composition: PortableComposition, ids: Map<string, string>, definition: WorkflowDefinition) {
  if (value === null) return null
  const item = dataFields(value, ['version', 'inputs', 'outputs', 'requiredTerminals', 'requiredGates'])
  const parse = (value: unknown) => bounded(value, 16).map((value) => {
    const port = dataFields(value, ['name', 'version', 'schema', 'pod'], ['legacySchema'])
    const { pod, ...fields } = port
    return { ...fields, podId: memberReference(pod, composition, ids) }
  })
  const mapped = parseWorkflowPorts({ ...item, inputs: parse(item.inputs), outputs: parse(item.outputs), requiredTerminals: bounded(item.requiredTerminals, 32).map(key => memberReference(key, composition, ids)) })
  validateWorkflowPorts(definition, mapped)
  return mapped
}
function mail(value: unknown, composition: PortableComposition, manifest: PortableManifest): void {
  if (value === null) return
  const item = dataFields(value, ['filter', 'notify', 'application', 'mailbox', 'telegramCredential', 'telegramChat', 'protectedPartners', 'rules', 'mode'])
  const filter = manifest.pods.find(pod => pod.key === item.filter && composition.nodes.some(node => node.pod === pod.key))
  const notify = manifest.pods.find(pod => pod.key === item.notify && composition.nodes.some(node => node.pod === pod.key))
  if (!filter || !notify || filter === notify || !filter.applications.some(application => application.alias === item.application) || (item.mode !== 'preview' && item.mode !== 'archive')) throw new Error('Invalid portable mail member or application binding')
  const ancestors = new Set<string>(); const pending = [...composition.nodes.find(node => node.pod === notify.key)!.after]
  while (pending.length) { const key = pending.pop()!; if (ancestors.has(key)) continue; ancestors.add(key); pending.push(...composition.nodes.find(node => node.pod === key)!.after) }
  if (!ancestors.has(filter.key)) throw new Error('Mail notification must depend on the configured filter pod')
  for (const key of ['mailbox', 'telegramChat', 'protectedPartners', 'rules']) {
    if (!composition.inputs.some(input => input.key === item[key] && input.kind === 'string')) throw new Error('Portable mail configuration requires explicit string inputs')
  }
  unique(['mailbox', 'telegramChat', 'protectedPartners', 'rules'].map(key => String(item[key])))
  const binding = notify.bindings.find(binding => binding.alias === item.telegramCredential)
  if (typeof item.telegramCredential !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(item.telegramCredential) || !binding || !notify.inputs.some(input => input.key === binding.input && input.kind === 'secret')) throw new Error('Portable notification requires a recipient secret input')
}
function requestedData(value: unknown, composition: PortableComposition, ids: Map<string, string>, operations: string[], allowEmpty = false): PortableDataAccess[] {
  const access = bounded(value, 32).map((value) => {
    const item = dataFields(value, ['pod', 'operations']); memberReference(item.pod, composition, ids)
    const requested = bounded(item.operations, operations.length).map(localKey)
    if (!requested.length || requested.some(operation => !operations.includes(operation))) throw new Error('Unsupported portable data operation')
    unique(requested); return { pod: item.pod as string, operations: requested }
  })
  if (!access.length && !allowEmpty) throw new Error('Portable data declaration requires requested access')
  unique(access.map(item => item.pod)); return access
}
function dataDeclarations(document: Record<string, unknown>, composition: PortableComposition, ids: Map<string, string>): void {
  const collections = bounded(document.collections, 32).map((value) => {
    const item = dataFields(value, ['key', 'name', 'schema', 'retention', 'access']); localKey(item.key); dataKey(item.name); networkDataObject(item.retention)
    if (typeof item.schema !== 'string' || !composition.dataSchemas.includes(item.schema)) throw new Error('Portable collection requires a declared schema file')
    requestedData(item.access, composition, ids, ['read', 'write', 'delete'], true)
    return item
  })
  unique(collections.map(item => String(item.key)))
  unique(collections.map(item => String(item.name)))
  if (composition.dataSchemas.some(path => !collections.some(collection => collection.schema === path))) throw new Error('Unreferenced portable collection schema')
  const artifacts = bounded(document.artifacts, 32).map((value) => {
    const item = dataFields(value, ['key', 'collection', 'access']); localKey(item.key)
    if (item.collection !== null && !collections.some(collection => collection.key === item.collection)) throw new Error('Portable artifact scope refers to an undeclared collection')
    requestedData(item.access, composition, ids, ['read', 'create']); return item
  })
  unique(artifacts.map(item => String(item.key)))
  const calls = bounded(document.calls, 32).map((value) => {
    const item = dataFields(value, ['pod', 'workflow']); memberReference(item.pod, composition, ids)
    if (typeof item.workflow !== 'string' || !composition.calls.includes(item.workflow)) throw new Error('Undeclared portable workflow call')
    return item
  })
  unique(calls.map(item => `${item.pod}:${item.workflow}`))
  if (composition.calls.some(key => !calls.some(call => call.workflow === key))) throw new Error('Unreferenced portable workflow call')
}

function networkValues(value: unknown, composition: PortableComposition, manifest: PortableManifest): void {
  const scalarKind = (kind: string) => kind === 'enum' ? 'string' : kind
  for (const binding of values(value, composition)) {
    const input = composition.inputs.find(input => input.key === binding.input)!
    const declarations = composition.nodes.flatMap((node) => {
      const pod = manifest.pods.find(pod => pod.key === node.pod)!
      return pod.bindings.filter(item => item.alias === binding.name).map(item => pod.inputs.find(input => input.key === item.input)!)
    })
    if (!declarations.length || declarations.some(input => !['string', 'number', 'boolean', 'enum'].includes(input.kind))) throw new Error('Shared network values require a declared public field')
    if (declarations.some(declaration => scalarKind(declaration.kind) !== scalarKind(input.kind))) throw new Error('Shared value types must match every declaring definition')
  }
}

function inputUsage(document: Record<string, unknown>, composition: PortableComposition): void {
  const references = composition.kind === 'sequence'
    ? document.mail === null ? [] : ['mailbox', 'telegramChat', 'protectedPartners', 'rules'].map(key => (document.mail as Record<string, unknown>)[key])
    : values(document.values, composition).map(binding => binding.input)
  if (composition.inputs.some(input => !references.includes(input.key))) throw new Error('Unreferenced portable composition input')
}

export function validatePortableAccessDefaults(pod: PortablePod): void {
  if (pod.schedule) parseSchedule(pod.schedule)
  const value = (key: string) => pod.inputs.find(input => input.key === key)!.default
  for (const request of pod.access) {
    if (request.kind === 'http' && value(request.origin) !== undefined) parseHttpPermission({ origin: value(request.origin), methods: request.methods })
    if (request.kind === 'http' && request.authentication && value(request.authentication.issuer) !== undefined) parseHttpPermission({ origin: value(request.authentication.issuer), methods: ['POST'] })
    if (request.kind === 'jev' && value(request.model) !== undefined) parseJevModel(value(request.model))
    if (request.kind === 'mail' && value(request.since) !== undefined) parseSince(value(request.since) === '' ? null : value(request.since))
  }
}

export function validatePortableCompositionDocument(value: unknown, composition: PortableComposition, manifest: PortableManifest): Record<string, unknown> {
  const source = JSON.parse(canonicalPortableJson(value))
  const document = dataFields(source, composition.kind === 'network'
    ? ['version', 'kind', 'formatVersion', 'channels', 'members', 'gates', 'joins', 'values', 'legacyVariables', 'collections', 'artifacts', 'calls']
    : composition.kind === 'channels' ? ['version', 'kind', 'schedule', 'channels', 'gates', 'values', 'ports'] : ['version', 'kind', 'schedule', 'ports', 'mail'], composition.kind === 'network' ? ['feedback'] : [])
  if (document.version !== 1 || document.kind !== composition.kind) throw new Error('Unsupported portable composition document version')
  for (const pod of manifest.pods) validatePortableAccessDefaults(pod)
  const ids = aliasMap(manifest)
  const definitionId = '00000000-0000-4000-8000-000000000100'
  if (composition.kind === 'network') {
    const members = bounded(document.members, 32).map((value) => {
      const item = dataFields(value, ['pod', 'source', 'serialCase']); const podId = memberReference(item.pod, composition, ids)
      const pod = manifest.pods.find(pod => pod.key === item.pod)!
      if (pod.requestedCapabilities.some(right => right !== 'mail.read')) throw new Error('Portable network member requests unsupported runtime capabilities')
      let source = null
      if (item.source !== null) { const timer = dataFields(item.source, ['schedule']); source = { bindingId: podId, schedule: timer.schedule === null ? null : parseSchedule(timer.schedule) } }
      return { podId, definitionId: podId, definitionVersion: 1, bindingRevision: 1, contract: pod.contract, source, serialCase: item.serialCase }
    })
    if (members.length !== composition.nodes.length) throw new Error('Portable document membership differs from its index')
    const gates = bounded(document.gates, 32).map((value) => { const item = dataFields(value, ['key', 'title', 'kind', 'pod', 'channel']); const { pod, ...fields } = item; return { ...fields, podId: memberReference(pod, composition, ids) } })
    const joins = bounded(document.joins, 32).map((value) => { const item = dataFields(value, ['id', 'pod', 'channels', 'deadlineMs', 'reviewDestination']); const { pod, ...fields } = item; return { ...fields, podId: memberReference(pod, composition, ids) } })
    const feedback = bounded(document.feedback ?? [], 32).map((value) => { const item = dataFields(value, ['id', 'pod', 'channel', 'delayMs', 'maxHops', 'maxCaseAgeMs']); const { pod, ...fields } = item; return { ...fields, podId: memberReference(pod, composition, ids) } })
    if ((document.formatVersion === 1 && gates.length) || (Number(document.formatVersion) < 3 && joins.length) || (document.formatVersion !== 4) !== !Object.hasOwn(document, 'feedback')) throw new Error('Portable network controls require their native format version')
    const definition: NetworkDefinition = parseNetworkDefinition({ formatVersion: document.formatVersion, kind: 'network', semantics: 'persistent-network-v1', id: definitionId, revision: 1, groupId: definitionId, name: composition.title, members, channels: document.channels, ...(Number(document.formatVersion) >= 2 ? { gates } : {}), ...(Number(document.formatVersion) >= 3 ? { joins } : {}), ...(document.formatVersion === 4 ? { feedback } : {}) })
    const diagnostics = diagnoseNetwork(definition)
    if (diagnostics.length) throw new Error(`Portable network diagnostics: ${diagnostics.map(item => item.code).join(', ')}`)
    networkValues(document.values, composition, manifest); dataDeclarations(document, composition, ids)
    const legacyVariables = bounded(document.legacyVariables, 32).map(localKey)
    unique(legacyVariables)
    const shared = values(document.values, composition)
    if (legacyVariables.some(name => !shared.some(binding => binding.name === name && composition.inputs.some(input => input.key === binding.input && input.kind === 'string')))) throw new Error('Portable legacy variables require declared shared string inputs')
    inputUsage(document, composition)
    return document
  }
  if (composition.calls.length || composition.dataSchemas.length) throw new Error('Only persistent networks declare scoped data and workflow calls')
  const definition: WorkflowDefinition = { ...sequenceParts, id: definitionId, revision: 1, name: composition.title, nodes: nodes(composition.nodes, ids), schedule: document.schedule === null ? null : parseWorkflowSchedule(document.schedule), enabled: false, paused: true, nextAt: null }
  if (composition.kind === 'sequence') {
    mail(document.mail, composition, manifest)
  }
  else {
    definition.mode = 'channels'; definition.groupId = definitionId
    definition.channels = parseGraphChannels(document.channels); definition.gates = parseGraphGates(document.gates)
    definition.values = parseGraphValues(values(document.values, composition).map(binding => ({ name: binding.name, value: '', revision: 0 })))
    const contracts = Object.fromEntries(composition.nodes.map(node => [ids.get(node.pod)!, manifest.pods.find(pod => pod.key === node.pod)!.contract]))
    const facts = Object.fromEntries(composition.nodes.map(node => [ids.get(node.pod)!, { variables: manifest.pods.find(pod => pod.key === node.pod)!.bindings.filter(binding => manifest.pods.find(pod => pod.key === node.pod)!.inputs.some(input => input.key === binding.input && ['string', 'number', 'boolean', 'enum'].includes(input.kind))).map(binding => binding.alias) }]))
    const diagnostics = diagnoseGraph(definition, contracts, facts)
    if (diagnostics.length) throw new Error(`Portable graph diagnostics: ${diagnostics.map(item => item.code).join(', ')}`)
  }
  const declaredPorts = ports(document.ports, composition, ids, definition)
  if (declaredPorts && composition.kind === 'channels') {
    validateWorkflowGraphPorts(definition, declaredPorts, composition.nodes.map(node => ({ id: ids.get(node.pod)!, ...manifest.pods.find(pod => pod.key === node.pod)!.contract! })))
  }
  if (manifest.compositions.some(item => item.calls.includes(composition.key)) && document.ports === null) throw new Error('Called portable workflows require declared ports')
  inputUsage(document, composition)
  return document
}

export function validatePortableCollectionDocument(value: unknown) {
  const item = dataFields(JSON.parse(canonicalPortableJson(value)), ['version', 'schema', 'indexes'])
  if (item.version !== 1) throw new Error('Unsupported portable collection document version')
  return collectionContract(item.schema, item.indexes)
}
