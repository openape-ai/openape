import type { RetryNotice } from './infrastructure'
import type { RunApproval } from './activity'
import { parseScriptCapabilities } from './credentials'

export interface ServiceScope { podId: string, runId: string, epoch: number, assignmentRevision: number, capabilities: string[] }
/**
 * The services a run asks the desktop for; a request without a kind is a tool call. `programAuthorize` authorizes one
 * application command at the IdP before the worker decides whether it records the call as an effect (issue 1473).
 */
export const serviceKinds = ['approval', 'mailArchive', 'mailMove', 'approvedProgram', 'programAuthorize', 'credential', 'jev', 'http', 'shell', 'shellClose'] as const
export type ServiceKind = typeof serviceKinds[number]
/** `summary` is a script's own account of a tool or HTTP call, shown by the IdP only if the call needs a new grant. */
export interface ServiceRequest { id: string, scope: ServiceScope, body: unknown, kind?: ServiceKind, summary?: unknown }
/** Whether an authorized application command writes: then the worker records it as an effect before it runs. */
export function parseProgramEffect(value: unknown): { write: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as { write?: unknown }).write !== 'boolean') throw new Error('Invalid program authorization response')
  return { write: (value as { write: boolean }).write }
}
export interface ServiceCheck { infrastructure?: RetryNotice | null, authorityLost?: true, scope: ServiceScope, domain?: { path: string, ownerPid: number }, approval?: RunApproval }
export function parseServiceScope(value: unknown): ServiceScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid service scope')
  const scope = value as ServiceScope
  if (Object.keys(scope).some(key => !['podId', 'runId', 'epoch', 'assignmentRevision', 'capabilities'].includes(key)) || ![scope.podId, scope.runId].every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) || !Number.isSafeInteger(scope.epoch) || scope.epoch < 0 || !Number.isSafeInteger(scope.assignmentRevision) || scope.assignmentRevision < 1 || !Array.isArray(scope.capabilities) || scope.capabilities.length > 16) throw new Error('Invalid service scope fields')
  parseScriptCapabilities(scope.capabilities)
  return scope
}

export type RunContextRequest = ServiceCheck

/** Interval at which a running Pod's runtime grant, owner, identity and key are re-checked at the IdP. */
export const runAuthorityWatchMs = 60 * 1000
export interface RunContext { name: string, reason: string }
export function parseRunContext(value: unknown): RunContext {
  const context = value as RunContext | null
  if (!context || typeof context !== 'object' || typeof context.name !== 'string' || typeof context.reason !== 'string') throw new Error('Invalid run context')
  return context
}
