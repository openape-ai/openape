import type { PortableSourceSelection } from '../../contracts/sharing'
import { parseOwner, sharingLimits } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { homedir } from 'node:os'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { parseNetworkDefinition } from '../../contracts/networks'
import { parseGraphContract } from '../../contracts/graphs'
import { emptyPackages, parsePackages } from '../../contracts/dependencies'
import { parseSchedule } from '../../contracts/scheduling'
import { ResourceRegistry } from '../resources/registry'
import { PodVariables } from '../resources/variables'
import { DefinitionCatalog } from '../workspace/definition-catalog'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import { networkConfiguration } from '../scheduling/network-config'

export type { PortableSourceSelection } from '../../contracts/sharing'

function podSource(store: PodDatabase, resources: ResourceRegistry, catalog: DefinitionCatalog, id: string) {
  catalog.assertPod(id)
  const pod = store.getPod(id)
  if (pod.lifecycle === 'archived' || !pod.activeScript) throw new Error('Portable export requires a current active script')
  const resourceEpoch = resources.epoch(id)
  if (!store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(id, pod.activeScript, pod.bindingRevision, resourceEpoch)) throw new Error('Validate the current Pod before exporting')
  const script = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(id, pod.activeScript)
  if (!script) throw new Error('Portable source script is missing')
  const manifest = parseManifest(JSON.parse(String(script.manifest)))
  if (manifest.contentHash !== pod.activeScript || manifest.assignmentRevision !== pod.bindingRevision) throw new Error('Portable source script binding changed')
  if (manifest.contract) manifest.contract = parseGraphContract(manifest.contract)
  const content = new TextDecoder('utf-8', { fatal: true }).decode(store.readBlob(pod.activeScript))
  if (content.length > 200000) throw new Error('Portable script exceeds the native character limit')
  const dependency = store.db.prepare(`SELECT s.dependency_hash,d.manifest,d.lockfile FROM script_dependencies s
    LEFT JOIN dependency_sets d ON d.pod_id=s.pod_id AND d.hash=s.dependency_hash WHERE s.pod_id=? AND s.script_hash=?`).get(id, pod.activeScript)
  if (dependency && (!dependency.manifest || !dependency.lockfile)) throw new Error('Portable source dependency lock is unavailable or changed')
  const packages = dependency ? parsePackages(JSON.parse(String(dependency.manifest))) : emptyPackages()
  const binding = store.db.prepare('SELECT definition_id,definition_version,binding_revision FROM instance_definition_bindings WHERE pod_id=?').get(id) ?? null
  const definitions = binding ? store.db.prepare('SELECT name,kind,value FROM definition_config WHERE definition_id=? AND definition_version=? ORDER BY name').all(binding.definition_id!, binding.definition_version!) : []
  const overrides = store.db.prepare('SELECT name,value FROM instance_config WHERE pod_id=? ORDER BY name').all(id)
  const schedule = store.db.prepare('SELECT revision,spec FROM schedules WHERE pod_id=?').get(id)
  return { pod, manifest, content, resourceEpoch, resources: resources.list(id), variables: new PodVariables(store).list(id), binding, definitions, overrides, schedule: schedule ? { revision: Number(schedule.revision), spec: parseSchedule(JSON.parse(String(schedule.spec))) } : null, packages, dependencyHash: dependency ? String(dependency.dependency_hash) : null, lock: dependency ? String(dependency.lockfile) : null }
}
export type PortablePodSource = ReturnType<typeof podSource>

function networkSource(store: PodDatabase, owner: Owner, id: string) {
  const row = store.db.prepare(`SELECT n.state,r.contract,r.content_hash FROM networks n JOIN network_revisions r ON r.network_id=n.id AND r.revision=n.revision
    WHERE n.id=? AND n.owner_issuer=? AND n.owner_subject=? AND n.state!='archived'`).get(id, owner.issuer, owner.subject)
  if (!row) throw new Error('Network is unavailable to this export owner')
  const definition = parseNetworkDefinition(JSON.parse(String(row.contract)))
  if (definition.id !== id || digest(String(row.contract)) !== row.content_hash) throw new Error('Portable network revision digest changed')
  const collections = store.db.prepare(`SELECT c.id,c.name,c.current_version,c.retention,v.schema,v.indexes FROM data_collections c
    JOIN data_collection_versions v ON v.collection_id=c.id AND v.version=c.current_version WHERE c.id IN (
      SELECT collection_id FROM data_permissions WHERE network_id=? UNION
      SELECT s.collection_id FROM artifact_permissions p JOIN artifact_scopes s ON s.id=p.scope_id WHERE p.network_id=? AND s.collection_id IS NOT NULL
    ) ORDER BY c.id`).all(id, id)
  const dataPermissions = store.db.prepare('SELECT pod_id,collection_id,operation,revision FROM data_permissions WHERE network_id=? ORDER BY pod_id,collection_id,operation').all(id)
  const scopes = store.db.prepare(`SELECT DISTINCT s.id,s.collection_id,s.private_network_id FROM artifact_permissions p JOIN artifact_scopes s ON s.id=p.scope_id WHERE p.network_id=? ORDER BY s.id`).all(id)
  if (scopes.some(scope => scope.private_network_id !== null && scope.private_network_id !== id)) throw new Error('Portable artifact scope belongs to another private network')
  const artifactPermissions = store.db.prepare('SELECT pod_id,scope_id,operation,revision FROM artifact_permissions WHERE network_id=? ORDER BY pod_id,scope_id,operation').all(id)
  const configuration = definition.members.map(member => ({ podId: member.podId, fields: networkConfiguration(store, id, member.podId) }))
  const sharedValues = store.db.prepare('SELECT name,value FROM composition_config WHERE network_id=? ORDER BY name').all(id).map(row => ({ name: String(row.name), value: JSON.parse(String(row.value)) as unknown }))
  return { definition, state: String(row.state), collections, dataPermissions, scopes, artifactPermissions, configuration, sharedValues }
}

function localReferences(value: unknown, references: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|\bpod-app-[a-f0-9]{16}\b/gi)) {
      references.add(match[0]); references.add(match[0].replaceAll('-', ''))
    }
  }
  else if (Array.isArray(value)) {
    for (const item of value) localReferences(item, references)
  }
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) localReferences(item, references)
  }
}

export function capturePortableSource(store: PodDatabase, ownerValue: Owner, selection: PortableSourceSelection) {
  const owner = parseOwner(ownerValue)
  if (!['pod', 'network'].includes(selection.kind) || !/^[a-f0-9-]{36}$/.test(selection.id)) throw new Error('Invalid portable source selection')
  return store.transaction(() => {
    const resources = new ResourceRegistry(store, () => { throw new Error('Portable source capture cannot mutate resources') })
    const catalog = new DefinitionCatalog(store, resources, owner)
    const network = selection.kind === 'network' ? networkSource(store, owner, selection.id) : null
    const ids = network?.definition.members.map(member => member.podId) ?? [selection.id]
    if (ids.length > sharingLimits.pods) throw new Error('Portable export exceeds the Pod limit')
    const pods = ids.map(id => podSource(store, resources, catalog, id))
    for (const member of network?.definition.members ?? []) {
      const current = pods.find(item => item.pod.id === member.podId)!
      const definition = catalog.source(member.definitionId, member.definitionVersion)
      if (current.binding?.binding_revision !== member.bindingRevision || definition.view.contentHash !== current.pod.activeScript || definition.view.lockHash !== current.manifest.dependencyLockHash || definition.dependencyHash !== current.dependencyHash || current.binding?.definition_id !== member.definitionId || current.binding?.definition_version !== member.definitionVersion) throw new Error('Network member no longer matches its published definition')
    }
    const source = { owner, selection: { ...selection }, pods, network }
    const privateReferences = new Set([store.root, homedir(), owner.subject])
    const privateValues = new Set<string>()
    const remember = (value: unknown): void => {
      if (typeof value === 'string' && value.length >= 4) {
        privateValues.add(value)
      }
      else if (Array.isArray(value)) {
        for (const item of value) remember(item)
      }
      else if (value && typeof value === 'object') {
        for (const item of Object.values(value)) remember(item)
      }
    }
    localReferences({ pods: pods.map(({ content: _content, lock: _lock, ...pod }) => pod), network }, privateReferences)
    for (const pod of pods) {
      for (const variable of pod.variables) remember(variable.value)
      for (const field of [...pod.definitions.filter(field => field.kind === 'public'), ...pod.overrides]) remember(JSON.parse(String(field.value)))
      for (const resource of pod.resources) {
        const paths = resource.kind === 'reference' || resource.kind === 'directory' ? [resource.configuration.path] : resource.configuration.type === 'program' ? [resource.configuration.executable, resource.configuration.adapterPath, resource.configuration.bundlePath] : []
        for (const path of paths) {
          if (typeof path === 'string') privateReferences.add(path)
        }
        remember(resource.configuration.account)
        for (const key of ['origin', 'model', 'folders']) {
          const value = resource.configuration[key]
          remember(value)
          if (Array.isArray(value)) {
            for (const item of value) remember(item)
          }
        }
        if (resource.configuration.type === 'program' && resource.configuration.environment && typeof resource.configuration.environment === 'object') {
          for (const value of Object.values(resource.configuration.environment)) remember(value)
        }
        const authentication = resource.configuration.authentication
        if (authentication && typeof authentication === 'object') remember(authentication)
      }
    }
    for (const field of network?.sharedValues ?? []) remember(field.value)
    const fingerprintSource = {
      ...source,
      pods: pods.map(item => ({ ...item, pod: { ...item.pod, lifecycle: 'paused' } })),
      network: network ? { ...network, state: 'paused' } : null,
    }
    return { ...source, fingerprint: digest(canonicalNetworkJson(fingerprintSource)), privateReferences: [...privateReferences].sort(), privateValues: [...privateValues].sort() }
  })
}
export type PortableSource = ReturnType<typeof capturePortableSource>
