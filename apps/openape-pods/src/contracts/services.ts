import { parseScriptCapabilities } from './credentials'

export interface ServiceScope { podId: string, runId: string, epoch: number, assignmentRevision: number, capabilities: string[] }
export interface ServiceRequest { id: string, scope: ServiceScope, body: unknown, kind?: 'credential' | 'http' }
export interface ServiceCheck { scope: ServiceScope, domain?: { path: string, ownerPid: number } }
export function parseServiceScope(value: unknown): ServiceScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid service scope')
  const scope = value as ServiceScope
  if (Object.keys(scope).some(key => !['podId', 'runId', 'epoch', 'assignmentRevision', 'capabilities'].includes(key)) || ![scope.podId, scope.runId].every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) || !Number.isSafeInteger(scope.epoch) || scope.epoch < 0 || !Number.isSafeInteger(scope.assignmentRevision) || scope.assignmentRevision < 1 || !Array.isArray(scope.capabilities) || scope.capabilities.length > 16) throw new Error('Invalid service scope fields')
  parseScriptCapabilities(scope.capabilities)
  return scope
}
