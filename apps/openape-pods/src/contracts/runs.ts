import { parseRunApproval } from './activity'
import type { RunApproval } from './activity'

export type RunState = 'running' | 'completed' | 'completedWithGaps' | 'failed' | 'cancelled' | 'blocked' | 'interrupted'
/** Stored events of versions before issue 1518 can still carry `hold`; it is read as `isolated`. */
export interface AutomaticRecovery { retainedInputs?: boolean, disposition: 'retry' | 'isolated' | 'continued', reason: string, nextAt: number | null, attempt: number }
/**
 * `recovery` is always null since issue 1518, when manual recovery review ended; parsers of earlier versions require
 * the field, and earlier desktops still report their review state in it.
 */
export interface RunRecord { automaticRecovery?: AutomaticRecovery, id: string, podId: string, scriptHash: string, state: RunState, startedAt: number, finishedAt: number | null, summary: string, error: string | null, checkpointRevision: number, recovery: { state: 'ready' | 'needsReview' | 'retryQueued', error: string | null } | null }
export interface RunEvent { sequence: number, type: string, data: unknown, at: number }
export interface RunView { timing?: { activeMs: number, waitingMs: number }, approvals?: (RunApproval & { runId: string })[], runs: RunRecord[], events: RunEvent[] }
export type RunCommand = { type: 'openApproval', podId: string, runId: string, grantId: string } | { type: 'openGrant', podId: string, grantId: string } | { type: 'list', podId: string, runId?: string, after?: number } | { type: 'installExample', podId: string, variant: 'deterministic' | 'agent' } | { type: 'start', podId: string, expectedScript?: string } | { type: 'cancel', podId: string, runId: string }
export function parseRunCommand(value: unknown): RunCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run command')
  const item = value as Record<string, unknown>
  const keys = item.type === 'openApproval' ? ['type', 'podId', 'runId', 'grantId'] : item.type === 'openGrant' ? ['type', 'podId', 'grantId'] : item.type === 'list' ? ['type', 'podId', 'runId', 'after'] : item.type === 'installExample' ? ['type', 'podId', 'variant'] : item.type === 'start' ? ['type', 'podId', 'expectedScript'] : item.type === 'cancel' ? ['type', 'podId', 'runId'] : []
  if (!keys.length || Object.keys(item).some(key => !keys.includes(key)) || typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId)) throw new Error('Unsupported run command')
  if ((item.type === 'cancel' || item.runId !== undefined) && (typeof item.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.runId))) throw new Error('Invalid run identity')
  if ((item.type === 'openApproval' || item.type === 'openGrant') && (typeof item.grantId !== 'string' || !/^[\w-]{1,128}$/.test(item.grantId))) throw new Error('Invalid approval identity')
  if (item.after !== undefined && (!Number.isSafeInteger(item.after) || (item.after as number) < 0)) throw new Error('Invalid event cursor')
  if (item.type === 'installExample' && !['deterministic', 'agent'].includes(item.variant as string)) throw new Error('Invalid example version')
  if (item.expectedScript !== undefined && (typeof item.expectedScript !== 'string' || !/^[a-f0-9]{64}$/.test(item.expectedScript))) throw new Error('Invalid expected script')
  return structuredClone(item) as RunCommand
}
export function parseRunView(value: unknown): RunView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run view')
  const view = value as RunView
  if (!Array.isArray(view.runs) || view.runs.length > 100 || !Array.isArray(view.events) || view.events.length > 500) throw new Error('Invalid run view collections')
  for (const run of view.runs) {
    // `hold` comes from desktops before issue 1518.
    if (run?.automaticRecovery && (!['retry', 'isolated', 'hold', 'continued'].includes(run.automaticRecovery.disposition) || typeof run.automaticRecovery.reason !== 'string' || !Number.isSafeInteger(run.automaticRecovery.attempt) || (run.automaticRecovery.nextAt !== null && !Number.isSafeInteger(run.automaticRecovery.nextAt)))) throw new Error('Invalid automatic recovery state')
    if (!run || (run.recovery !== null && (!run.recovery || !['ready', 'needsReview', 'retryQueued'].includes(run.recovery.state) || (run.recovery.error !== null && typeof run.recovery.error !== 'string'))) || !/^[a-f0-9-]{36}$/.test(run.id) || !/^[a-f0-9-]{36}$/.test(run.podId) || !/^[a-f0-9]{64}$/.test(run.scriptHash)
      || !['running', 'completed', 'completedWithGaps', 'failed', 'cancelled', 'blocked', 'interrupted'].includes(run.state)
      || !Number.isSafeInteger(run.startedAt) || (run.finishedAt !== null && !Number.isSafeInteger(run.finishedAt))
      || typeof run.summary !== 'string' || (run.error !== null && typeof run.error !== 'string') || !Number.isSafeInteger(run.checkpointRevision) || run.checkpointRevision < 0) {
      throw new Error('Invalid run record')
    }
  }
  if (view.timing && (!Number.isSafeInteger(view.timing.activeMs) || view.timing.activeMs < 0 || !Number.isSafeInteger(view.timing.waitingMs) || view.timing.waitingMs < 0)) throw new Error('Invalid run timing')
  if (view.approvals !== undefined) {
    if (!Array.isArray(view.approvals) || view.approvals.length > 32) throw new Error('Invalid pending approvals')
    for (const item of view.approvals) { const { runId, ...approval } = item; if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Invalid approval run'); parseRunApproval(approval) }
  }
  let previous = 0
  for (const event of view.events) {
    if (!event || !Number.isSafeInteger(event.sequence) || event.sequence <= previous || typeof event.type !== 'string' || !Number.isSafeInteger(event.at)) throw new Error('Invalid run event')
    previous = event.sequence
  }
  return view
}

export interface RunAliases { applications: Record<string, string>, http: Record<string, string>, directories: Record<string, string>, references: Record<string, { id: string, hash: string, path: string }> }
// Script-facing names for ready local resources, so shared source needs no local identity, path or origin.
/** Script time limit of one run, excluding paused service and agent waits. */
export const scriptTimeLimitMs = 300000

export function runAliases(aliases: { alias: string, resource: import('./resources').PodResource }[], references: RunInput['references']): RunAliases {
  const result: RunAliases = { applications: {}, http: {}, directories: {}, references: {} }
  for (const { alias, resource } of aliases) {
    if (resource.state !== 'ready') continue
    const reference = references.find(item => item.id === resource.id)
    if (resource.kind === 'reference' && reference) result.references[alias] = reference
    else if (resource.kind === 'directory') result.directories[alias] = String(resource.configuration.path)
    else if (resource.configuration.type === 'http') result.http[alias] = String(resource.configuration.origin)
    else if (resource.configuration.type === 'program') result.applications[alias] = resource.name
  }
  return result
}
export interface RunInput {
  aliases?: RunAliases
  home?: string
  directories?: { path: string, access: 'read' | 'readWrite' }[]
  variables?: Record<string, string>
  version: 1
  runId: string
  podId: string
  scriptHash: string
  assignmentRevision: number
  reason: 'manual' | 'schedule' | 'event'
  eventIds: string[]
  checkpointRevision: number
  checkpoint: Record<string, unknown>
  resourceEpoch: number
  workspace: string
  references: { id: string, hash: string, path: string }[]
  limits: { timeMs: number, frameBytes: number }
  /** Set only in synthetic validation, which provides no assigned folders and stores nothing. */
  validation?: true
}
export interface ScriptResult { status: 'completed' | 'completedWithGaps' | 'failed' | 'cancelled' | 'blocked', summary: string, completedInputIds: string[], gapIds: string[] }
export function parseResult(value: unknown, input: RunInput): ScriptResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid terminal result')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !['status', 'summary', 'completedInputIds', 'gapIds'].includes(key)) || !['completed', 'completedWithGaps', 'failed', 'cancelled', 'blocked'].includes(result.status as string) || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 10000) throw new Error('Invalid terminal result fields')
  if (!Array.isArray(result.completedInputIds) || result.completedInputIds.some(id => !input.eventIds.includes(id)) || !Array.isArray(result.gapIds) || result.gapIds.length > 1000 || result.gapIds.some(id => typeof id !== 'string')) throw new Error('Uncommitted result references')
  return result as unknown as ScriptResult
}
/** Every request a script may send; the frame check and the frame type share this one list. */
export const scriptOperations = ['run.timing', 'data.get', 'data.delete', 'jev.evaluate', 'http.request', 'credentials.get', 'agent.run', 'tools.invoke', 'progress.commit', 'graph.contract', 'notify', 'data.set', 'data.list', 'work.contract', 'work.polls', 'work.find', 'work.claim', 'work.complete', 'work.defer', 'work.fail', 'decisions.ask', 'decisions.withdraw'] as const
export function assertTimingRequest(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new Error('Run timing accepts no parameters')
}
export type ScriptOperation = typeof scriptOperations[number]
export interface ScriptFrame { version: 1, runId: string, sequence: number, type: 'request' | 'result' | 'error' | 'log', id?: string, operation?: ScriptOperation, payload: unknown }
export function parseFrame(value: unknown, runId: string, sequence: number): ScriptFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid script frame')
  const frame = value as Record<string, unknown>
  if (Object.keys(frame).some(key => !['version', 'runId', 'sequence', 'type', 'id', 'operation', 'payload'].includes(key)) || frame.version !== 1 || frame.runId !== runId || frame.sequence !== sequence || !['request', 'result', 'error', 'log'].includes(frame.type as string)) throw new Error('Invalid script frame binding or sequence')
  if (frame.type === 'request' && (typeof frame.id !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(frame.id) || !(scriptOperations as readonly string[]).includes(frame.operation as string))) throw new Error('Unsupported script request')
  return frame as unknown as ScriptFrame
}
