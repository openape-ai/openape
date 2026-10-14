import { programLaunch } from './runtime'
import { AgentAuthority } from '../broker/authorization'
import type { AgentConnection, GrantObserver, GrantLedgerPort, GrantPresentation, RunGrantTokens } from '../broker/authorization'
import type { PodResource } from '../../contracts/resources'
import { parseProgramArgv, programIdentity } from '../../contracts/programs'
import type { ProgramAssignment } from '../../contracts/programs'
import type { SandboxReach } from '../../contracts/sandbox'
import { callEffect, programCall, verifyProgram } from './session'
import type { CredentialCache } from '../connections/cache'
import { PodToolBroker } from '../broker/tools'
import type { BrokerLease, CallAuthority } from '../broker/tools'
import { startMailProxy } from '../mail/proxy'
import { archiveRefusal } from '../../contracts/mail-archive-port'

/** The sandbox decides which application a script can call; `programRequest` finds it among the Pod's assigned applications. */
export function programRequest(resources: PodResource[], podId: string, capabilities: string[], body: unknown) {
  const request = body as { applicationId?: string, application?: string, argv: string[] }
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['applicationId', 'application', 'argv'].includes(key)) || Object.hasOwn(request, 'applicationId') === Object.hasOwn(request, 'application') || ('applicationId' in request && typeof request.applicationId !== 'string') || ('application' in request && typeof request.application !== 'string')) throw new Error('Invalid application invocation')
  const candidates = resources.filter(item => item.podId === podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'program' && (request.applicationId ? item.id === request.applicationId : item.name === request.application))
  if (candidates.length > 1) throw new Error('Application name is ambiguous; use its explicit resource ID')
  const resource = candidates[0]
  if (!resource || !capabilities.includes(String(resource.configuration.capability))) throw new Error('Application is not declared and assigned to this script')
  return { id: resource.id, assignment: resource.configuration as unknown as ProgramAssignment, argv: parseProgramArgv(request.argv) }
}

/**
 * How one call reaches the Pod identity, its grants and its sandbox reach. `approval` replaces the grant check for one
 * command whose program approval the worker consumed (issue 1468): it confirms that approval right before the start.
 */
export interface ProgramCallAccess { connection: AgentConnection, ledger?: GrantLedgerPort, reach: SandboxReach, observe?: GrantObserver, tokens?: RunGrantTokens, approval?: () => Promise<void>, presentation?: GrantPresentation }

function programAuthority(access: ProgramCallAccess): AgentAuthority {
  return new AgentAuthority(access.connection, access.observe, access.ledger, access.tokens, access.presentation)
}

/**
 * Authorizes one application command at the IdP before it runs and tells whether it writes (issue 1473, revision 4).
 * The verified token stays in the run's tokens, so the call that then runs the command does not ask the IdP again.
 */
export async function authorizeProgramEffect(resources: PodResource[], podId: string, capabilities: string[], body: unknown, access: ProgramCallAccess, signal: AbortSignal): Promise<{ write: boolean }> {
  const { assignment, argv } = programRequest(resources, podId, capabilities, body)
  await verifyProgram(assignment)
  return callEffect(await programAuthority(access).authorizeProgram(programCall(assignment, argv), signal), assignment.cliId)
}

/**
 * Runs one application command: the sandbox must contain the application, and the IdP must authorize exactly this
 * command for exactly this program file, or a consumed program approval must name it (issue 1468).
 */
export async function invokeProgram(resources: PodResource[], podId: string, body: unknown, helper: string, root: string, credentials: CredentialCache, lease: BrokerLease, access: ProgramCallAccess, action?: 'move') {
  const { id, assignment, argv } = programRequest(resources, podId, lease.capabilities, body)
  // Authorization runs before any process starts; for the archive port a refusal here is evidence that nothing moved.
  const notStarted = (error: unknown) => action ? archiveRefusal(error) : error
  try { await verifyProgram(assignment) }
  catch (error) { throw notStarted(error) }
  const authority = programAuthority(access)
  const authorize: CallAuthority = async (call, signal) => {
    try {
      if (access.approval) await access.approval()
      else callEffect(await authority.authorizeProgram(call, signal), call.program.name, action)
    }
    catch (error) { throw notStarted(error) }
  }
  // At the owner level the program has the owner's network reach; its network hosts and their proxy apply only when isolated.
  const proxy = assignment.networkHosts.length && access.reach.level === 'isolated' ? await startMailProxy(lease.signal, undefined, assignment.networkHosts) : undefined
  try {
    const broker = new PodToolBroker(helper, root, authorize, credentials)
    const launch = programLaunch(assignment)
    return await broker.execute({ id, identityConnection: access.connection, reach: access.reach, capability: assignment.capability, program: { path: assignment.executable, ...programIdentity(assignment) }, argv, executable: launch.executable, executableHash: launch.executableHash, entryFiles: assignment.entryFiles, prefix: launch.prefix, programState: { id: assignment.stateId, podId, applicationId: id }, cacheArgument: assignment.cacheArgument, runtimeDirectories: launch.runtimeDirectories, runtimeEnvironment: assignment.runtime?.environment, environment: { ...assignment.environment, ...proxy?.environment }, networkPorts: proxy ? [proxy.port] : [], maxOutputBytes: 200000 }, { toolId: id, argv }, lease)
  }
  finally { await proxy?.close() }
}
