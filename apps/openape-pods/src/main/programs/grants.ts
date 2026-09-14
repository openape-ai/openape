import { loadAdapter, resolveCommand } from '@openape/apes'
import type { PodIdentityReference, PodIdentityManager } from '../connections/agent'
import { connectionRequest } from '../connections/http'

export interface ProgramAuthority { identity: PodIdentityReference, ownerConnection: string, grantId: string }
export async function approveCommands(identity: PodIdentityReference, identities: PodIdentityManager, bearer: string, adapterPath: string, commands: string[][], signal: AbortSignal): Promise<string> {
  const adapter = loadAdapter(commands[0][0], adapterPath)
  const agent = identities.connection(identity, `pods:${identity.podId}`)
  const resolved = await Promise.all(commands.map(argv => resolveCommand(adapter, argv)))
  const created = await connectionRequest(identity.issuer, '/api/grants', { requester: identity.subject, target_host: agent.targetHost, audience: 'shapes', grant_type: 'always', permissions: resolved.map(item => item.permission), authorization_details: resolved.map(item => item.detail), execution_context: resolved[0].executionContext, reason: `Owner-assigned program or HTTPS permission for pod ${identity.podId}` }, signal, await agent.accessToken())
  if (typeof created.id !== 'string' || !/^[\w-]{1,128}$/.test(created.id)) throw new Error('Invalid application permission response; inspect pending grants before retrying')
  if (created.status === 'approved') return created.id
  if (created.status !== 'pending') throw new Error('Application permission was declined or revoked')
  const result = await connectionRequest(identity.issuer, `/api/grants/${created.id}/approve`, {}, signal, bearer)
  const grant = result.grant as { id?: string, status?: string } | undefined
  if (grant?.id !== created.id || grant.status !== 'approved') throw new Error('Application permission was not approved')
  return created.id
}
