import { sharingLimits } from '@openape/pods-protocol'
import type { PortableManifest } from '@openape/pods-protocol'

// Export choices and findings are plain data shared by the worker, the main process and both workspaces.
export interface PortableSourceSelection { kind: 'pod' | 'network', id: string }
export interface PortableAssetSelection { resourceId: string, path: string, mediaType: string }
export interface PortablePodChoices { podId: string, key: string, title?: string, description: string, defaults: string[], aliases: { resourceId: string, alias: string }[], assets: PortableAssetSelection[], omittedReferences?: string[] }
export interface PortableCompositionChoices { id: string, key: string, title?: string, defaults: string[] }
export interface PortableExportChoices { package: PortableManifest['package'], pods: PortablePodChoices[], compositions: PortableCompositionChoices[] }
export interface PortableScanFinding { id: string, path: string, line: number | null, kind: 'local-reference' | 'local-path' | 'private-key' | 'private-value' | 'possible-credential' | 'opaque-asset', severity: 'block' | 'review' }

export type PortableValue = string | number | boolean
export type PortableImportValues = Record<'pods' | 'compositions', Record<string, Record<string, PortableValue | null>>>
// name is the input key of a value, the alias of a secret, access or application, otherwise null.
export interface PortableImportRequirement { scope: 'pod' | 'composition', key: string, requirement: 'value' | 'secret' | 'access' | 'application' | 'dependencies' | 'composition', name: string | null }
export interface PortableImportView {
  id: string
  state: 'staged' | 'committed' | 'completed' | 'cancelled'
  revision: number
  transferSha256: string
  manifest: PortableManifest
  pods: { key: string, podId: string }[]
  compositions: { key: string, networkId: string | null }[]
  // Compositions created only after Pod setup and member approval.
  deferred: string[]
  values: PortableImportValues
  unresolved: PortableImportRequirement[]
  error: string | null
}
export interface PortableImportState { imports: PortableImportView[], current?: PortableImportView, inspected?: { manifest: PortableManifest, transferSha256: string } }
export type PortableImportCommand =
  | { type: 'list' }
  | { type: 'show', id: string }
  | { type: 'inspect', archive: Uint8Array }
  | { type: 'stage', id: string, archive: Uint8Array }
  | { type: 'configure', id: string, revision: number, values: PortableImportValues }
  | { type: 'commit' | 'complete' | 'cancel', id: string, revision: number }
  // bundle is what the main process read from the assigned application bundle itself, or null for other assignments.
  | { type: 'bind', id: string, revision: number, pod: string, alias: string, resourceId: string, bundle: { identity: string, executableHash: string } | null }
  | { type: 'prepareDependencies', id: string, pod: string }
  // reuse maps a package collection key to an existing collection the recipient explicitly attaches instead of creating a new one.
  | { type: 'finalize', id: string, revision: number, composition: string, groupId: string | null, reuse: Record<string, string> }

const shapes: Record<PortableImportCommand['type'], string[]> = { list: [], show: ['id'], inspect: ['archive'], stage: ['id', 'archive'], configure: ['id', 'revision', 'values'], commit: ['id', 'revision'], complete: ['id', 'revision'], cancel: ['id', 'revision'], bind: ['id', 'revision', 'pod', 'alias', 'resourceId', 'bundle'], prepareDependencies: ['id', 'pod'], finalize: ['id', 'revision', 'composition', 'groupId', 'reuse'] }
const identity = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
const name = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 64
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function values(value: unknown): boolean {
  if (!plain(value) || Object.keys(value).some(key => key !== 'pods' && key !== 'compositions') || !plain(value.pods) || !plain(value.compositions)) return false
  const members = [...Object.entries(value.pods), ...Object.entries(value.compositions)]
  return members.length <= sharingLimits.pods * 2 && members.every(([key, entries]) => name(key) && plain(entries) && Object.keys(entries).length <= sharingLimits.inputs
    && Object.entries(entries).every(([input, item]) => name(input) && (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || (typeof item === 'string' && item.length <= sharingLimits.valueCharacters))))
}

export function parsePortableImportCommand(value: unknown): PortableImportCommand {
  if (!plain(value) || typeof value.type !== 'string' || !Object.hasOwn(shapes, value.type)) throw new Error('Invalid import command')
  const fields = shapes[value.type as PortableImportCommand['type']]
  const valid = Object.keys(value).length === fields.length + 1 && fields.every((field) => {
    const item = value[field]
    if (field === 'id' || field === 'resourceId') return identity(item)
    if (field === 'groupId') return item === null || identity(item)
    if (field === 'reuse') return plain(item) && Object.keys(item).length <= 32 && Object.entries(item).every(([key, value]) => name(key) && identity(value))
    if (field === 'revision') return Number.isSafeInteger(item) && Number(item) > 0
    if (field === 'bundle') return item === null || (plain(item) && Object.keys(item).length === 2 && typeof item.identity === 'string' && item.identity.length > 0 && item.identity.length <= 255 && typeof item.executableHash === 'string' && /^[a-f0-9]{64}$/.test(item.executableHash))
    if (field === 'archive') return item instanceof Uint8Array && item.byteLength > 0 && item.byteLength <= sharingLimits.transferBytes
    return field === 'values' ? values(item) : name(item)
  })
  if (!valid) throw new Error('Invalid import command')
  return value as PortableImportCommand
}

// Export: what the owner can select and parameterize, the frozen review and the saved file.
export interface PortableSourceView {
  selection: PortableSourceSelection
  pods: { podId: string, name: string, references: { id: string, name: string }[], aliasable: { id: string, kind: string, name: string }[], variables: string[], configuration: string[] }[]
  compositions: { id: string, kind: 'network', name: string }[]
}
export interface PortableExportReviewView { id: string, manifest: PortableManifest, findings: PortableScanFinding[], expiresAt: number }
export type PortableExportCommand =
  | { type: 'inspectSource', selection: PortableSourceSelection }
  | { type: 'review', selection: PortableSourceSelection, choices: PortableExportChoices }
  | { type: 'download', id: string, acknowledgedFindings: string[] }
  | { type: 'discard', id: string }
// pickFile is handled by the main process, which opens the file dialog and stages the chosen package.
export type SharingCommand = ({ scope: 'import' } & (PortableImportCommand | { type: 'pickFile' })) | ({ scope: 'export' } & PortableExportCommand)
export interface SharingState { imports: PortableImportView[], current?: PortableImportView, inspected?: { manifest: PortableManifest, transferSha256: string }, source?: PortableSourceView, review?: PortableExportReviewView, archive?: Uint8Array, saved?: string | null }

const selection = (value: unknown): value is PortableSourceSelection => plain(value) && Object.keys(value).length === 2 && ['pod', 'network'].includes(String(value.kind)) && identity(value.id)
function choices(value: unknown): value is PortableExportChoices {
  if (!plain(value) || Object.keys(value).length !== 3 || !plain(value.package) || !Array.isArray(value.pods) || !Array.isArray(value.compositions) || value.pods.length > sharingLimits.pods || value.compositions.length > 64) return false
  const text = (item: unknown, limit: number) => typeof item === 'string' && item.length <= limit
  const keys = (items: unknown) => Array.isArray(items) && items.length <= 64 && items.every(item => text(item, 240))
  return text(value.package.key, 64) && Number.isSafeInteger(value.package.revision) && text(value.package.title, 120) && text(value.package.description, 2000)
    && value.pods.every(pod => plain(pod) && identity(pod.podId) && text(pod.key, 64) && (pod.title === undefined || text(pod.title, 120)) && text(pod.description, 2000) && keys(pod.defaults) && keys(pod.omittedReferences ?? [])
      && Array.isArray(pod.aliases) && pod.aliases.length <= 64 && pod.aliases.every(item => plain(item) && identity(item.resourceId) && text(item.alias, 64))
      && Array.isArray(pod.assets) && pod.assets.length <= sharingLimits.files && pod.assets.every(item => plain(item) && identity(item.resourceId) && text(item.path, 240) && text(item.mediaType, 120)))
    && value.compositions.every(item => plain(item) && identity(item.id) && text(item.key, 64) && (item.title === undefined || text(item.title, 120)) && keys(item.defaults))
}
export function parsePortableExportCommand(value: unknown): PortableExportCommand {
  if (!plain(value) || typeof value.type !== 'string') throw new Error('Invalid export command')
  const count = Object.keys(value).length
  if (value.type === 'inspectSource' && count === 2 && selection(value.selection)) return { type: 'inspectSource', selection: structuredClone(value.selection) }
  if (value.type === 'review' && count === 3 && selection(value.selection) && choices(value.choices)) return { type: 'review', selection: structuredClone(value.selection), choices: structuredClone(value.choices) }
  if (value.type === 'download' && count === 3 && identity(value.id) && Array.isArray(value.acknowledgedFindings) && value.acknowledgedFindings.length <= 200 && value.acknowledgedFindings.every(item => typeof item === 'string' && item.length <= 200)) return { type: 'download', id: value.id as string, acknowledgedFindings: [...value.acknowledgedFindings as string[]] }
  if (value.type === 'discard' && count === 2 && identity(value.id)) return { type: 'discard', id: value.id as string }
  throw new Error('Invalid export command')
}
export function parseSharingCommand(value: unknown): SharingCommand {
  if (!plain(value) || (value.scope !== 'import' && value.scope !== 'export')) throw new Error('Invalid sharing command')
  const { scope, ...rest } = value
  if (scope === 'export') return { scope, ...parsePortableExportCommand(rest) }
  if (rest.type === 'pickFile' && Object.keys(rest).length === 1) return { scope, type: 'pickFile' }
  return { scope, ...parsePortableImportCommand(rest) }
}
