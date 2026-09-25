import { parseCommand, parseWorkspace } from './control'
import type { WorkspaceState } from './control'
import { parseDetailsCommand, parsePodDetails } from './details'
import type { PodDetails } from './details'
import { parseScriptCommand, parseScriptView } from './scripts'
import type { ScriptView } from './scripts'
import { parseScheduleCommand, parseScheduleView } from './scheduling'
import type { ScheduleView } from './scheduling'
import { parseRunCommand, parseRunView } from './runs'
import type { RunEvent, RunRecord, RunView } from './runs'
import { parseResourceCommand, parseResourceState } from './resources'
import type { ResourceState } from './resources'

export const centralTables = [
  'pods', 'remote_pods', 'master_creations', 'script_credential_approvals', 'assignments', 'scripts', 'checkpoints', 'sources', 'claims', 'settings', 'validations', 'resources', 'resource_epochs',
  'runs', 'run_events', 'schedules', 'accepted_events', 'run_inputs', 'recovery_reviews', 'effect_ledger',
  'mail_inventory', 'mail_items', 'mail_receipts', 'mail_extractions', 'mail_contexts', 'source_derivations',
  'master_messages', 'script_drafts', 'access_proposals', 'pod_organization', 'pod_groups', 'pod_memberships',
  'pod_variables', 'master_message_scopes', 'pod_chat_origins', 'pod_descriptions', 'draft_packages', 'dependency_sets', 'script_dependencies',
  'workflows', 'workflow_members', 'workflow_runs', 'workflow_nodes', 'workflow_attempts', 'workflow_mail_scopes',
  'workflow_mail_pending', 'workflow_mail_processed', 'workflow_mail_participants', 'workflow_mail_batches', 'workflow_mail_audit',
  'chat_conversations', 'chat_contexts', 'chat_members', 'chat_message_context', 'control_runs', 'control_changes',
] as const

export const centralHeartbeatMs = 10000
export const centralLeaseMs = 30000
export const centralMaxBytes = 32 * 1024 * 1024
export type CentralChannel = 'workspace' | 'details' | 'scripts' | 'scheduling' | 'runs' | 'resources' | 'local'
export interface CentralCommand { channel: CentralChannel, body: Record<string, unknown> }
export interface CentralPod {
  id: string
  ready: boolean
  details: PodDetails
  scripts: ScriptView
  resources: ResourceState
  scheduling: ScheduleView
  runs: RunView
  versions: Record<string, ScriptView>
  history: Record<string, RunView>
}
export interface CentralSnapshot {
  version: 1
  workspace: WorkspaceState
  pods: CentralPod[]
  archive: { schema: number, tables: Record<string, Record<string, unknown>[]> }
  artifacts: { podId: string, path: string, hash: string, size: number }[]
}
export type CentralState = 'connecting' | 'online' | 'reconnecting' | 'offline'
export interface CentralStatus {
  state: CentralState
  error: string | null
  since: number
  lastOnlineAt: number | null
  gateUntil: number
  lastTickAt: number | null
  tickingSince: number | null
  format: 1 | 2 | null
  runtimeId: string | null
  lastPublication: { at: number, bytes: number } | null
}
export interface CentralQueue { blocked: number, since: number | null, error: string | null }
export interface CentralRuntime { id: string, revision: number, online: boolean, lastSeenAt?: number | null, workspace: Omit<WorkspaceState, 'pods'> & { pods: (WorkspaceState['pods'][number] & { online: boolean, queue?: CentralQueue })[] } }
export interface CentralSummary { revision: number, total: number, pod: CentralPod }
export interface CentralRunDetail { revision: number, run: RunRecord, events: RunEvent[] }
export interface CentralOperation {
  id: string
  runtimeId: string
  command: CentralCommand
  state: 'accepted' | 'started' | 'applied' | 'failed' | 'unknown'
  result: unknown
  error: string | null
  revision: number
}
export interface CentralClient {
  inventory: () => Promise<CentralRuntime[]>
  read: (runtimeId: string, podId: string) => Promise<CentralSummary>
  runs: (runtimeId: string, podId: string, offset: number) => Promise<{ revision: number, total: number, runs: RunRecord[] }>
  run: (runtimeId: string, podId: string, runId: string) => Promise<CentralRunDetail>
  version: (runtimeId: string, podId: string, selection: string) => Promise<{ revision: number, version: ScriptView }>
  command: (runtimeId: string, revision: number, command: CentralCommand, id: string) => Promise<CentralOperation>
  operation: (id: string) => Promise<CentralOperation>
  changes: (cursor: number, signal: AbortSignal) => Promise<{ cursor: number }>
}

export function centralObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a workspace object')
  return value as Record<string, unknown>
}

export function centralId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error('Invalid workspace identity')
  return value
}

export function centralRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid workspace revision')
  return Number(value)
}

export function parseCentralCommand(value: unknown): CentralCommand {
  const item = centralObject(value)
  if (Object.keys(item).some(key => !['channel', 'body'].includes(key))) throw new Error('Invalid workspace command fields')
  const body = centralObject(item.body)
  const parsers = { workspace: parseCommand, details: parseDetailsCommand, scripts: parseScriptCommand, scheduling: parseScheduleCommand, runs: parseRunCommand, resources: parseResourceCommand }
  const allowed: Record<Exclude<CentralChannel, 'local'>, string[]> = {
    workspace: ['create', 'update', 'organize'], details: ['describe', 'activate'],
    scripts: ['save', 'validate', 'activate', 'prepareDependencies'], scheduling: ['save', 'lifecycle'],
    runs: ['start', 'cancel', 'recover', 'retryQueue', 'resolveHttp'], resources: ['saveVariable', 'removeVariable', 'revoke'],
  }
  if (typeof item.channel !== 'string' || !Object.hasOwn(parsers, item.channel)) throw new Error('Unsupported workspace channel')
  const channel = item.channel as Exclude<CentralChannel, 'local'>
  if (!allowed[channel].includes(String(body.type))) throw new Error('This action requires the local desktop')
  const parsed = parsers[channel](body)
  return { channel, body: structuredClone(parsed) as unknown as Record<string, unknown> }
}

export function parseRuntimeCentralCommand(value: unknown): CentralCommand {
  const item = centralObject(value)
  if (item.channel !== 'local') return parseCentralCommand(value)
  const body = centralObject(item.body)
  if (Object.keys(item).length !== 2 || Object.keys(body).length !== 1 || body.type !== 'ownerAction') throw new Error('Invalid local workspace command')
  return { channel: 'local', body: { type: 'ownerAction' } }
}

export function commandPodIds(command: CentralCommand, snapshot: CentralSnapshot): string[] {
  const body = command.body
  if (typeof body.podId === 'string') return [centralId(body.podId)]
  if (command.channel === 'workspace' && body.type === 'update') return [centralId(body.id)]
  return snapshot.workspace.pods.map(pod => pod.id)
}

export function parseCentralSnapshot(value: unknown): CentralSnapshot {
  const item = centralObject(value)
  if (item.version !== 1 || Object.keys(item).some(key => !['version', 'workspace', 'pods', 'archive', 'artifacts'].includes(key))) throw new Error('Unsupported workspace snapshot')
  const workspace = parseWorkspace(item.workspace)
  if (workspace.pods.length > 100 || !Array.isArray(item.pods) || item.pods.length !== workspace.pods.length) throw new Error('Invalid workspace inventory')
  const seen = new Set<string>()
  for (const value of item.pods) {
    const pod = centralObject(value)
    const id = centralId(pod.id)
    if (seen.has(id) || !workspace.pods.some(item => item.id === id) || typeof pod.ready !== 'boolean') throw new Error('Invalid Pod snapshot binding')
    seen.add(id)
    parsePodDetails(pod.details); parseScriptView(pod.scripts); parseScheduleView(pod.scheduling)
    if (parseResourceState(pod.resources).resources.some(resource => resource.podId !== id)) throw new Error('Invalid resource Pod binding')
    if (parseRunView(pod.runs).runs.some(run => run.podId !== id)) throw new Error('Invalid run Pod binding')
    if ((pod.scripts as ScriptView).pod.id !== id) throw new Error('Script belongs to another Pod')
    for (const view of Object.values(centralObject(pod.versions))) {
      if (parseScriptView(view).pod.id !== id) throw new Error('Script belongs to another Pod')
    }
    for (const view of Object.values(centralObject(pod.history))) {
      if (parseRunView(view).runs.some(run => run.podId !== id)) throw new Error('Invalid history Pod binding')
    }
  }
  const archive = centralObject(item.archive)
  centralRevision(archive.schema)
  for (const [name, rows] of Object.entries(centralObject(archive.tables))) {
    if (!(centralTables as readonly string[]).includes(name) || !Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Invalid workspace archive')
  }
  if (!Array.isArray(item.artifacts) || item.artifacts.length > 100000) throw new Error('Invalid workspace artifacts')
  const paths = new Set<string>()
  for (const value of item.artifacts) {
    const file = centralObject(value)
    const path = typeof file.path === 'string' ? file.path : ''
    const managed = /^blobs\/[a-f0-9]{64}$/.test(path) || (path.startsWith('workspace/') && path.split('/').every(part => !!part && part !== '.' && part !== '..'))
    if (!seen.has(centralId(file.podId)) || !managed || path.includes('\\') || path.includes('\0') || path.length > 4096 || typeof file.hash !== 'string' || !/^[a-f0-9]{64}$/.test(file.hash)) throw new Error('Invalid managed artifact')
    const key = `${String(file.podId)}:${path}`
    if (paths.has(key)) throw new Error('Invalid duplicate artifact')
    paths.add(key)
    centralRevision(file.size)
    if (Number(file.size) > centralMaxBytes) throw new Error('Managed artifact exceeds limit')
  }
  return structuredClone(item) as unknown as CentralSnapshot
}
