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
  const binding: GrantBinding & { key: string } = { key: 'delivery-1', grantId: 'grant-1', expiresAt: Date.now() + 60000, command: ['pods', 'network-gate', 'archive one message'], summary: 'Newsletter 1' }
  const grant = { id: 'grant-1', status: 'approved', decided_by: connection.owner, request: { requester: connection.subject, target_host: connection.targetHost, audience, grant_type: type, waits_until: Math.floor(binding.expiresAt / 1000), command: binding.command, summary: { text: binding.summary } } }
  Object.assign(claims, { sub: connection.subject, target_host: connection.targetHost, grant_id: 'grant-1', grant_type: type, decided_by: connection.owner, cmd_hash: await computeCmdHash(binding.command.join(' ')), command: binding.command })
  const consumed: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const path = new URL(String(url)).pathname
    if (path === '/.well-known/openid-configuration') return Response.json({ openape_grant_batch_supported: false })
    if (path === '/api/grants/grant-1') return Response.json(grant)
    if (path === '/api/grants/grant-1/token') return Response.json({ authz_jwt: 'synthetic.jwt' })
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
  return { authority, legacy, binding, grant, consumed }
}

describe('approve-route grants decided as once or always', () => {
  it('releases an item the owner approved as always and keeps it bound to that item while approved', async () => {
    const { authority, legacy, binding, consumed } = await fixture('always')
    // Legacy workflow gates keep accepting only once grants.
    await expect(legacy.statuses('batch', [binding])).rejects.toThrow('differs from the reviewed item')
    expect(await authority.statuses('batch', [binding])).toEqual({ 'delivery-1': 'approved' })
    await authority.consume(binding)
    expect(consumed).toEqual(['always'])
    await expect(authority.assertActive(binding)).resolves.toBeUndefined()
    // The grant authorizes only the exact reviewed item command.
    await expect(authority.consume({ ...binding, command: ['pods', 'network-gate', 'archive another message'] })).rejects.toThrow('differs from the reviewed item')
  })

  it('moves nothing once the owner revokes or denies an always grant', async () => {
    const revoked = await fixture('always')
    await revoked.authority.consume(revoked.binding)
    revoked.grant.status = 'revoked'
    expect(await revoked.authority.statuses('batch', [revoked.binding])).toEqual({ 'delivery-1': 'denied' })
    await expect(revoked.authority.assertActive(revoked.binding)).rejects.toThrow()
    await expect(revoked.authority.consume(revoked.binding)).rejects.toThrow('not current')
    const denied = await fixture('always')
    denied.grant.status = 'denied'
    expect(await denied.authority.statuses('batch', [denied.binding])).toEqual({ 'delivery-1': 'denied' })
    await expect(denied.authority.consume(denied.binding)).rejects.toThrow('not current')
    await expect(denied.authority.assertActive(denied.binding)).rejects.toThrow()
    expect(denied.consumed).toEqual([])
  })

  it('still uses up a once grant and refuses a timed decision', async () => {
    const once = await fixture('once')
    await once.authority.consume(once.binding)
    expect(once.grant.status).toBe('used')
    await expect(once.authority.assertActive(once.binding)).resolves.toBeUndefined()
    const timed = await fixture('timed')
    await expect(timed.authority.statuses('batch', [timed.binding])).rejects.toThrow('differs from the reviewed item')
  })
})
