import { computeCmdHash } from '@openape/core'
import type { OpenApeGrant } from '@openape/core'
import { sameBrokeredGrant, verifyAuthzJWT } from '@openape/grants'
import { AgentAuthority } from '../broker/authorization'
import type { AgentConnection } from '../broker/authorization'
import { connectionRequest, readJSON } from '../connections/http'

/** What one once-grant is bound to: one item of a reviewed batch. */
export interface GrantBinding { grantId?: string, expiresAt: number, command: string[], summary: string }
/** One item of a batch, identified by a key that is unique within the batch. */
export interface BatchMember { key: string, command: string[], summary: string }
export interface BatchRequest { id: string, title: string, expiresAt: number, reason: string, permissions: string[], members: BatchMember[] }
export interface BatchGrant { key: string, id: string }
export type MemberState = 'pending' | 'approved' | 'denied' | 'expired'
export interface GrantAuthority {
  createBatch: (request: BatchRequest) => Promise<{ url: string, grants: BatchGrant[] }>
  statuses: (batchId: string, members: (GrantBinding & { key: string })[]) => Promise<Record<string, MemberState>>
  consume: (binding: GrantBinding) => Promise<void>
  assertActive: (binding: GrantBinding) => Promise<void>
}

const grantIdPattern = /^[\w-]{1,128}$/

export function createGrantAuthority(connection: AgentConnection, signal: AbortSignal, check: () => Promise<unknown>, audience: string): GrantAuthority {
  const decisionIssuer = connection.decisionIssuer ?? connection.issuer
  const headers = async () => ({ Authorization: `Bearer ${await connection.accessToken()}` })
  const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(10000)])
  function verify(grant: OpenApeGrant, binding: GrantBinding): OpenApeGrant {
    const request = grant.request
    if (grant.id !== binding.grantId || request?.requester !== connection.subject || request.audience !== audience || request.target_host !== connection.targetHost || request.grant_type !== 'once' || request.waits_until !== Math.floor(binding.expiresAt / 1000) || JSON.stringify(request.command) !== JSON.stringify(binding.command) || request.summary?.text !== binding.summary || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('Approval grant differs from the reviewed item or Pod identity')
    return grant
  }
  async function get(binding: GrantBinding): Promise<OpenApeGrant> {
    await check(); signal.throwIfAborted()
    if (!binding.grantId || !grantIdPattern.test(binding.grantId)) throw new Error('Missing approval grant identity')
    return verify(await readJSON(await fetch(`${connection.issuer}/api/grants/${binding.grantId}`, { redirect: 'error', signal: timeout(), headers: await headers() })) as unknown as OpenApeGrant, binding)
  }
  let listing: Promise<boolean> | undefined
  /** Lists by batch only where the provider advertises it (grants.md §2); brokered identities cannot list at their provider. */
  function canList(): Promise<boolean> {
    if (connection.brokered) return Promise.resolve(false)
    listing ??= fetch(`${connection.issuer}/.well-known/openid-configuration`, { redirect: 'error', signal: timeout() }).then(readJSON).then(discovery => discovery.openape_grant_batch_supported === true)
    return listing
  }
  async function members(batchId: string, bindings: (GrantBinding & { key: string })[]): Promise<{ key: string, grant: OpenApeGrant }[]> {
    if (!await canList()) {
      const read: { key: string, grant: OpenApeGrant }[] = []
      for (const binding of bindings) read.push({ key: binding.key, grant: await get(binding) })
      return read
    }
    await check(); signal.throwIfAborted()
    const query = new URLSearchParams({ requester: connection.subject, batch: batchId, limit: '100' })
    const page = await readJSON(await fetch(`${connection.issuer}/api/grants?${query}`, { redirect: 'error', signal: timeout(), headers: await headers() })) as { data?: unknown }
    if (!Array.isArray(page.data)) throw new Error('Invalid approval batch listing')
    const listed = page.data as OpenApeGrant[]
    return bindings.map((binding) => {
      const grant = listed.find(item => item?.id === binding.grantId)
      if (!grant) throw new Error('Approval batch listing misses a reviewed item')
      return { key: binding.key, grant: verify(grant, binding) }
    })
  }
  function manual(grant: OpenApeGrant): void {
    if (grant.decided_by !== connection.owner || grant.auto_approval_kind || grant.decided_by_standing_grant) throw new Error('Approval requires a manual owner decision on this exact item')
  }
  function state(grant: OpenApeGrant): MemberState {
    if (grant.status === 'pending') return 'pending'
    if (grant.status === 'expired') return 'expired'
    if (grant.status === 'denied' || grant.status === 'revoked') return 'denied'
    if (grant.status !== 'approved') throw new Error('Approval grant was already used outside this execution')
    manual(grant)
    return 'approved'
  }
  return {
    async createBatch(request) {
      const batch = { id: request.id, title: request.title.slice(0, 200), size: request.members.length }
      const grants: BatchGrant[] = []
      for (const member of request.members) {
        await check(); signal.throwIfAborted()
        const reply = await connectionRequest(connection.issuer, '/api/grants', { requester: connection.subject, target_host: connection.targetHost, audience, grant_type: 'once', command: member.command, permissions: request.permissions, waits_until: Math.floor(request.expiresAt / 1000), reason: request.reason, summary: { text: member.summary }, batch }, signal, await connection.accessToken())
        if (typeof reply.id !== 'string' || !grantIdPattern.test(reply.id)) throw new Error('Invalid approval grant response')
        grants.push({ key: member.key, id: reply.id })
      }
      const query = new URLSearchParams({ requester: connection.subject, batch: request.id })
      return { url: `${decisionIssuer}/grant-approval?${query}`, grants }
    },
    async statuses(batchId, bindings) {
      return Object.fromEntries((await members(batchId, bindings)).map(({ key, grant }) => [key, state(grant)]))
    },
    async consume(binding) {
      const grant = await get(binding); manual(grant)
      if (grant.status !== 'approved' || binding.expiresAt <= Date.now()) throw new Error('Approval is not current')
      const response = await connectionRequest(connection.issuer, `/api/grants/${binding.grantId}/token`, {}, signal, await connection.accessToken())
      if (typeof response.authz_jwt !== 'string') throw new Error('Missing approval authorization token')
      const token = response.authz_jwt
      const verification = await verifyAuthzJWT(token, { expectedIss: decisionIssuer, expectedAud: audience, jwksUri: `${decisionIssuer}/.well-known/jwks.json` })
      const claims = verification.claims
      if (!verification.valid || !claims || claims.sub !== connection.subject || claims.target_host !== connection.targetHost || claims.grant_id !== binding.grantId || claims.grant_type !== 'once' || claims.decided_by !== connection.owner || claims.cmd_hash !== await computeCmdHash(binding.command.join(' ')) || JSON.stringify(claims.command) !== JSON.stringify(binding.command) || !sameBrokeredGrant(claims.brokered, connection.brokered)) throw new Error('Approval token does not authorize this exact item')
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
