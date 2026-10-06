import { parsePackages } from './dependencies'
import type { PackageManifest } from './dependencies'
import { parseCredentialAlias } from './credentials'
import { parseMasterAction } from './master'
import type { StoredPod } from './control'
import type { ScriptVersion } from './details'

export interface ScriptSelection { kind: 'version' | 'draft', id: string }
export interface ScriptSource extends ScriptSelection { packages?: PackageManifest, dependenciesPrepared?: boolean, code: string, capabilities: string[], revision: number, assignmentRevision: number, hash: string | null, validated: boolean, evidence: string | null, credentialAccessApproved: boolean }
export interface ScriptDraftSummary { id: string, revision: number, assignmentRevision: number, validated: boolean }
export interface ScriptView { environment?: Record<string, string>,  resourceEpoch: number, credentialAliases: string[], pod: StoredPod, versions: ScriptVersion[], drafts: ScriptDraftSummary[], source: ScriptSource | null }
export type ScriptCommand =
  | { type: 'list', podId: string, selection?: ScriptSelection }
  | { type: 'prepareDependencies', podId: string, revision: number, draftId: string, draftRevision: number }
  | { type: 'save', podId: string, revision: number, draftId: string | null, draftRevision: number, code: string, capabilities: string[], packages?: PackageManifest }
  | { type: 'validate', podId: string, revision: number, draftId: string, draftRevision: number }
  | { type: 'approveCredentials', podId: string, revision: number, hash: string, epoch: number }
  | { type: 'activate', podId: string, revision: number, hash: string, expectedActive: string | null }
const uuid = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
const hash = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function parseScriptCommand(value: unknown): ScriptCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid script request')
  const item = value as Record<string, unknown>
  if (item.type === 'list') {
    if (Object.keys(item).some(key => !['type', 'podId', 'selection'].includes(key)) || !uuid(item.podId)) throw new Error('Invalid script scope')
    if (item.selection !== undefined) {
      const selection = item.selection as ScriptSelection
      if (!selection || Object.keys(selection).some(key => !['kind', 'id'].includes(key)) || !['version', 'draft'].includes(selection.kind) || !(selection.kind === 'version' ? hash(selection.id) : uuid(selection.id))) throw new Error('Invalid script selection')
    }
  }
  else if (item.type === 'approveCredentials') {
    if (Object.keys(item).some(key => !['type', 'podId', 'revision', 'hash', 'epoch'].includes(key)) || !uuid(item.podId) || !hash(item.hash) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1 || !Number.isSafeInteger(item.epoch) || Number(item.epoch) < 0) throw new Error('Invalid credential approval request')
  }
  else {
    const { type, ...fields } = item
    if (!['save', 'validate', 'activate', 'prepareDependencies'].includes(type as string)) throw new Error('Unsupported script request')
    parseMasterAction({ ...fields, action: type === 'save' ? 'draft' : type === 'activate' ? 'rollback' : 'validate' })
  }
  return structuredClone(item) as ScriptCommand
}
export function parseScriptView(value: unknown): ScriptView {
  if (!value || typeof value !== 'object') throw new Error('Invalid script view')
  const view = value as ScriptView
  if (!view.pod || !uuid(view.pod.id) || !Number.isSafeInteger(view.pod.revision) || !Array.isArray(view.versions) || !Array.isArray(view.drafts)) throw new Error('Invalid script view fields')
  if (!Number.isSafeInteger(view.resourceEpoch) || view.resourceEpoch < 0 || !Array.isArray(view.credentialAliases)) throw new Error('Invalid script credential view')
  view.credentialAliases.forEach(parseCredentialAlias)
  for (const version of view.versions) {
    if (!hash(version.hash) || typeof version.active !== 'boolean' || typeof version.validated !== 'boolean') throw new Error('Invalid script version')
  }
  for (const draft of view.drafts) {
    if (!uuid(draft.id) || !Number.isSafeInteger(draft.revision) || !Number.isSafeInteger(draft.assignmentRevision) || typeof draft.validated !== 'boolean') throw new Error('Invalid script draft')
  }
  if (view.environment !== undefined && (!view.environment || typeof view.environment !== 'object' || Array.isArray(view.environment) || Object.keys(view.environment).length > 16 || Object.entries(view.environment).some(([key, value]) => !['HOME', 'TMPDIR', 'PATH', 'SHELL', 'PODS_POD_ID', 'LANG', 'TERM', 'ELECTRON_RUN_AS_NODE'].includes(key) || typeof value !== 'string' || value.length > 4096))) throw new Error('Invalid script environment')
  if (view.source !== null) {
    const source = view.source
    if (!source || typeof source.credentialAccessApproved !== 'boolean' || !['version', 'draft'].includes(source.kind) || !(source.kind === 'version' ? hash(source.id) : uuid(source.id)) || typeof source.code !== 'string' || !Array.isArray(source.capabilities) || source.capabilities.some(item => typeof item !== 'string') || !Number.isSafeInteger(source.revision) || !Number.isSafeInteger(source.assignmentRevision) || typeof source.validated !== 'boolean' || (source.hash !== null && !hash(source.hash)) || (source.evidence !== null && typeof source.evidence !== 'string')) throw new Error('Invalid script source')
    if (source.packages !== undefined) parsePackages(source.packages)
    if (source.dependenciesPrepared !== undefined && typeof source.dependenciesPrepared !== 'boolean') throw new Error('Invalid script source')
  }
  return view
}
