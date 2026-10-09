import { randomUUID } from 'node:crypto'
import { canonicalPortableJson } from '@openape/pods-protocol'
import type { Owner, PortableComposition, PortableInput, PortableManifest, PortablePod } from '@openape/pods-protocol'
import type { NetworkDraft } from '../../contracts/networks'
import type { ScheduleSpec } from '../../contracts/scheduling'
import type { ResourceRegistry } from '../resources/registry'
import { PodVariables } from '../resources/variables'
import type { NetworkEngine } from '../scheduling/network-engine'
import type { PodDatabase } from '../storage/database'
import type { DefinitionCatalog } from '../workspace/definition-catalog'

export type PortableValue = string | number | boolean
export interface CompositionDocument {
  channels?: unknown
  routes?: unknown[]
  joins?: unknown[]
  feedback?: unknown[]
  values?: { name: string, input: string }[]
  members?: { pod: string, source: { schedule: unknown } | null, serialCase: boolean }[]
  formatVersion?: number
  collections?: { key: string, name: string, schema: string, retention: Record<string, unknown>, access: { pod: string, operations: string[] }[] }[]
  artifacts?: { key: string, collection: string | null, access: { pod: string, operations: string[] }[] }[]
}
// What finalization needs from the import: fresh Pod identities, declared values and bound aliases.
export interface CompositionContext {
  store: PodDatabase
  resources: ResourceRegistry
  owner: Owner
  manifest: PortableManifest
  podId: (key: string) => string
  value: (compositionKey: string, input: string) => PortableValue
}

// Native names allow 100 UTF-16 units; never cut a surrogate pair in half.
export const clip = (title: string): string => title.slice(0, 100).replace(/[\uD800-\uDBFF]$/, '')

// Whether a Pod variable, always a string, is a valid value of its declared input.
export function variableMatches(input: PortableInput, text: string | undefined): boolean {
  if (text === undefined) return false
  if (input.kind === 'number') return text.trim() !== '' && Number.isFinite(Number(text)) && (input.minimum === undefined || Number(text) >= input.minimum) && (input.maximum === undefined || Number(text) <= input.maximum)
  return input.kind === 'boolean' ? text === 'true' || text === 'false' : input.kind !== 'enum' || input.choices!.includes(text)
}

// Pod variables are strings; a declared number or boolean field takes its typed value.
export function typedValue(input: PortableInput, text: string): PortableValue {
  if (!variableMatches(input, text)) throw new Error(`Variable ${input.label} is not a valid value of its declared input`)
  if (input.kind === 'number') return Number(text)
  if (input.kind === 'boolean') return text === 'true'
  return text
}

// Member Pods of a composition must still be fresh instances: no network or run history that a group or binding change would disturb.
export function assertFreshMembers(context: CompositionContext, composition: PortableComposition): void {
  for (const node of composition.nodes) {
    const podId = context.podId(node.pod)
    if (context.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?1 UNION ALL SELECT 1 FROM runs WHERE pod_id=?1 UNION ALL SELECT 1 FROM schedules WHERE pod_id=?1 LIMIT 1').get(podId)) throw new Error('A member Pod already belongs to a network or has run history')
  }
}

export function assertApproved(context: CompositionContext, pod: PortablePod): { podId: string, hash: string } {
  const podId = context.podId(pod.key); const local = context.store.getPod(podId)
  if (local.lifecycle === 'archived' || !local.activeScript || !context.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, local.activeScript, local.bindingRevision, context.resources.epoch(podId))) throw new Error(`Validate and activate the script of ${pod.title} before creating this composition`)
  return { podId, hash: local.activeScript }
}

// Publishes each member's approved script as its definition with the package's declared fields. Publication adds an immutable version only.
async function publishMembers(context: CompositionContext, catalog: DefinitionCatalog, composition: PortableComposition): Promise<void> {
  for (const node of composition.nodes) {
    const pod = context.manifest.pods.find(item => item.key === node.pod)!
    const { podId, hash } = assertApproved(context, pod)
    const variables = new PodVariables(context.store).values(podId)
    const defaults = Object.fromEntries(pod.bindings.flatMap((binding) => {
      const input = pod.inputs.find(item => item.key === binding.input)!
      return ['string', 'number', 'boolean', 'enum'].includes(input.kind) && variables[binding.alias] !== undefined ? [[binding.alias, typedValue(input, variables[binding.alias]!)]] : []
    }))
    await catalog.publish(podId, hash, clip(pod.title), defaults)
  }
}

// Binds each member to its latest published version; the pinned script is the member's own active script, so nothing it runs changes.
function bindMembers(context: CompositionContext, composition: PortableComposition): void {
  for (const node of composition.nodes) {
    const podId = context.podId(node.pod)
    const binding = context.store.db.prepare('SELECT definition_id,definition_version FROM instance_definition_bindings WHERE pod_id=?').get(podId)!
    const version = context.store.db.prepare('SELECT max(version) AS version FROM pod_definition_versions WHERE definition_id=?').get(binding.definition_id!)!.version as number
    if (binding.definition_version !== version) context.store.db.prepare('UPDATE instance_definition_bindings SET definition_version=?,binding_revision=binding_revision+1 WHERE pod_id=?').run(version, podId)
  }
}

export function joinGroup(store: PodDatabase, podIds: string[], groupId: string): void {
  if (!store.db.prepare('SELECT 1 FROM pod_groups WHERE id=?').get(groupId)) throw new Error('A persistent network needs an existing group')
  let joined = false
  for (const podId of podIds) {
    const current = store.db.prepare('SELECT group_id FROM pod_memberships WHERE pod_id=?').get(podId)
    if (current && current.group_id !== groupId) throw new Error('A member Pod already belongs to another group')
    if (!current) { store.db.prepare('INSERT INTO pod_memberships VALUES(?,?)').run(podId, groupId); joined = true }
  }
  if (joined) store.db.prepare('UPDATE pod_organization SET revision=revision+1 WHERE id=1').run()
}

// Collections and artifact scopes are new owner records in the recipient's group; a name already in use is an explicit reuse decision, never an implicit attachment.
function grantData(context: CompositionContext, networkId: string, groupId: string, document: CompositionDocument, files: ReadonlyMap<string, Uint8Array>, reuse: Record<string, string>): void {
  const decoder = new TextDecoder('utf-8', { fatal: true }); const now = Date.now(); const collectionIds = new Map<string, string>()
  for (const collection of document.collections ?? []) {
    const schema = JSON.parse(decoder.decode(files.get(collection.schema)!)) as { schema: unknown, indexes: unknown }
    const existing = context.store.db.prepare('SELECT c.id,v.schema,v.indexes FROM data_collections c JOIN data_collection_versions v ON v.collection_id=c.id AND v.version=c.current_version WHERE c.owner_issuer=? AND c.owner_subject=? AND c.group_id=? AND c.name=?').get(context.owner.issuer, context.owner.subject, groupId, collection.name)
    let id: string
    if (existing) {
      if (reuse[collection.key] !== existing.id) throw new Error(`Collection ${collection.name} already exists in this group; choose to reuse it explicitly`)
      if (canonicalPortableJson(JSON.parse(existing.schema as string)) !== canonicalPortableJson(schema.schema) || canonicalPortableJson(JSON.parse(existing.indexes as string)) !== canonicalPortableJson(schema.indexes)) throw new Error(`Collection ${collection.name} has a different schema; a reused collection must match exactly`)
      id = existing.id as string
    }
    else {
      if (reuse[collection.key]) throw new Error('Reused collection no longer exists')
      id = randomUUID()
      context.store.db.prepare('INSERT INTO data_collections VALUES(?,?,?,?,?,1,?)').run(id, context.owner.issuer, context.owner.subject, groupId, collection.name, canonicalPortableJson(collection.retention))
      context.store.db.prepare('INSERT INTO data_collection_versions VALUES(?,1,?,?,?)').run(id, canonicalPortableJson(schema.schema), canonicalPortableJson(schema.indexes), now)
    }
    collectionIds.set(collection.key, id)
    for (const access of collection.access) {
      for (const operation of access.operations) context.store.db.prepare('INSERT INTO data_permissions VALUES(?,?,?,?,?,?,?,1)').run(networkId, context.podId(access.pod), id, context.owner.issuer, context.owner.subject, groupId, operation)
    }
  }
  for (const scope of document.artifacts ?? []) {
    const id = randomUUID()
    context.store.db.prepare('INSERT INTO artifact_scopes VALUES(?,?,?,?,?,?)').run(id, context.owner.issuer, context.owner.subject, groupId, scope.collection === null ? null : collectionIds.get(scope.collection)!, scope.collection === null ? networkId : null)
    for (const access of scope.access) {
      for (const operation of access.operations) context.store.db.prepare('INSERT INTO artifact_permissions VALUES(?,?,?,?,?,?,?,1)').run(networkId, context.podId(access.pod), id, context.owner.issuer, context.owner.subject, groupId, operation)
    }
  }
}

// Creates the imported persistent network paused with its shared values and data access. Activation stays a separate owner step.
// The native setup fingerprint cannot exist for fresh Pods that join their group and definition binding only here; the import review
// of the package's declared members, channels, values and access is the owner's reviewed setup instead.
export async function finalizeNetwork(context: CompositionContext, engines: { networks: NetworkEngine, catalog: DefinitionCatalog }, composition: PortableComposition, document: CompositionDocument, files: ReadonlyMap<string, Uint8Array>, groupId: string, reuse: Record<string, string>, record: (networkId: string) => void): Promise<void> {
  const members = document.members ?? []
  if (!context.store.db.prepare('SELECT 1 FROM pod_groups WHERE id=?').get(groupId)) throw new Error('A persistent network needs an existing group')
  for (const node of composition.nodes) assertApproved(context, context.manifest.pods.find(item => item.key === node.pod)!)
  assertFreshMembers(context, composition)
  await publishMembers(context, engines.catalog, composition)
  context.store.transaction(() => {
    assertFreshMembers(context, composition)
    const podIds = composition.nodes.map(node => context.podId(node.pod))
    joinGroup(context.store, podIds, groupId); bindMembers(context, composition)
    const sharedValues = Object.fromEntries((document.values ?? []).map(binding => [binding.name, typedValue(composition.inputs.find(input => input.key === binding.input)!, String(context.value(composition.key, binding.input)))]))
    const remap = (items: unknown[] | undefined) => (items ?? []).map((item) => { const { pod, ...fields } = item as { pod: string }; return { ...fields, podId: context.podId(pod) } })
    const draft: NetworkDraft = {
      name: clip(composition.title), groupId, channels: document.channels as NetworkDraft['channels'], sharedValues,
      members: members.map(member => ({ podId: context.podId(member.pod), source: member.source ? { schedule: member.source.schedule as ScheduleSpec | null } : null, serialCase: member.serialCase })),
      routes: document.routes as NetworkDraft['routes'], joins: remap(document.joins) as NetworkDraft['joins'], feedback: remap(document.feedback) as NetworkDraft['feedback'],
    }
    const networkId = engines.networks.execute({ type: 'create', draft }).createdId
    if (!networkId) throw new Error('Network creation returned no identity')
    grantData(context, networkId, groupId, document, files, reuse)
    record(networkId)
  })
}
