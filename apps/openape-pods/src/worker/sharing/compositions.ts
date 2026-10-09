import { randomUUID } from 'node:crypto'
import { canonicalPortableJson } from '@openape/pods-protocol'
import type { Owner, PortableComposition, PortableInput, PortableManifest, PortablePod } from '@openape/pods-protocol'
import { parseMailWorkflowConfiguration } from '../../contracts/mail-workflow'
import type { NetworkDraft } from '../../contracts/networks'
import { parseWorkflowCommand } from '../../contracts/workflows'
import type { WorkflowCommand, WorkflowSchedule } from '../../contracts/workflows'
import type { ScheduleSpec } from '../../contracts/scheduling'
import type { ResourceRegistry } from '../resources/registry'
import { PodVariables } from '../resources/variables'
import type { NetworkEngine } from '../scheduling/network-engine'
import type { PodDatabase } from '../storage/database'
import type { DefinitionCatalog } from '../workspace/definition-catalog'
import type { WorkflowEngine } from '../workflows/engine'

export type PortableValue = string | number | boolean
export interface CompositionDocument {
  schedule: WorkflowSchedule | null
  ports?: unknown
  mail?: { filter: string, notify: string, application: string, telegramCredential: string, mode: 'preview' | 'archive', mailbox: string, telegramChat: string, protectedPartners: string, rules: string } | null
  channels?: unknown
  gates?: unknown[]
  routes?: unknown[]
  joins?: unknown[]
  feedback?: unknown[]
  values?: { name: string, input: string }[]
  members?: { pod: string, source: { schedule: unknown } | null, serialCase: boolean }[]
  formatVersion?: number
  collections?: { key: string, name: string, schema: string, retention: Record<string, unknown>, access: { pod: string, operations: string[] }[] }[]
  artifacts?: { key: string, collection: string | null, access: { pod: string, operations: string[] }[] }[]
  calls?: { pod: string, workflow: string }[]
}
// What finalization needs from the import: fresh Pod identities, declared values, bound aliases and already created workflows.
export interface CompositionContext {
  store: PodDatabase
  resources: ResourceRegistry
  owner: Owner
  manifest: PortableManifest
  podId: (key: string) => string
  value: (compositionKey: string, input: string) => PortableValue
  workflowId: (compositionKey: string) => string | undefined
}

// Native names allow 100 UTF-16 units; never cut a surrogate pair in half.
export const clip = (title: string): string => title.slice(0, 100).replace(/[\uD800-\uDBFF]$/, '')

// Networks, called workflows and mail policies need approved member scripts and are created after Pod setup completes.
export function needsApprovedMembers(manifest: PortableManifest, composition: PortableComposition, document: CompositionDocument): boolean {
  return composition.kind === 'network' || document.ports !== null || document.mail != null || manifest.compositions.some(item => item.calls.includes(composition.key))
}

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

// Member Pods of a composition must still be fresh instances: no network, workflow or run history that a group or binding change would disturb.
export function assertFreshMembers(context: CompositionContext, composition: PortableComposition): void {
  for (const node of composition.nodes) {
    const podId = context.podId(node.pod)
    if (context.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?1 UNION ALL SELECT 1 FROM workflow_members WHERE pod_id=?1 UNION ALL SELECT 1 FROM runs WHERE pod_id=?1 UNION ALL SELECT 1 FROM schedules WHERE pod_id=?1 LIMIT 1').get(podId)) throw new Error('A member Pod already belongs to a network or workflow or has run history')
  }
}

function mailConfiguration(context: CompositionContext, composition: PortableComposition, document: CompositionDocument) {
  const mail = document.mail
  if (!mail) return null
  const filter = context.manifest.pods.find(pod => pod.key === mail.filter)!
  const application = context.resources.aliases(context.podId(filter.key)).find(item => item.alias === mail.application)
  if (application?.resource.state !== 'ready' || application.resource.configuration.type !== 'program') throw new Error('Bind the mail filter application before creating this workflow')
  const text = (input: string) => String(context.value(composition.key, input))
  return parseMailWorkflowConfiguration({ mailbox: text(mail.mailbox), filterPodId: context.podId(mail.filter), notifyPodId: context.podId(mail.notify), applicationId: application.resource.id, telegramCredential: mail.telegramCredential, telegramChatId: text(mail.telegramChat), protectedPartners: JSON.parse(text(mail.protectedPartners)), rules: JSON.parse(text(mail.rules)), mode: mail.mode })
}

// The native definition of a sequence or channel graph from its package document.
export function workflowCommand(context: CompositionContext, composition: PortableComposition, document: CompositionDocument, id: string, groupId: string | null) {
  const values = (document.values ?? []).map(binding => ({ name: binding.name, value: String(context.value(composition.key, binding.input)), revision: 0 }))
  return parseWorkflowCommand({ type: 'save', id, revision: 0, name: clip(composition.title), nodes: composition.nodes.map(node => ({ podId: context.podId(node.pod), after: node.after.map(context.podId), handoff: node.handoff })), schedule: document.schedule, enabled: false, mail: mailConfiguration(context, composition, document),
    ...(composition.kind === 'channels' ? { mode: 'channels', groupId, channels: document.channels, gates: document.gates, values } : {}) }) as Extract<WorkflowCommand, { type: 'save' }>
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

// Publishes a called workflow's ports as an immutable revision and grants the declared network members their call.
function grantCalls(context: CompositionContext, workflows: WorkflowEngine, networkId: string, groupId: string, calls: { pod: string, workflow: string }[], files: ReadonlyMap<string, Uint8Array>): void {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (const key of new Set(calls.map(call => call.workflow))) {
    const composition = context.manifest.compositions.find(item => item.key === key)!; const workflowId = context.workflowId(key)
    if (!workflowId) throw new Error('Create the called workflow before the network that calls it')
    for (const node of composition.nodes) assertApproved(context, context.manifest.pods.find(item => item.key === node.pod)!)
    const document = JSON.parse(decoder.decode(files.get(composition.document)!)) as CompositionDocument & { ports: { inputs: { pod: string }[], outputs: { pod: string }[], requiredTerminals: string[] } | null }
    if (!document.ports) throw new Error('A called workflow needs declared ports')
    // A call is only honored for a workflow of the network's own group whose members belong to that group.
    const current = context.store.db.prepare('SELECT group_id FROM workflows WHERE id=? AND archived=0').get(workflowId)
    if (current?.group_id !== groupId || composition.nodes.some(node => context.store.db.prepare('SELECT group_id FROM pod_memberships WHERE pod_id=?').get(context.podId(node.pod))?.group_id !== groupId)) throw new Error('The called workflow must belong to the group of the network that calls it')
    const ports = { ...document.ports, inputs: document.ports.inputs.map(({ pod, ...port }) => ({ ...port, podId: context.podId(pod) })), outputs: document.ports.outputs.map(({ pod, ...port }) => ({ ...port, podId: context.podId(pod) })), requiredTerminals: document.ports.requiredTerminals.map(context.podId) }
    const definition = workflows.view().workflows.find(item => item.id === workflowId)
    if (!definition) throw new Error('The called workflow no longer exists')
    const revision = workflows.publishRevision(workflowId, definition.revision, ports).revision
    for (const call of calls.filter(call => call.workflow === key)) {
      context.store.db.prepare('INSERT INTO workflow_call_permissions VALUES(?,?,?,?,?,?,?,1,1)').run(workflowId, revision, networkId, context.podId(call.pod), context.owner.issuer, context.owner.subject, groupId)
    }
  }
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

// Creates the imported persistent network paused with its shared values, data access and workflow calls. Activation stays a separate owner step.
// The native setup fingerprint cannot exist for fresh Pods that join their group and definition binding only here; the import review
// of the package's declared members, channels, values and access is the owner's reviewed setup instead.
export async function finalizeNetwork(context: CompositionContext, engines: { networks: NetworkEngine, workflows: WorkflowEngine, catalog: DefinitionCatalog }, composition: PortableComposition, document: CompositionDocument, files: ReadonlyMap<string, Uint8Array>, groupId: string, reuse: Record<string, string>, record: (networkId: string) => void): Promise<void> {
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
    grantCalls(context, engines.workflows, networkId, groupId, document.calls ?? [], files)
    record(networkId)
  })
}
