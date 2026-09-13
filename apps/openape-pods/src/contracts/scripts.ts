import { parseMasterAction } from './master'
import type { StoredPod } from './control'
import type { ScriptVersion } from './details'

export interface ScriptSelection { kind: 'version' | 'draft', id: string }
export interface ScriptSource extends ScriptSelection { code: string, capabilities: string[], revision: number, assignmentRevision: number, hash: string | null, validated: boolean, evidence: string | null }
export interface ScriptDraftSummary { id: string, revision: number, assignmentRevision: number, validated: boolean }
export interface ScriptView { pod: StoredPod, versions: ScriptVersion[], drafts: ScriptDraftSummary[], source: ScriptSource | null }
export type ScriptCommand =
  | { type: 'list', podId: string, selection?: ScriptSelection }
  | { type: 'save', podId: string, revision: number, draftId: string | null, draftRevision: number, code: string, capabilities: string[] }
  | { type: 'validate', podId: string, revision: number, draftId: string, draftRevision: number }
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
  else {
    const { type, ...fields } = item
    if (!['save', 'validate', 'activate'].includes(type as string)) throw new Error('Unsupported script request')
    parseMasterAction({ ...fields, action: type === 'save' ? 'draft' : type === 'activate' ? 'rollback' : 'validate' })
  }
  return structuredClone(item) as ScriptCommand
}
export function parseScriptView(value: unknown): ScriptView {
  if (!value || typeof value !== 'object') throw new Error('Invalid script view')
  const view = value as ScriptView
  if (!view.pod || !uuid(view.pod.id) || !Number.isSafeInteger(view.pod.revision) || !Array.isArray(view.versions) || !Array.isArray(view.drafts)) throw new Error('Invalid script view fields')
  for (const version of view.versions) {
    if (!hash(version.hash) || typeof version.active !== 'boolean' || typeof version.validated !== 'boolean') throw new Error('Invalid script version')
  }
  for (const draft of view.drafts) {
    if (!uuid(draft.id) || !Number.isSafeInteger(draft.revision) || !Number.isSafeInteger(draft.assignmentRevision) || typeof draft.validated !== 'boolean') throw new Error('Invalid script draft')
  }
  if (view.source !== null) {
    const source = view.source
    if (!source || !['version', 'draft'].includes(source.kind) || !(source.kind === 'version' ? hash(source.id) : uuid(source.id)) || typeof source.code !== 'string' || !Array.isArray(source.capabilities) || source.capabilities.some(item => typeof item !== 'string') || !Number.isSafeInteger(source.revision) || !Number.isSafeInteger(source.assignmentRevision) || typeof source.validated !== 'boolean' || (source.hash !== null && !hash(source.hash)) || (source.evidence !== null && typeof source.evidence !== 'string')) throw new Error('Invalid script source')
  }
  return view
}
