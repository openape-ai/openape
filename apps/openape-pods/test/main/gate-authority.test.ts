// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { computeCmdHash } from '@openape/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGrantAuthority } from '../../src/main/gates/authority'
import type { GrantBinding } from '../../src/main/gates/authority'

const claims: Record<string, unknown> = {}
vi.mock('@openape/grants', async original => ({ ...await original<typeof import('@openape/grants')>(), verifyAuthzJWT: vi.fn(async () => ({ valid: true, claims })) }))
afterEach(() => { vi.unstubAllGlobals() })

const issuer = 'https://id.example.test'
const audience = 'pods-graph-gate'

/**
 * The owner's identity provider as the gate authority sees it: one item grant, decided as `once` or
 * `always`, and the record of what the authority consumed. The mailbox is not involved: a gate
 * releases an item only after consume, and every archive move first asks assertActive.
 */
async function fixture(type: 'once' | 'always' | 'timed') {
  const podId = randomUUID()
  const connection = { subject: 'agent@example.test', owner: 'owner@example.test', issuer, targetHost: `pods:${podId}`, keyId: 'key', accessToken: async () => 'synthetic-only' }
  const binding: GrantBinding & { key: string } = { key: 'delivery-1', grantId: 'grant-1', expiresAt: Date.now() + 60000, command: ['pods', 'network-gate', 'archive one message'] }
  const grant = { id: 'grant-1', status: 'approved', decided_by: connection.owner, request: { requester: connection.subject, target_host: connection.targetHost, audience, grant_type: type, waits_until: Math.floor(binding.expiresAt / 1000), command: binding.command, summary: { title: 'Newsletter 1' } } }
  Object.assign(claims, { sub: connection.subject, target_host: connection.targetHost, grant_id: 'grant-1', grant_type: type, decided_by: connection.owner, cmd_hash: await computeCmdHash(binding.command.join(' ')), command: binding.command })
  const consumed: string[] = []; const revoked: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const path = new URL(String(url)).pathname
    if (path === '/.well-known/openid-configuration') return Response.json({ openape_grant_batch_supported: false })
    if (path === '/api/grants/grant-1') return Response.json(grant)
    if (path === '/api/grants/grant-1/token') return Response.json({ authz_jwt: 'synthetic.jwt' })
    if (path === '/api/grants/grant-1/revoke') { if (!['approved', 'pending'].includes(grant.status)) return Response.json({ title: 'Grant cannot be revoked' }, { status: 400 }); revoked.push(grant.id); grant.status = 'revoked'; return Response.json(grant) }
    if (path === '/api/grants/grant-1/consume') {
      if (grant.status !== 'approved') return Response.json({ error: grant.status, status: grant.status })
      consumed.push(grant.request.grant_type)
      if (grant.request.grant_type === 'once') { grant.status = 'used'; return Response.json({ status: 'consumed' }) }
      return Response.json({ status: 'valid' })
    }
    if (path === `/api/pods/agents/${encodeURIComponent(connection.subject)}`) return Response.json({ email: connection.subject, owner: connection.owner, active: true, grantId: 'grant-1', grantActive: grant.status === 'approved' || grant.status === 'used', keyIds: ['key'] })
    throw new Error(`Unexpected synthetic request ${path}`)
  }))
  const authority = createGrantAuthority(connection as never, new AbortController().signal, async () => {}, audience, ['once', 'always'])
  const legacy = createGrantAuthority(connection as never, new AbortController().signal, async () => {}, audience)
  return { authority, legacy, binding, grant, consumed, revoked }
}

describe('historical grant retirement', () => {
  it.each(['once', 'always'] as const)('revokes approved %s grants idempotently without consuming or executing', async (type) => {
    const f = await fixture(type)
    expect(Object.keys(f.authority)).toEqual(['release'])
    expect(await f.authority.release('batch', [f.binding])).toBe(1)
    expect(await f.authority.release('batch', [f.binding])).toBe(0)
    expect(f.consumed).toEqual([])
    expect(f.revoked).toEqual(['grant-1'])
  })
  it('withdraws pending requests but leaves already used grants alone', async () => {
    const f = await fixture('once'); f.grant.status = 'pending'
    expect(await f.authority.release('batch', [f.binding])).toBe(1)
    f.grant.status = 'used'
    expect(await f.authority.release('batch', [f.binding])).toBe(0)
  })
  it('checks the exact historical command and requester before revocation', async () => {
    const f = await fixture('once')
    await expect(f.authority.release('batch', [{ ...f.binding, command: ['another command'] }])).rejects.toThrow('differs')
    f.grant.request.requester = 'foreign@example.test'
    await expect(f.authority.release('batch', [f.binding])).rejects.toThrow('differs')
    expect(f.revoked).toEqual([])
  })
  it('uses the owner revoke for a brokered grant', async () => {
    const f = await fixture('once'); const owner = vi.fn(async () => ({ status: 'revoked' }))
    expect(await f.authority.release('batch', [f.binding], owner)).toBe(1)
    expect(owner).toHaveBeenCalledWith('grant-1')
    expect(f.revoked).toEqual([])
  })
})
