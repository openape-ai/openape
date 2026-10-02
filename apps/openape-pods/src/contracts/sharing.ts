import { sharingLimits } from '@openape/pods-protocol'
import type { PortableManifest } from '@openape/pods-protocol'

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
  compositions: { key: string, workflowId: string | null, networkId: string | null }[]
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
