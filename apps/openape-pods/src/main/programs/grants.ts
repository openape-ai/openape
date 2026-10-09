import { loadAdapter, resolveCommand } from '@openape/apes'
import type { AgentConnection } from '../broker/authorization'
import type { PodIdentityReference } from '../connections/agent'
import { connectionRequest } from '../connections/http'
import { approvalURL } from '../../contracts/activity'

export interface ProgramAuthority { identity: PodIdentityReference, ownerConnection: string, grantId: string }
/** A requested assignment; `approval` is the IdP page while the owner has not decided yet. */
export interface GrantRequest { authority: ProgramAuthority, approval: string | null }

/**
 * Requests one continuing grant for the assigned commands as the Pod identity. The owner decides at the
 * IdP (DDISA: the requester never approves its own request); a pending grant is stored and the first
 * run that needs it waits for that decision.
 */
export async function requestCommands(connection: AgentConnection & { identity: PodIdentityReference, ownerConnection: string }, adapterPath: string, commands: string[][], signal: AbortSignal): Promise<GrantRequest> {
  const adapter = loadAdapter(commands[0]![0]!, adapterPath)
  const resolved = await Promise.all(commands.map(argv => resolveCommand(adapter, argv)))
  const created = await connectionRequest(connection.issuer, '/api/grants', { requester: connection.subject, target_host: connection.targetHost, audience: 'shapes', grant_type: 'always', permissions: resolved.map(item => item.permission), authorization_details: resolved.map(item => item.detail), execution_context: resolved[0]!.executionContext, reason: `Owner-assigned program or HTTPS permission for pod ${connection.identity.podId}` }, signal, await connection.accessToken())
  if (typeof created.id !== 'string' || !/^[\w-]{1,128}$/.test(created.id)) throw new Error('Invalid application permission response; inspect pending grants before retrying')
  if (created.status !== 'approved' && created.status !== 'pending') throw new Error('Application permission was declined or revoked')
  const authority = { identity: connection.identity, ownerConnection: connection.ownerConnection, grantId: created.id }
  const title = resolved.map(item => item.detail.display).join('; ').slice(0, 4096)
  return { authority, approval: created.status === 'pending' ? approvalURL({ grantId: created.id, issuer: connection.decisionIssuer ?? connection.issuer, state: 'pending', title }) : null }
}
