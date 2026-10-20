import { programOutputBytes } from '../../worker/runs/response'
import { programLaunch } from './runtime'
import type { AgentConnection } from '../broker/authorization'
import type { PodResource } from '../../contracts/resources'
import { parseProgramArgv, programIdentity } from '../../contracts/programs'
import type { ProgramAssignment } from '../../contracts/programs'
import type { SandboxReach } from '../../contracts/sandbox'
import { verifyProgram } from './session'
import type { CredentialCache } from '../connections/cache'
import { PodToolBroker } from '../broker/tools'
import type { BrokerLease, ToolExecution } from '../broker/tools'
import { startNetworkProxy } from '../network/proxy'

/** The sandbox decides which application a script can call; `programRequest` finds it among the Pod's assigned applications. */
export function programRequest(resources: PodResource[], podId: string, capabilities: string[], body: unknown) {
  const request = body as { applicationId?: string, application?: string, argv: string[], output?: 'artifact', approvalWaitMs?: number, timeoutMs?: number, isolation?: 'temporary', inputFiles?: { path: string, sha256: string }[] }
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['applicationId', 'application', 'argv', 'output', 'approvalWaitMs', 'timeoutMs', 'isolation', 'inputFiles'].includes(key)) || Object.hasOwn(request, 'applicationId') === Object.hasOwn(request, 'application') || ('applicationId' in request && typeof request.applicationId !== 'string') || ('application' in request && typeof request.application !== 'string')) throw new Error('Invalid application invocation')
  if (request.output !== undefined && request.output !== 'artifact') throw new Error('Unsupported program output mode')
  if (request.approvalWaitMs !== undefined && (!Number.isSafeInteger(request.approvalWaitMs) || request.approvalWaitMs < 0 || request.approvalWaitMs > 300000)) throw new Error('Approval wait must be between 0 and 300000 ms')
  if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 60000)) throw new Error('Program timeout must be between 100 and 60000 ms')
  if (request.isolation !== undefined && request.isolation !== 'temporary') throw new Error('Unsupported program isolation')
  if (request.inputFiles !== undefined && (request.isolation !== 'temporary' || !Array.isArray(request.inputFiles) || request.inputFiles.length > 64 || request.inputFiles.some(file => !file || Object.keys(file).some(key => !['path', 'sha256'].includes(key)) || typeof file.path !== 'string' || !file.path.startsWith('/') || /[\0\r\n]/.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)))) throw new Error('Invalid isolated program input files')
  const candidates = resources.filter(item => item.podId === podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'program' && (request.applicationId ? item.id === request.applicationId : item.name === request.application))
  if (candidates.length > 1) throw new Error('Application name is ambiguous; use its explicit resource ID')
  const resource = candidates[0]
  if (!resource || !capabilities.includes(String(resource.configuration.capability))) throw new Error('Application is not declared and assigned to this script')
  return { id: resource.id, assignment: resource.configuration as unknown as ProgramAssignment, argv: parseProgramArgv(request.argv), output: request.output, approvalWaitMs: request.approvalWaitMs, timeoutMs: request.timeoutMs, isolation: request.isolation, inputFiles: request.inputFiles }
}

/** The assigned identity and the private ape-shell execution channel for one exact call. */
export interface ProgramCallAccess { connection: AgentConnection, reach: SandboxReach, execution: ToolExecution }

export async function invokeProgram(resources: PodResource[], podId: string, body: unknown, helper: string, root: string, credentials: CredentialCache, lease: BrokerLease, access: ProgramCallAccess) {
  const { id, assignment, argv, approvalWaitMs, timeoutMs, isolation, inputFiles } = programRequest(resources, podId, lease.capabilities, body)
  await verifyProgram(assignment)
  // At the owner level the program has the owner's network reach; its network hosts and their proxy apply only when isolated.
  const proxy = assignment.networkHosts.length && access.reach.level === 'isolated' ? await startNetworkProxy(lease.signal, assignment.networkHosts) : undefined
  try {
    const broker = new PodToolBroker(helper, root, access.execution, credentials)
    const launch = programLaunch(assignment)
    return await broker.execute({ id, identityConnection: access.connection, reach: access.reach, capability: assignment.capability, program: { path: assignment.executable, ...programIdentity(assignment) }, argv, executable: launch.executable, executableHash: launch.executableHash, entryFiles: assignment.entryFiles, prefix: launch.prefix, programState: { id: assignment.stateId, podId, applicationId: id }, cacheArgument: assignment.cacheArgument, runtimeDirectories: launch.runtimeDirectories, runtimeEnvironment: assignment.runtime?.environment, environment: { ...assignment.environment, ...proxy?.environment }, networkPorts: proxy ? [proxy.port] : [], maxOutputBytes: programOutputBytes, approvalWaitMs, timeoutMs, isolation, inputFiles }, { toolId: id, argv }, lease)
  }
  finally { await proxy?.close() }
}
