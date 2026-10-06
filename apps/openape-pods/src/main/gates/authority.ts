import { computeCmdHash } from '@openape/core'
import type { OpenApeGrant } from '@openape/core'
import { sameBrokeredGrant, verifyAuthzJWT } from '@openape/grants'
import { AgentAuthority } from '../broker/authorization'
import type { AgentConnection } from '../broker/authorization'
import { connectionRequest, readJSON } from '../connections/http'

/** What one once-grant is bound to. The command carries the identity of the reviewed batch. */
export interface GrantBinding { grantId?: string, expiresAt: number, command: string[], summary: string }
export interface GrantRequest extends GrantBinding { reason: string, permissions: string[] }
export interface GrantAuthority {
  create: (request: GrantRequest) => Promise<{ id: string, url: string }>
  status: (binding: GrantBinding) => Promise<'pending' | 'approved' | 'denied' | 'expired'>
  consume: (binding: GrantBinding) => Promise<void>
  assertActive: (binding: GrantBinding) => Promise<void>
}

export function createGrantAuthority(connection: AgentConnection, signal: AbortSignal, check: () => Promise<unknown>, audience: string): GrantAuthority {
  const decisionIssuer = connection.decisionIssuer ?? connection.issuer
  async function get(binding: GrantBinding): Promise<OpenApeGrant> {
    await check(); signal.throwIfAborted()
    if (!binding.grantId || !/^[\w-]{1,128}$/.test(binding.grantId)) throw new Error('Missing approval grant identity')
    const grant = await readJSON(await fetch(`${connection.issuer}/api/grants/${binding.grantId}`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${await connection.accessToken()}` } })) as unknown as OpenApeGrant
    const request = grant.request
    if (grant.id !== binding.grantId || request?.requester !== connection.subject || request.audience !== audience || request.target_host !== connection.targetHost || request.grant_type !== 'once' || request.waits_until !== Math.floor(binding.expiresAt / 1000) || JSON.stringify(request.command) !== JSON.stringify(binding.command) || request.summary?.text !== binding.summary || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('Approval grant differs from the reviewed batch or Pod identity')
    return grant
  }
  function manual(grant: OpenApeGrant): void {
    if (grant.decided_by !== connection.owner || grant.auto_approval_kind || grant.decided_by_standing_grant) throw new Error('Approval requires a manual owner decision on this exact batch')
  }
  return {
    async create(request) {
      await check(); signal.throwIfAborted()
      const reply = await connectionRequest(connection.issuer, '/api/grants', { requester: connection.subject, target_host: connection.targetHost, audience, grant_type: 'once', command: request.command, permissions: request.permissions, waits_until: Math.floor(request.expiresAt / 1000), reason: request.reason, summary: { text: request.summary } }, signal, await connection.accessToken())
      if (typeof reply.id !== 'string' || !/^[\w-]{1,128}$/.test(reply.id)) throw new Error('Invalid approval grant response')
      return { id: reply.id, url: `${decisionIssuer}/grant-approval?grant_id=${encodeURIComponent(reply.id)}` }
    },
    async status(binding) {
      const grant = await get(binding)
      if (grant.status === 'pending') return 'pending'
      if (grant.status === 'expired') return 'expired'
      if (grant.status === 'denied' || grant.status === 'revoked') return 'denied'
      if (grant.status !== 'approved') throw new Error('Approval grant was already used outside this execution')
      manual(grant)
      return 'approved'
    },
    async consume(binding) {
      const grant = await get(binding); manual(grant)
      if (grant.status !== 'approved' || binding.expiresAt <= Date.now()) throw new Error('Approval is not current')
      const response = await connectionRequest(connection.issuer, `/api/grants/${binding.grantId}/token`, {}, signal, await connection.accessToken())
      if (typeof response.authz_jwt !== 'string') throw new Error('Missing approval authorization token')
      const token = response.authz_jwt
      const verification = await verifyAuthzJWT(token, { expectedIss: decisionIssuer, expectedAud: audience, jwksUri: `${decisionIssuer}/.well-known/jwks.json` })
      const claims = verification.claims
      if (!verification.valid || !claims || claims.sub !== connection.subject || claims.target_host !== connection.targetHost || claims.grant_id !== binding.grantId || claims.grant_type !== 'once' || claims.decided_by !== connection.owner || claims.cmd_hash !== await computeCmdHash(binding.command.join(' ')) || JSON.stringify(claims.command) !== JSON.stringify(binding.command) || !sameBrokeredGrant(claims.brokered, connection.brokered)) throw new Error('Approval token does not authorize this exact batch')
      await check(); signal.throwIfAborted()
      const consumed = await connectionRequest(decisionIssuer, `/api/grants/${binding.grantId}/consume`, {}, signal, token)
      if (consumed.status !== 'consumed' || consumed.error) throw new Error('Approval grant was not consumed; nothing may move')
    },
    async assertActive(binding) {
      const grant = await get(binding); manual(grant)
      await new AgentAuthority(connection).assertActive(binding.grantId!, signal)
      if (grant.status !== 'used' || binding.expiresAt <= Date.now()) throw new Error('Consumed approval is no longer valid')
      await check(); signal.throwIfAborted()
    },
  }
}
