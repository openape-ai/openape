import type { PortableSourceSelection } from '../../contracts/sharing'
import { parseOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { homedir } from 'node:os'
import { canonicalJson } from '../../contracts/canonical-json'
import { emptyPackages, parsePackages } from '../../contracts/dependencies'
import { parseSchedule } from '../../contracts/scheduling'
import { ResourceRegistry } from '../resources/registry'
import { PodVariables } from '../resources/variables'
import { DefinitionCatalog } from '../workspace/definition-catalog'
import { ItemTagStore } from '../workspace/item-tags'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'

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
  const content = new TextDecoder('utf-8', { fatal: true }).decode(store.readBlob(pod.activeScript))
  if (content.length > 200000) throw new Error('Portable script exceeds the native character limit')
  const dependency = store.db.prepare(`SELECT s.dependency_hash,d.manifest,d.lockfile FROM script_dependencies s
    LEFT JOIN dependency_sets d ON d.pod_id=s.pod_id AND d.hash=s.dependency_hash WHERE s.pod_id=? AND s.script_hash=?`).get(id, pod.activeScript)
  if (dependency && (!dependency.manifest || !dependency.lockfile)) throw new Error('Portable source dependency lock is unavailable or changed')
  const packages = dependency ? parsePackages(JSON.parse(String(dependency.manifest))) : emptyPackages()
  const binding = store.db.prepare('SELECT definition_id,definition_version,binding_revision FROM instance_definition_bindings WHERE pod_id=?').get(id) ?? null
  const definitions = binding ? store.db.prepare('SELECT name,kind,value FROM definition_config WHERE definition_id=? AND definition_version=? ORDER BY name').all(binding.definition_id!, binding.definition_version!) : []
  const schedule = store.db.prepare('SELECT revision,spec FROM schedules WHERE pod_id=?').get(id)
  return { pod, manifest, content, tags: new ItemTagStore(store).own(id), resourceEpoch, resources: resources.list(id), variables: new PodVariables(store).list(id), binding, definitions, schedule: schedule ? { revision: Number(schedule.revision), spec: parseSchedule(JSON.parse(String(schedule.spec))) } : null, packages, dependencyHash: dependency ? String(dependency.dependency_hash) : null, lock: dependency ? String(dependency.lockfile) : null }
}
export type PortablePodSource = ReturnType<typeof podSource>

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
  if (selection.kind !== 'pod' || !/^[a-f0-9-]{36}$/.test(selection.id)) throw new Error('Invalid portable source selection')
  return store.transaction(() => {
    const resources = new ResourceRegistry(store, () => { throw new Error('Portable source capture cannot mutate resources') })
    const catalog = new DefinitionCatalog(store, resources, owner)
    const pods = [podSource(store, resources, catalog, selection.id)]
    const source = { owner, selection: { ...selection }, pods }
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
    localReferences({ pods: pods.map(({ content: _content, lock: _lock, ...pod }) => pod) }, privateReferences)
    for (const pod of pods) {
      for (const variable of pod.variables) remember(variable.value)
      for (const field of [...pod.definitions.filter(field => field.kind === 'public')]) remember(JSON.parse(String(field.value)))
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
    const fingerprintSource = {
      ...source,
      pods: pods.map(item => ({ ...item, pod: { ...item.pod, lifecycle: 'paused' } })),
    }
    return { ...source, fingerprint: digest(canonicalJson(fingerprintSource)), privateReferences: [...privateReferences].sort(), privateValues: [...privateValues].sort() }
  })
}
export type PortableSource = ReturnType<typeof capturePortableSource>
