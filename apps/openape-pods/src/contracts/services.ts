import type { RetryNotice } from './infrastructure'
import type { RunApproval } from './activity'
import { parseScriptCapabilities } from './credentials'

export interface ServiceScope { podId: string, runId: string, epoch: number, assignmentRevision: number, capabilities: string[] }
export interface ServiceRequest { id: string, scope: ServiceScope, body: unknown, kind?: 'gate' | 'mailArchive' | 'mailMove' | 'credential' | 'jev' | 'http' | 'shell' | 'shellClose' }
export interface ServiceCheck { infrastructure?: RetryNotice | null, authorityLost?: true, scope: ServiceScope, domain?: { path: string, ownerPid: number }, approval?: RunApproval }
export function parseServiceScope(value: unknown): ServiceScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid service scope')
  const scope = value as ServiceScope
  if (Object.keys(scope).some(key => !['podId', 'runId', 'epoch', 'assignmentRevision', 'capabilities'].includes(key)) || ![scope.podId, scope.runId].every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) || !Number.isSafeInteger(scope.epoch) || scope.epoch < 0 || !Number.isSafeInteger(scope.assignmentRevision) || scope.assignmentRevision < 1 || !Array.isArray(scope.capabilities) || scope.capabilities.length > 16) throw new Error('Invalid service scope fields')
  parseScriptCapabilities(scope.capabilities)
  return scope
}

export interface RunContextRequest extends ServiceCheck { grant?: { permission: string, issuer: string, subject: string } }

/** Interval at which a running Pod's runtime grant, owner, identity and key are re-checked at the IdP. */
export const runAuthorityWatchMs = 60 * 1000
/** `runtime` is false for network and decision-maintenance runs, which execute no runtime and hold no runtime grant. */
export interface RunContext { name: string, reason: string, runtime: boolean }
export function parseRunContext(value: unknown): RunContext {
  const context = value as RunContext | null
  if (!context || typeof context !== 'object' || typeof context.name !== 'string' || typeof context.reason !== 'string' || typeof context.runtime !== 'boolean') throw new Error('Invalid run context')
  return context
}
