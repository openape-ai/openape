import type { OpenApeGrant } from '@openape/core'
import { sameBrokeredGrant } from '@openape/grants'
import type { AgentConnection } from '../broker/authorization'
import { connectionRequest, readJSON } from '../connections/http'
import type { GrantSummary } from '../../contracts/grant-summary'

/**
 * What one item grant (once or always) is bound to: one item of a reviewed batch. The summary is not part of it: the
 * IdP owns the presentation and may migrate stored summaries (issue 1473), while the command binds what is allowed.
 */
export interface GrantBinding { grantId?: string, expiresAt: number, command: string[] }
/** One item of a batch, identified by a key that is unique within the batch; the summary is what the IdP shows about it. */
export interface BatchMember { key: string, command: string[], summary: GrantSummary }
/** `open`: announce no size, so later requests with the same batch id, title and expiry join it (grants.md §3.4). */
export interface BatchRequest { id: string, title: string, expiresAt: number, permissions: string[], members: BatchMember[], open?: boolean }
export interface BatchGrant { key: string, id: string }
export type MemberState = 'pending' | 'approved' | 'denied' | 'expired'
/** How the owner may decide an item at the IdP: once is consumed on release, always stays valid while approved; both stay bound to the item's exact command. */
export type GrantDecision = 'once' | 'always'
export interface GrantAuthority {
  release: (batchId: string, members: (GrantBinding & { key: string })[], revoke?: (grantId: string) => Promise<Record<string, unknown>>) => Promise<number>
}

const grantIdPattern = /^[\w-]{1,128}$/

export function createGrantAuthority(connection: AgentConnection, signal: AbortSignal, check: () => Promise<unknown>, audience: string, grantTypes: readonly GrantDecision[] = ['once']): GrantAuthority {
  const headers = async () => ({ Authorization: `Bearer ${await connection.accessToken()}` })
  const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(10000)])
  function verify(grant: OpenApeGrant, binding: GrantBinding): OpenApeGrant {
    const request = grant.request
    if (grant.id !== binding.grantId || request?.requester !== connection.subject || request.audience !== audience || request.target_host !== connection.targetHost || !grantTypes.includes(request.grant_type as GrantDecision) || request.waits_until !== Math.floor(binding.expiresAt / 1000) || JSON.stringify(request.command) !== JSON.stringify(binding.command) || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('Approval grant differs from the reviewed item or Pod identity')
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
  return {
    async release(batchId, bindings, revoke) {
      let revoked = 0
      for (const { grant } of await members(batchId, bindings)) {
        // Retired grants cannot remain actionable after cutover, including approved once grants.
        if (grant.status !== 'pending' && grant.status !== 'approved') continue
        await check(); signal.throwIfAborted()
        const reply = revoke ? await revoke(grant.id) : await connectionRequest(connection.issuer, `/api/grants/${grant.id}/revoke`, {}, signal, await connection.accessToken())
        if (reply.status !== 'revoked') throw new Error('Approval grant was not revoked')
        revoked++
      }
      return revoked
    },
  }
}
