import type { PodResource } from '../../contracts/resources'
import { parseProgramArgv } from '../../contracts/programs'
import type { ProgramAssignment } from '../../contracts/programs'
import { prepareProgramAuthorization } from './session'
import type { CredentialCache } from '../connections/cache'
import { PodToolBroker } from '../broker/tools'
import type { BrokerLease } from '../broker/tools'
import { startMailProxy } from '../mail/proxy'

export function programRequest(resources: PodResource[], podId: string, capabilities: string[], body: unknown) {
  const request = body as { applicationId?: string, application?: string, argv: string[] }
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['applicationId', 'application', 'argv'].includes(key)) || Object.hasOwn(request, 'applicationId') === Object.hasOwn(request, 'application') || ('applicationId' in request && typeof request.applicationId !== 'string') || ('application' in request && typeof request.application !== 'string')) throw new Error('Invalid application invocation')
  const candidates = resources.filter(item => item.podId === podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'program' && (request.applicationId ? item.id === request.applicationId : item.name === request.application))
  if (candidates.length > 1) throw new Error('Application name is ambiguous; use its explicit resource ID')
  const resource = candidates[0]
  if (!resource || !capabilities.includes(String(resource.configuration.capability))) throw new Error('Application is not declared and assigned to this script')
  return { id: resource.id, assignment: resource.configuration as unknown as ProgramAssignment, argv: parseProgramArgv(request.argv) }
}
export async function invokeProgram(resources: PodResource[], podId: string, body: unknown, helper: string, root: string, credentials: CredentialCache, lease: BrokerLease) {
  const { id, assignment, argv } = programRequest(resources, podId, lease.capabilities, body)
  const { authority, authorization } = await prepareProgramAuthorization(assignment, podId, argv, credentials, true)
  const proxy = assignment.networkHosts.length ? await startMailProxy(lease.signal, undefined, assignment.networkHosts) : undefined
  try {
    const broker = new PodToolBroker(helper, root, authority, credentials)
    return await broker.execute({ id, ...authorization, capability: assignment.capability, executable: assignment.executable, executableHash: assignment.executableHash, entryFiles: assignment.entryFiles, prefix: [], programState: { id: assignment.stateId, podId, applicationId: id }, cacheArgument: assignment.cacheArgument, runtimeDirectories: [], environment: { ...assignment.environment, ...proxy?.environment }, networkPorts: proxy ? [proxy.port] : [], maxOutputBytes: 200000 }, { toolId: id, argv: [assignment.cliId, ...argv] }, lease)
  }
  finally { await proxy?.close() }
}
