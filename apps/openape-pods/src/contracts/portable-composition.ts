import { canonicalPortableJson, portableKey } from '@openape/pods-protocol'
import type { PortableComposition, PortableManifest, PortablePod } from '@openape/pods-protocol'
import { collectionContract, dataFields, dataKey } from './network-data'
import { networkDataObject } from './network-payload'
import { diagnoseNetwork, networkFormatVersion, parseNetworkDefinition } from './networks'
import type { NetworkDefinition } from './networks'
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
function values(value: unknown, composition: PortableComposition): PortableValueBinding[] {
  const result = bounded(value, 32).map((value) => {
    const item = dataFields(value, ['name', 'input']); const name = localKey(item.name); const input = localKey(item.input)
    if (!composition.inputs.some(declaration => declaration.key === input && ['string', 'number', 'boolean', 'enum'].includes(declaration.kind))) throw new Error('Portable shared value requires a declared public input')
    return { name, input }
  })
  unique(result.map(item => item.name)); return result
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
  // Documents exported before issue 1455 (M4) carry an empty calls list.
  if (document.calls !== undefined && (!Array.isArray(document.calls) || document.calls.length)) throw new Error('Portable networks no longer call workflows')
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
  const references = values(document.values, composition).map(binding => binding.input)
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
  const document = dataFields(source, ['version', 'kind', 'formatVersion', 'channels', 'members', 'routes', 'joins', 'feedback', 'values', 'collections', 'artifacts'], ['legacyVariables', 'calls'])
  if (document.version !== 1 || document.kind !== 'network' || composition.kind !== 'network') throw new Error('Unsupported portable composition document version')
  for (const pod of manifest.pods) validatePortableAccessDefaults(pod)
  const ids = aliasMap(manifest)
  const definitionId = '00000000-0000-4000-8000-000000000100'
  const members = bounded(document.members, 32).map((value) => {
    const item = dataFields(value, ['pod', 'source', 'serialCase']); const podId = memberReference(item.pod, composition, ids)
    const pod = manifest.pods.find(pod => pod.key === item.pod)!
    if (pod.requestedCapabilities.some(right => right !== 'mail.read')) throw new Error('Portable network member requests unsupported runtime capabilities')
    let source = null
    if (item.source !== null) { const timer = dataFields(item.source, ['schedule']); source = { bindingId: podId, schedule: timer.schedule === null ? null : parseSchedule(timer.schedule) } }
    return { podId, definitionId: podId, definitionVersion: 1, bindingRevision: 1, contract: pod.contract, source, serialCase: item.serialCase }
  })
  if (members.length !== composition.nodes.length) throw new Error('Portable document membership differs from its index')
  if (document.formatVersion !== networkFormatVersion) throw new Error('Portable network document uses an older format; export it again from the current version')
  const joins = bounded(document.joins, 32).map((value) => { const item = dataFields(value, ['id', 'pod', 'channels', 'deadlineMs', 'reviewDestination']); const { pod, ...fields } = item; return { ...fields, podId: memberReference(pod, composition, ids) } })
  const feedback = bounded(document.feedback, 32).map((value) => { const item = dataFields(value, ['id', 'pod', 'channel', 'delayMs', 'maxHops', 'maxCaseAgeMs']); const { pod, ...fields } = item; return { ...fields, podId: memberReference(pod, composition, ids) } })
  const definition: NetworkDefinition = parseNetworkDefinition({ formatVersion: networkFormatVersion, kind: 'network', semantics: 'persistent-network-v1', id: definitionId, revision: 1, groupId: definitionId, name: composition.title, members, channels: document.channels, routes: document.routes, joins, feedback })
  const diagnostics = diagnoseNetwork(definition)
  if (diagnostics.length) throw new Error(`Portable network diagnostics: ${diagnostics.map(item => item.code).join(', ')}`)
  networkValues(document.values, composition, manifest); dataDeclarations(document, composition, ids)
  // Older documents list the shared string values scripts read as variables; every shared string value is one now.
  const variables = document.legacyVariables === undefined ? [] : bounded(document.legacyVariables, 32).map(localKey)
  unique(variables)
  const shared = values(document.values, composition)
  if (variables.some(name => !shared.some(binding => binding.name === name && composition.inputs.some(input => input.key === binding.input && input.kind === 'string')))) throw new Error('Portable legacy variables require declared shared string inputs')
  inputUsage(document, composition)
  return document
}

export function validatePortableCollectionDocument(value: unknown) {
  const item = dataFields(JSON.parse(canonicalPortableJson(value)), ['version', 'schema', 'indexes'])
  if (item.version !== 1) throw new Error('Unsupported portable collection document version')
  return collectionContract(item.schema, item.indexes)
}
