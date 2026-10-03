import type { PortableExportChoices } from '../../contracts/sharing'
import { canonicalPortableJson, portableKey } from '@openape/pods-protocol'
import type { PortableComposition } from '@openape/pods-protocol'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { WorkflowPorts } from '../../contracts/workflow-ports'
import type { PortableSource } from './source'
import { mapPortablePod, PortableInputs } from './pod'
import type { PortableExportContent } from './export'
import type { PortablePayload } from './package'

export type { PortableCompositionChoices, PortableExportChoices } from '../../contracts/sharing'

function jsonPayload(path: string, kind: 'composition' | 'data-schema', value: unknown): PortablePayload {
  return { path, kind, mediaType: 'application/json', content: Buffer.from(canonicalPortableJson(value)) }
}

export async function mapPortableSource(root: string, source: PortableSource, choices: PortableExportChoices): Promise<PortableExportContent> {
  if (choices.pods.length !== source.pods.length || new Set(choices.pods.map(item => item.podId)).size !== source.pods.length) throw new Error('Portable Pod choices must match every source member once')
  const keys = new Map(choices.pods.map(item => [item.podId, portableKey(item.key)]))
  const podKey = (id: string): string => {
    const key = keys.get(id)
    if (!key) throw new Error('Portable composition refers to an unpackaged Pod')
    return key
  }
  const mapped: Awaited<ReturnType<typeof mapPortablePod>>[] = []
  for (const pod of source.pods) {
    const choice = choices.pods.find(item => item.podId === pod.pod.id)
    if (!choice) throw new Error('Portable Pod choices must match every source member once')
    const item = await mapPortablePod(root, pod, choice, source.network?.configuration.find(item => item.podId === pod.pod.id)?.fields)
    if (source.selection.kind !== 'pod') item.pod.schedule = null
    mapped.push(item)
  }
  const payloads = mapped.flatMap(item => item.payloads)
  const compositions: PortableComposition[] = []
  const compositionChoices = new Map(choices.compositions.map(item => [item.id, item]))
  if (compositionChoices.size !== choices.compositions.length) throw new Error('Duplicate portable composition selection')
  const choiceFor = (id: string) => {
    const choice = compositionChoices.get(id)
    if (!choice) throw new Error('Choose a portable key for every included composition')
    portableKey(choice.key)
    return choice
  }
  const workflowDocument = (workflow: WorkflowDefinition, ports: WorkflowPorts | null) => {
    const choice = choiceFor(workflow.id); const inputs = new PortableInputs(choice.defaults)
    const composition: PortableComposition = { key: choice.key, kind: workflow.mode, title: choice.title ?? workflow.name, document: `compositions/${choice.key}.json`, documentVersion: 1, nodes: workflow.nodes.map(node => ({ pod: podKey(node.podId), after: node.after.map(podKey), handoff: node.handoff })), calls: [], inputs: [], dataSchemas: [] }
    const mappedPorts = ports ? { ...ports, inputs: ports.inputs.map(({ podId, ...port }) => ({ ...port, pod: podKey(podId) })), outputs: ports.outputs.map(({ podId, ...port }) => ({ ...port, pod: podKey(podId) })), requiredTerminals: ports.requiredTerminals.map(podKey) } : null
    let mail = null
    if (workflow.mail) {
      const policy = workflow.mail
      const filter = choices.pods.find(pod => pod.podId === policy.filterPodId)
      const application = filter?.aliases.find(item => item.resourceId === policy.applicationId)?.alias
      if (!application) throw new Error('Portable mail policy requires an explicit application alias')
      mail = { filter: podKey(policy.filterPodId), notify: podKey(policy.notifyPodId), application, telegramCredential: policy.telegramCredential, mode: policy.mode,
        mailbox: inputs.add('mail:mailbox', 'Mailbox', 'string', policy.mailbox), telegramChat: inputs.add('mail:telegramChat', 'Notification destination', 'string', policy.telegramChatId),
        protectedPartners: inputs.add('mail:protectedPartners', 'Protected partners', 'string', canonicalPortableJson(policy.protectedPartners)), rules: inputs.add('mail:rules', 'Archive rules', 'string', canonicalPortableJson(policy.rules)) }
    }
    const values = workflow.values.map(value => ({ name: value.name, input: inputs.add(`value:${value.name}`, value.name, 'string', value.value) }))
    composition.inputs = inputs.finish()
    const document = workflow.mode === 'sequence' ? { version: 1, kind: 'sequence', schedule: workflow.schedule, ports: mappedPorts, mail } : { version: 1, kind: 'channels', schedule: workflow.schedule, channels: workflow.channels, gates: workflow.gates, values, ports: mappedPorts }
    if ((workflow.mode === 'sequence' && values.length) || (workflow.mode === 'channels' && mail !== null)) throw new Error('Portable workflow contains unsupported mode-specific configuration')
    compositions.push(composition); payloads.push(jsonPayload(composition.document, 'composition', document))
  }
  if (source.workflow) workflowDocument(source.workflow, null)
  for (const call of source.calls) workflowDocument(call.published.definition, call.published.ports)
  if (source.network) {
    const network = source.network; const definition = network.definition
    const choice = choiceFor(definition.id); const inputs = new PortableInputs(choice.defaults)
    const collectionKeys = new Map(network.collections.map((collection, index) => [String(collection.id), `collection_${index + 1}`]))
    const scopeKeys = new Map(network.scopes.map((scope, index) => [String(scope.id), `artifacts_${index + 1}`]))
    const composition: PortableComposition = { key: choice.key, kind: 'network', title: choice.title ?? definition.name, document: `compositions/${choice.key}.json`, documentVersion: 1, nodes: definition.members.map(member => ({ pod: podKey(member.podId), after: [], handoff: false })), calls: source.calls.map(call => choiceFor(call.workflowId).key), inputs: [], dataSchemas: [] }
    const access = (rows: { pod_id: unknown, operation: unknown }[]) => Array.from(new Set(rows.map(row => String(row.pod_id))), id => ({ pod: podKey(id), operations: rows.filter(row => row.pod_id === id).map(row => String(row.operation)) }))
    const collections = network.collections.map((collection) => {
      const key = collectionKeys.get(String(collection.id))!; const schema = `data/${choice.key}/${key}.json`
      payloads.push(jsonPayload(schema, 'data-schema', { version: 1, schema: JSON.parse(String(collection.schema)), indexes: JSON.parse(String(collection.indexes)) }))
      composition.dataSchemas.push(schema)
      return { key, name: String(collection.name), schema, retention: JSON.parse(String(collection.retention)), access: access(network.dataPermissions.filter(permission => permission.collection_id === collection.id) as { pod_id: unknown, operation: unknown }[]) }
    })
    const artifacts = network.scopes.map((scope) => {
      const collection = scope.collection_id === null ? null : collectionKeys.get(String(scope.collection_id))
      if (collection === undefined) throw new Error('Portable artifact scope refers to an undeclared collection')
      return { key: scopeKeys.get(String(scope.id))!, collection, access: access(network.artifactPermissions.filter(permission => permission.scope_id === scope.id) as { pod_id: unknown, operation: unknown }[]) }
    })
    const values = network.sharedValues.map((value, index) => {
      const kind = typeof value.value
      if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') throw new Error('Portable shared configuration requires public scalars')
      const input = inputs.add(`value:${value.name}`, value.name, kind, value.value)
      const declaration = inputs.declarations.find(item => item.key === input)!
      for (const member of network.configuration.filter(member => member.fields[value.name]?.origin === 'composition')) {
        const pod = mapped.find(item => item.pod.key === podKey(member.podId))!.pod
        const binding = pod.bindings.find(item => item.alias === value.name)
        const field = pod.inputs.find(item => item.key === binding?.input)
        if (!field || field.kind !== kind) throw new Error('Portable shared input no longer matches its member declaration')
        declaration.sharingGroup = `shared_${compositions.length + 1}_${index + 1}`
        field.sharingGroup = declaration.sharingGroup
        delete field.default
        if (declaration.default !== undefined) field.default = declaration.default
      }
      return { name: value.name, input }
    })
    const document = { version: 1, kind: 'network', formatVersion: definition.formatVersion, channels: definition.channels,
      members: definition.members.map(member => ({ pod: podKey(member.podId), source: member.source ? { schedule: member.source.schedule } : null, serialCase: member.serialCase })),
      gates: (definition.gates ?? []).map(({ podId, ...gate }) => ({ ...gate, pod: podKey(podId) })), joins: (definition.joins ?? []).map(({ podId, ...join }) => ({ ...join, pod: podKey(podId) })),
      ...(definition.feedback ? { feedback: definition.feedback.map(({ podId, ...item }) => ({ ...item, pod: podKey(podId) })) } : {}),
      values, legacyVariables: Object.keys(network.legacyVariables).sort(), collections, artifacts, calls: network.calls.map(call => ({ pod: podKey(String(call.pod_id)), workflow: choiceFor(String(call.workflow_id)).key })) }
    composition.inputs = inputs.finish()
    compositions.push(composition); payloads.push(jsonPayload(composition.document, 'composition', document))
  }
  if (compositions.length !== choices.compositions.length) throw new Error('Portable composition choices include an unrelated source')
  const entry = source.selection.kind === 'pod' ? { kind: 'pod' as const, key: podKey(source.selection.id) } : { kind: source.network ? 'network' as const : source.workflow!.mode, key: choiceFor(source.selection.id).key }
  return { description: { format: 'openape-package', version: 1, package: choices.package, requiredFeatures: ['portable_aliases_v1'], entry, pods: mapped.map(item => item.pod), compositions, applications: mapped.flatMap(item => item.applications) }, payloads }
}
