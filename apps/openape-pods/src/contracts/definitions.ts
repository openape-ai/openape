import { parseGraphContract } from './graphs'
import { parsePackages } from './dependencies'
import { dataFields, dataKey, publicConfiguration } from './network-data'
import { workflowIdentity } from './workflow-ports'
import type { GraphContract } from './graphs'
import type { PackageManifest } from './dependencies'

export type DefinitionCommand =
  | { type: 'list' }
  | { type: 'adopt' }
  | { type: 'publish' | 'prepareLocal', podId: string, expectedScript: string, name: string, defaults: Record<string, unknown> }
  | { type: 'instantiate', requestId: string, definitionId: string, version: number, name: string, groupId: string }
  | { type: 'retryProvision', requestId: string }
  | { type: 'previewUpdate' | 'prepareUpdate', podId: string, definitionId: string, version: number, expectedBinding: number }
  | { type: 'activateUpdate', draftId: string, podId: string, expectedBinding: number }

export interface DefinitionVersionView { version: number, state: 'legacy' | 'published', contentHash: string, lockHash: string, contract: GraphContract | null, capabilities: string[], packages: PackageManifest, defaults: Record<string, unknown> }
export interface DefinitionView { id: string, name: string, versions: DefinitionVersionView[] }
export interface DefinitionInstanceView { podId: string, definitionId: string, version: number, bindingRevision: number, diverged: boolean, groupId: string | null }
export interface DefinitionUpdateView { podId: string, before: DefinitionVersionView, after: DefinitionVersionView, beforeCode: string, afterCode: string, changed: ('code' | 'contract' | 'dependencies' | 'defaults' | 'rights')[], draftId?: string }
export interface DefinitionsView { definitions: DefinitionView[], instances: DefinitionInstanceView[], provisioning: { requestId: string, podId: string, state: 'pending' | 'ready' | 'failed', error: string | null }[], unavailableReason?: string, createdPodId?: string, update?: DefinitionUpdateView }

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Invalid definition revision')
  return Number(value)
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || value.includes('\0')) throw new Error('Invalid definition name')
  return value.trim()
}
export function definitionDefaults(value: unknown): Record<string, unknown> {
  const input = dataFields(value, Object.keys(value && typeof value === 'object' ? value : {}))
  if (Object.keys(input).length > 32) throw new Error('Definition defaults exceed 32 fields')
  return Object.fromEntries(Object.entries(input).map(([key, item]) => [dataKey(key), publicConfiguration(item)]))
}
export function parseDefinitionCommand(value: unknown): DefinitionCommand {
  const kind = value && typeof value === 'object' ? (value as { type?: unknown }).type : undefined
  if (kind === 'list' || kind === 'adopt') { dataFields(value, ['type']); return { type: kind } }
  if (kind === 'publish' || kind === 'prepareLocal') {
    const input = dataFields(value, ['type', 'podId', 'expectedScript', 'name', 'defaults'])
    if (typeof input.expectedScript !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedScript)) throw new Error('Invalid published script hash')
    return { type: kind, podId: workflowIdentity(input.podId), expectedScript: input.expectedScript, name: name(input.name), defaults: definitionDefaults(input.defaults) }
  }
  if (kind === 'instantiate') {
    const input = dataFields(value, ['type', 'requestId', 'definitionId', 'version', 'name', 'groupId'])
    return { type: kind, requestId: workflowIdentity(input.requestId), definitionId: workflowIdentity(input.definitionId), version: revision(input.version), name: name(input.name), groupId: workflowIdentity(input.groupId) }
  }
  if (kind === 'retryProvision') {
    const input = dataFields(value, ['type', 'requestId'])
    return { type: kind, requestId: workflowIdentity(input.requestId) }
  }
  if (kind === 'previewUpdate' || kind === 'prepareUpdate') {
    const input = dataFields(value, ['type', 'podId', 'definitionId', 'version', 'expectedBinding'])
    return { type: kind, podId: workflowIdentity(input.podId), definitionId: workflowIdentity(input.definitionId), version: revision(input.version), expectedBinding: revision(input.expectedBinding) }
  }
  if (kind === 'activateUpdate') {
    const input = dataFields(value, ['type', 'draftId', 'podId', 'expectedBinding'])
    return { type: kind, draftId: workflowIdentity(input.draftId), podId: workflowIdentity(input.podId), expectedBinding: revision(input.expectedBinding) }
  }
  throw new Error('Unsupported definition command')
}

export function parseDefinitionsView(value: unknown): DefinitionsView {
  const input = dataFields(value, ['definitions', 'instances', 'provisioning'], ['createdPodId', 'update', 'unavailableReason'])
  if (!Array.isArray(input.definitions) || !Array.isArray(input.instances) || !Array.isArray(input.provisioning)) throw new Error('Invalid definition view')
  const hash = (value: unknown) => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid definition hash') }
  const version = (value: unknown) => {
    const item = dataFields(value, ['version', 'state', 'contentHash', 'lockHash', 'contract', 'capabilities', 'packages', 'defaults'])
    revision(item.version); hash(item.contentHash); hash(item.lockHash)
    if (!['legacy', 'published'].includes(String(item.state)) || !Array.isArray(item.capabilities) || item.capabilities.some(capability => typeof capability !== 'string')) throw new Error('Invalid definition version')
    if (item.contract !== null) parseGraphContract(item.contract)
    parsePackages(item.packages); definitionDefaults(item.defaults)
  }
  for (const item of input.definitions) {
    const definition = dataFields(item, ['id', 'name', 'versions'])
    workflowIdentity(definition.id); name(definition.name)
    if (!Array.isArray(definition.versions)) throw new Error('Invalid definition versions')
    definition.versions.forEach(version)
  }
  for (const item of input.instances) {
    const instance = dataFields(item, ['podId', 'definitionId', 'version', 'bindingRevision', 'diverged', 'groupId'])
    workflowIdentity(instance.podId); workflowIdentity(instance.definitionId); revision(instance.version); revision(instance.bindingRevision)
    if (typeof instance.diverged !== 'boolean') throw new Error('Invalid instance divergence state')
    if (instance.groupId !== null) workflowIdentity(instance.groupId)
  }
  for (const item of input.provisioning) {
    const pending = dataFields(item, ['requestId', 'podId', 'state', 'error'])
    workflowIdentity(pending.requestId); workflowIdentity(pending.podId)
    if (!['pending', 'ready', 'failed'].includes(String(pending.state)) || (pending.error !== null && (typeof pending.error !== 'string' || pending.error.length > 2000))) throw new Error('Invalid instance provisioning state')
  }
  if (input.unavailableReason !== undefined && (typeof input.unavailableReason !== 'string' || input.unavailableReason.length > 2000)) throw new Error('Invalid definition availability')
  if (input.createdPodId !== undefined) workflowIdentity(input.createdPodId)
  if (input.update !== undefined) {
    const update = dataFields(input.update, ['podId', 'before', 'after', 'beforeCode', 'afterCode', 'changed'], ['draftId'])
    workflowIdentity(update.podId); version(update.before); version(update.after)
    for (const code of [update.beforeCode, update.afterCode]) {
      if (typeof code !== 'string' || code.length > 200000) throw new Error('Invalid definition source preview')
    }
    if (update.draftId !== undefined) workflowIdentity(update.draftId)
    if (!Array.isArray(update.changed) || update.changed.some(field => !['code', 'contract', 'dependencies', 'defaults', 'rights'].includes(String(field)))) throw new Error('Invalid definition differences')
  }
  return structuredClone(input) as unknown as DefinitionsView
}

export function parseDefinitionProvision(value: unknown): { requestId: string, error: string | null } {
  const input = dataFields(value, ['requestId', 'error'])
  if (input.error !== null && (typeof input.error !== 'string' || !input.error || input.error.length > 2000)) throw new Error('Invalid definition provisioning receipt')
  return { requestId: workflowIdentity(input.requestId), error: input.error as string | null }
}
