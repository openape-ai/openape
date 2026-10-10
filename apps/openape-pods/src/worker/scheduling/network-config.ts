import type { SQLOutputValue } from 'node:sqlite'
import type { NetworkDefinition } from '../../contracts/networks'
import { networkSharedValues } from '../../contracts/network-operations'
import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { dataKey, publicConfiguration, secretReference } from '../../contracts/network-data'

export const emptyNetworkDataPin = digest(canonicalNetworkJson({ data: [], artifacts: [], config: {} }))

export function networkConfiguration(store: PodDatabase, networkId: string, podId: string) {
  const binding = store.db.prepare('SELECT b.definition_id,b.definition_version FROM network_members m JOIN instance_definition_bindings b ON b.pod_id=m.pod_id WHERE m.network_id=? AND m.pod_id=?').get(networkId, podId)
  if (!binding) throw new Error('Network configuration requires an explicit member')
  const declarations = store.db.prepare('SELECT name,kind,value FROM definition_config WHERE definition_id=? AND definition_version=? ORDER BY name').all(binding.definition_id!, binding.definition_version!)
  if (declarations.length > 32) throw new Error('Network configuration exceeds 32 fields')
  const composition = store.db.prepare('SELECT name,value FROM composition_config WHERE network_id=?').all(networkId)
  for (const item of composition) {
    if (!store.db.prepare(`SELECT 1 FROM network_members m JOIN instance_definition_bindings b ON b.pod_id=m.pod_id JOIN definition_config c ON c.definition_id=b.definition_id AND c.definition_version=b.definition_version WHERE m.network_id=? AND c.name=?`).get(networkId, item.name!)) throw new Error('Network configuration contains an undeclared override')
  }
  return resolveConfiguration(declarations.map(configurationRow), composition.map(configurationRow))
}

interface ConfigurationRow { name: string, value: string, kind?: string }
function configurationRow(row: Record<string, SQLOutputValue>): ConfigurationRow {
  return { name: row.name as string, value: row.value as string, kind: row.kind as string | undefined }
}

function resolveConfiguration(declarations: ConfigurationRow[], composition: ConfigurationRow[]) {
  if (declarations.length > 32) throw new Error('Network configuration exceeds 32 fields')
  const values = declarations.map((declaration) => {
    const name = dataKey(declaration.name)
    const composed = composition.find(item => item.name === name)
    const raw = JSON.parse((composed ?? declaration).value)
    const origin = composed ? 'composition' : 'definition'
    const value = declaration.kind === 'secret-reference' ? secretReference(raw) : publicConfiguration(raw)
    return [name, { value, origin, kind: declaration.kind }] as const
  })
  return Object.fromEntries(values)
}

export function validateNetworkCompositionValues(store: PodDatabase, definition: NetworkDefinition, input: unknown) {
  const shared = networkSharedValues(input)
  const members = definition.members.map(member => ({
    podId: member.podId,
    declarations: store.db.prepare('SELECT name,kind,value FROM definition_config WHERE definition_id=? AND definition_version=? ORDER BY name').all(member.definitionId, member.definitionVersion).map(configurationRow),
  }))
  const composition = Object.entries(shared).map(([name, value]) => {
    const declarations = members.flatMap(member => member.declarations.filter(field => field.name === name))
    if (!declarations.length || declarations.some(row => row.kind !== 'public')) throw new Error('Shared network values require a declared public field')
    if (declarations.some((row) => { const declared = JSON.parse(row.value); return (declared === null) !== (value === null) || typeof declared !== typeof value })) throw new Error('Shared value types must match every declaring definition')
    return { name, value: JSON.stringify(value) }
  })
  for (const member of members) resolveConfiguration(member.declarations, composition)
  return shared
}

/**
 * The shared string values of a network, which member scripts also read as context.variables.
 * Scripts of networks converted from graphs read their settings there, so the values stay available.
 */
export function networkVariables(store: PodDatabase, networkId: string): Record<string, string> {
  const fields = store.db.prepare('SELECT name,value FROM composition_config WHERE network_id=? ORDER BY name').all(networkId)
  return Object.fromEntries(fields.flatMap((field) => {
    const value: unknown = JSON.parse(field.value as string)
    return typeof value === 'string' ? [[field.name as string, value]] : []
  }))
}

export function networkDataPin(store: PodDatabase, networkId: string, podId: string): string {
  const data = store.db.prepare(`SELECT p.collection_id,p.operation,p.revision,c.current_version,v.schema,v.indexes FROM data_permissions p
    JOIN data_collections c ON c.id=p.collection_id JOIN data_collection_versions v ON v.collection_id=c.id AND v.version=c.current_version
    WHERE p.network_id=? AND p.pod_id=? ORDER BY p.collection_id,p.operation`).all(networkId, podId)
  const artifacts = store.db.prepare('SELECT p.scope_id,p.operation,p.revision,s.owner_issuer,s.owner_subject,s.group_id,s.collection_id,s.private_network_id FROM artifact_permissions p JOIN artifact_scopes s ON s.id=p.scope_id WHERE p.network_id=? AND p.pod_id=? ORDER BY p.scope_id,p.operation').all(networkId, podId)
  const variables = networkVariables(store, networkId)
  // The key name keeps the pins, and with them the open approvals, of converted networks unchanged.
  return digest(canonicalNetworkJson({ data, artifacts, config: networkConfiguration(store, networkId, podId), ...(Object.keys(variables).length ? { legacyVariables: variables } : {}) }))
}
