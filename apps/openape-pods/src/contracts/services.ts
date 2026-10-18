import type { RetryNotice } from './infrastructure'
import type { RunApproval } from './activity'
import { parseScriptCapabilities } from './credentials'

export interface ServiceScope { podId: string, runId: string, epoch: number, assignmentRevision: number, capabilities: string[] }
/** The services a run asks the desktop for; a request without a kind is a tool call. */
export const serviceKinds = ['credential', 'jev', 'http', 'shell', 'shellClose', 'scriptGrant'] as const
export type ServiceKind = typeof serviceKinds[number]
/** `summary` is a script's own account of a tool or HTTP call, shown by the IdP only if the call needs a new grant. */
export interface ServiceRequest { id: string, scope: ServiceScope, body: unknown, kind?: ServiceKind, summary?: unknown }
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
export interface RunContext { name: string, reason: 'manual' | 'schedule' | 'event', description?: string }
export function parseRunContext(value: unknown): RunContext {
  const context = value as RunContext | null
  if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).some(key => !['name', 'reason', 'description'].includes(key)) || typeof context.name !== 'string' || !context.name.trim() || context.name.length > 100 || typeof context.reason !== 'string' || !['manual', 'schedule', 'event'].includes(context.reason)) throw new Error('Invalid run context')
  if (context.description !== undefined && (typeof context.description !== 'string' || context.description.length > 4000)) throw new Error('Invalid run context description')
  return context
}
