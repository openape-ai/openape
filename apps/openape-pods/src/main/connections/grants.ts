import { loadAdapter, resolveCommand } from '@openape/apes'
import { join } from 'node:path'
import type { MailSetup } from '../../contracts/onboarding'
import type { PodIdentityReference, PodIdentityManager  } from './agent'
import type { MailAssignment } from '../mail/service'
import { connectionRequest } from './http'

export async function approveMailGrants(setup: MailSetup, identity: PodIdentityReference, identities: PodIdentityManager, ownerBearer: string, vendor: string, signal: AbortSignal): Promise<MailAssignment['grants']> {
  const adapter = loadAdapter('o365-cli', join(vendor, 'o365-shapes.toml'))
  const agent = identities.connection(identity, `pods:${setup.podId}`)
  const grants: MailAssignment['grants'] = {}
  const operations: ('messages' | 'attachments' | 'attachment')[] = setup.attachments ? ['messages', 'attachments', 'attachment'] : ['messages']
  for (const operation of operations) {
    const resolved = []
    for (const folder of setup.folders) resolved.push(await resolveCommand(adapter, ['o365-cli', 'pods', 'read', '--account', setup.account, '--folder', folder.id, '--operation', operation]))
    const created = await connectionRequest(identity.issuer, '/api/grants', { requester: identity.subject, target_host: agent.targetHost, audience: 'shapes', grant_type: 'always', permissions: resolved.map(item => item.permission), authorization_details: resolved.map(item => item.detail), execution_context: resolved[0].executionContext, reason: `Owner-approved read-only mail for pod ${setup.podId}` }, signal, await agent.accessToken())
    if (typeof created.id !== 'string' || !/^[\w-]{1,128}$/.test(created.id)) throw new Error('Invalid mail permission response; inspect pending grants before retrying')
    if (created.status === 'approved') { grants[operation] = created.id; continue }
    if (created.status !== 'pending') throw new Error('Mail permission was declined or revoked')
    const approval = await connectionRequest(identity.issuer, `/api/grants/${created.id}/approve`, {}, signal, ownerBearer)
    const grant = approval.grant as { id?: string, status?: string } | undefined
    if (grant?.id !== created.id || grant.status !== 'approved') throw new Error('Mail permission was not approved')
    grants[operation] = created.id
  }
  return grants
}
